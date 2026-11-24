// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { process, serveNetlifyHandler } from './adapter.ts';

// netlify/functions/portone-webhook.js
// PortOne V1 결제알림(Webhook) 수신 엔드포인트.
// 포트원 콘솔 > 연동 정보 > 결제알림(Webhook) 관리 > 결제모듈 V1 웹훅 URL 에
//   https://rgbukqphcqptnfeqipfn.supabase.co/functions/v1/portone-webhook
// 을 등록한다.
//
// 웹훅 본문({ imp_uid, merchant_uid, status })은 위조될 수 있으므로 신뢰하지 않고,
// 반드시 포트원 REST API 로 결제 상태를 다시 조회해 그 결과로만 DB 를 갱신한다.
// 결제 완료(paid) 기록 생성은 로그인 사용자 확인이 필요한 verify-payment.js 가 담당하고,
// 이 함수는 콘솔·PG 측에서 일어난 취소(cancelled) 등 상태 변화를 DB 에 동기화한다.


function res(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function getAccessToken() {
  const tokenRes = await fetch('https://api.iamport.kr/users/getToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imp_key: process.env.PORTONE_IMP_KEY,
      imp_secret: process.env.PORTONE_IMP_SECRET,
    }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.code !== 0) throw new Error('PortOne token error');
  return tokenData.response.access_token;
}

const handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { ok: false, message: 'Method Not Allowed' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return res(400, { ok: false, message: 'invalid json' });
  }

  const impUid = String(body.imp_uid || '').trim();
  if (!impUid) {
    // 포트원 콘솔의 "호출 테스트" 등 본문 없는 호출은 정상 응답으로 처리
    return res(200, { ok: true, message: 'no imp_uid (test call)' });
  }

  try {
    const accessToken = await getAccessToken();
    const payRes = await fetch(`https://api.iamport.kr/payments/${encodeURIComponent(impUid)}`, {
      headers: { Authorization: accessToken },
    });
    const payData = await payRes.json();
    if (payData.code !== 0 || !payData.response) {
      console.error('Webhook: payment lookup failed', impUid, payData.message);
      return res(200, { ok: false, message: 'payment not found' });
    }
    const payment = payData.response;
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    if (payment.status === 'cancelled') {
      // 전액 취소만 이용권 회수 대상으로 본다 (부분 취소는 상태 유지)
      const fullyCancelled = Number(payment.cancel_amount || 0) >= Number(payment.amount || 0);
      if (fullyCancelled) {
        const { error } = await sb
          .from('payments')
          .update({ status: 'cancelled' })
          .eq('imp_uid', impUid)
          .neq('status', 'cancelled');
        if (error) {
          console.error('Webhook: cancel sync failed', impUid, error);
          // 500 을 돌려주면 포트원 재발송 설정 시 재시도된다
          return res(500, { ok: false, message: 'db update failed' });
        }
      }
      return res(200, { ok: true, status: 'cancelled', full: fullyCancelled });
    }

    if (payment.status === 'paid') {
      // 결제 기록은 verify-payment 에서 생성된다. 승인 직후 창을 닫아 기록이 없거나,
      // 커플 결제인데 초대 코드가 없으면 복구 대기열에 올려 운영자가 확인·복구할 수 있게 한다.
      // 웹훅이 verify-payment 보다 먼저 도착할 수 있어 한 번 기다렸다가 다시 확인한다
      const lookup = () => sb.from('payments').select('id,order_name,user_id').eq('imp_uid', impUid).maybeSingle();
      let { data } = await lookup();
      if (!data) {
        await new Promise((r) => setTimeout(r, Number(process.env.WEBHOOK_RECHECK_MS ?? 8000)));
        ({ data } = await lookup());
      }
      let reason = null;
      if (!data) {
        reason = 'no_payment_record';
      } else if (/커플/.test(data.order_name || '') || /커플/.test(payment.name || '')) {
        const { data: couple } = await sb.from('couples').select('code').eq('imp_uid', impUid).maybeSingle();
        if (!couple) reason = 'couple_code_missing';
      }
      if (reason) {
        console.error('Webhook: payment needs recovery', reason, impUid, payment.merchant_uid);
        const { error: qErr } = await sb.from('payment_recovery_queue').upsert([{
          imp_uid: impUid,
          merchant_uid: payment.merchant_uid || null,
          amount: Number(payment.amount || 0),
          order_name: payment.name || null,
          paid_at: payment.paid_at ? new Date(payment.paid_at * 1000).toISOString() : null,
          reason,
        }], { onConflict: 'imp_uid', ignoreDuplicates: true });
        if (qErr) console.error('Webhook: recovery queue insert failed', impUid, qErr.message);
      }
      return res(200, { ok: true, status: 'paid', recorded: !!data, recovery: reason });
    }

    // ready / failed 등은 기록할 것이 없음
    return res(200, { ok: true, status: payment.status });
  } catch (err) {
    console.error('Webhook error', impUid, err && err.message);
    return res(500, { ok: false, message: 'internal error' });
  }
};

serveNetlifyHandler(handler);
