// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { process, serveNetlifyHandler } from './adapter.ts';

// 커플 패키지 API (로그인 필수)
//   action 'status' : 내 커플 연결 상태 + 두 사람의 정밀 검사 완료 여부
//   action 'join'   : 초대 코드로 파트너 연결 + 파트너 정밀 검사 이용권 발급
//   action 'report' : 두 사람 모두 완료 시 비교 리포트용 결과(유형·8영역 점수) 반환

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function displayName(u) {
  if (!u) return '';
  const m = u.user_metadata || {};
  return m.full_name || m.name || m.nickname || (u.email ? u.email.split('@')[0] : '') || '';
}

async function latestResult(sb, userId) {
  if (!userId) return null;
  const { data } = await sb.from('premium_results')
    .select('result_type,scores,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  return data && data.length ? data[0] : null;
}

async function findCouple(sb, uid) {
  const { data } = await sb.from('couples')
    .select('*')
    .or(`owner_id.eq.${uid},partner_id.eq.${uid}`)
    .order('created_at', { ascending: false })
    .limit(1);
  return data && data.length ? data[0] : null;
}

const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { success: false, message: 'Method Not Allowed' });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const authHeader = event.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return json(401, { success: false, message: '로그인이 필요합니다.' });
  const { data: ud, error: uerr } = await sb.auth.getUser(token);
  if (uerr || !ud?.user) return json(401, { success: false, message: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' });
  const me = ud.user;

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const action = String(body.action || 'status');

  try {
    if (action === 'join') {
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return json(400, { success: false, message: '초대 코드를 확인해 주세요.' });
      const { data: c } = await sb.from('couples').select('*').eq('code', code).maybeSingle();
      if (!c) return json(404, { success: false, message: '존재하지 않는 초대 코드예요.' });
      if (c.owner_id === me.id) return json(400, { success: false, message: '본인이 결제한 패키지의 초대 코드예요. 함께할 분께 링크를 보내 주세요.' });
      if (c.partner_id && c.partner_id !== me.id) return json(409, { success: false, message: '이미 다른 분이 연결된 초대 코드예요.' });

      if (!c.partner_id) {
        const { error: upErr } = await sb.from('couples')
          .update({ partner_id: me.id, paired_at: new Date().toISOString() })
          .eq('id', c.id).is('partner_id', null);
        if (upErr) throw upErr;
      }

      // 파트너 정밀 검사 이용권 (이미 이용권이 있으면 생략)
      const { data: ent } = await sb.from('payments').select('id').eq('user_id', me.id).in('status', ['paid', 'free']).limit(1);
      if (!ent || !ent.length) {
        const { error: pErr } = await sb.from('payments').insert([{
          user_id: me.id,
          imp_uid: null,
          merchant_uid: 'COUPLE-' + code,
          pg: 'couple',
          amount: 0,
          original_amount: 0,
          discount_amount: 0,
          final_amount: 0,
          coupon_code: null,
          buyer_name: displayName(me),
          buyer_email: me.email || '',
          buyer_phone: '',
          status: 'free',
          paid_at: new Date().toISOString(),
          order_name: 'SKOPOS SDTI 커플 패키지 (파트너 이용권)',
        }]);
        if (pErr) console.error('partner entitlement insert failed:', pErr.message);
      }
      return json(200, { success: true, code });
    }

    const c = await findCouple(sb, me.id);
    if (!c) return json(200, { success: true, couple: null });

    const role = c.owner_id === me.id ? 'owner' : 'partner';
    const partnerId = role === 'owner' ? c.partner_id : c.owner_id;
    const [myRes, partnerRes] = await Promise.all([latestResult(sb, me.id), latestResult(sb, partnerId)]);
    let partnerName = '';
    if (partnerId) {
      const { data: pu } = await sb.auth.admin.getUserById(partnerId);
      partnerName = displayName(pu?.user);
    }

    const base = {
      code: c.code,
      role,
      paired: !!c.partner_id,
      my_name: displayName(me),
      partner_name: partnerName,
      my_done: !!myRes,
      partner_done: !!partnerRes,
    };

    if (action === 'report') {
      if (!myRes || !partnerRes) return json(200, { success: true, couple: base, ready: false });
      return json(200, {
        success: true,
        couple: base,
        ready: true,
        me: { name: base.my_name, type: myRes.result_type, scores: myRes.scores },
        partner: { name: partnerName, type: partnerRes.result_type, scores: partnerRes.scores },
      });
    }
    return json(200, { success: true, couple: base });
  } catch (err) {
    console.error('couple error:', err);
    return json(500, { success: false, message: '잠시 후 다시 시도해 주세요.' });
  }
};

serveNetlifyHandler(handler);
