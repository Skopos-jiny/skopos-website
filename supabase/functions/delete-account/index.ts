// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { process, serveNetlifyHandler } from './adapter.ts';

// 회원 탈퇴 API (로그인 필수)
//   action 'preview' : 탈퇴 시 삭제·보관되는 항목 요약 (확인 화면용)
//   action 'delete'  : 실제 탈퇴 처리
//
// 처리 원칙
//   - 개인정보(검사 결과, 설문 응답, 구독 정보, 쿠폰 사용 이력)는 즉시 완전 삭제
//   - 결제 기록은 전자상거래법 제6조에 따라 5년 보관하되, 계정 연결(user_id)을 끊어 비식별 처리
//     (payments RLS 는 본인 user_id 기준이므로 user_id 가 비면 어떤 이용자에게도 조회되지 않음)
//   - 유입 기록(funnel_events)은 개인 식별 값만 제거하고 통계는 유지
//   - 탈퇴 사실은 개인 식별 정보 없이 통계로만 남김 (account_deletions)

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

const CONFIRM_PHRASE = '탈퇴합니다';

const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { success: false, message: 'Method Not Allowed' });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const authHeader = event.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return json(401, { success: false, message: '로그인이 필요합니다.' });
  const { data: ud, error: uerr } = await sb.auth.getUser(token);
  if (uerr || !ud?.user) return json(401, { success: false, message: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' });
  const me = ud.user;
  const uid = me.id;

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const action = String(body.action || 'preview');

  try {
    // ── 공통: 현재 보유 데이터 집계 ─────────────────────────────
    const countOf = async (table, col) => {
      const { count } = await sb.from(table).select('id', { count: 'exact', head: true }).eq(col, uid);
      return count || 0;
    };

    const [quizCount, premiumCount, payAll, intakeCount, subCount] = await Promise.all([
      countOf('quiz_results', 'user_id'),
      countOf('premium_results', 'user_id'),
      sb.from('payments').select('id,status', { count: 'exact' }).eq('user_id', uid),
      countOf('intake_responses', 'user_id'),
      countOf('seasonal_subscriptions', 'user_id'),
    ]);

    const payments = payAll.data || [];
    const paidCount = payments.filter((p) => p.status === 'paid').length;

    const { data: coupleRows } = await sb.from('couples')
      .select('id,owner_id,partner_id')
      .or(`owner_id.eq.${uid},partner_id.eq.${uid}`);
    const couples = coupleRows || [];
    const ownedCouples = couples.filter((c) => c.owner_id === uid);
    const joinedCouples = couples.filter((c) => c.partner_id === uid);

    if (action === 'preview') {
      return json(200, {
        success: true,
        email: me.email || '',
        summary: {
          quiz_results: quizCount,
          premium_results: premiumCount,
          payments_total: payments.length,
          payments_paid: paidCount,
          intake_responses: intakeCount,
          seasonal_subscriptions: subCount,
          couples_owned: ownedCouples.length,
          couples_joined: joinedCouples.length,
        },
        confirm_phrase: CONFIRM_PHRASE,
      });
    }

    if (action !== 'delete') return json(400, { success: false, message: '알 수 없는 요청입니다.' });

    // ── 확인 문구 검증 ─────────────────────────────────────────
    const confirm = String(body.confirm || '').trim();
    if (confirm !== CONFIRM_PHRASE) {
      return json(400, { success: false, message: `확인을 위해 "${CONFIRM_PHRASE}" 를 정확히 입력해 주세요.` });
    }

    const reason = String(body.reason || '').slice(0, 200);

    // ── 1. 커플 연결 정리 ──────────────────────────────────────
    // 내가 파트너로 참여한 연결: 내 자리만 비움 (상대방은 재초대 가능)
    if (joinedCouples.length) {
      await sb.from('couples').update({ partner_id: null, paired_at: null }).eq('partner_id', uid);
    }
    // 내가 결제한 연결: 내 정밀 결과가 삭제되면 비교 리포트가 성립하지 않으므로 함께 삭제
    if (ownedCouples.length) {
      await sb.from('couples').delete().eq('owner_id', uid);
    }

    // ── 2. 개인정보성 데이터 완전 삭제 ─────────────────────────
    const deletions = [
      sb.from('premium_results').delete().eq('user_id', uid),
      sb.from('quiz_results').delete().eq('user_id', uid),
      sb.from('intake_responses').delete().eq('user_id', uid),
      sb.from('seasonal_subscriptions').delete().eq('user_id', uid),
      sb.from('coupon_redemptions').update({ user_id: null }).eq('user_id', uid),
    ];
    const results = await Promise.all(deletions);
    const failed = results.find((r) => r.error);
    if (failed) {
      console.error('delete-account: data cleanup failed', failed.error);
      return json(500, { success: false, message: '탈퇴 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
    }

    // ── 3. 유입 기록 비식별 ────────────────────────────────────
    await sb.from('funnel_events').update({ user_id: null }).eq('user_id', uid);

    // ── 4. 결제 기록 비식별 보관 (전자상거래법 5년) ─────────────
    if (payments.length) {
      const { error: payErr } = await sb.from('payments')
        .update({ user_id: null, withdrawn_at: new Date().toISOString() })
        .eq('user_id', uid);
      if (payErr) {
        console.error('delete-account: payment de-identify failed', payErr);
        return json(500, { success: false, message: '탈퇴 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
      }
    }

    // ── 5. 탈퇴 통계 기록 (개인 식별 정보 없음) ────────────────
    await sb.from('account_deletions').insert({
      provider: (me.app_metadata && me.app_metadata.provider) || 'email',
      had_payment: paidCount > 0,
      payment_count: paidCount,
      quiz_count: quizCount + premiumCount,
      reason: reason || null,
    });

    // ── 6. 계정 삭제 ───────────────────────────────────────────
    const { error: delErr } = await sb.auth.admin.deleteUser(uid);
    if (delErr) {
      console.error('delete-account: auth delete failed', delErr);
      return json(500, { success: false, message: '계정 삭제 중 문제가 발생했습니다. skopos@skopos.kr 로 문의해 주세요.' });
    }

    return json(200, {
      success: true,
      message: '탈퇴가 완료되었습니다.',
      retained: { payments: payments.length },
    });
  } catch (e) {
    console.error('delete-account error', e);
    return json(500, { success: false, message: '탈퇴 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
  }
};

serveNetlifyHandler(handler);
