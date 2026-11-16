// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { process, serveNetlifyHandler } from './adapter.ts';

// interior-order: SDTI 인테리어 공간욕구검사 정식판 이용권
//   action 'status' : 내 이용권 현황 + 판매 상품
//   action 'verify' : 카드 결제(포트원 V1 + KCP) 확인 후 이용권 적립 (1회 59,900원 / 10회 100,000원)
//   action 'redeem' : 인테리어 전용 쿠폰(전액)으로 1회 이용권 적립 (예: INTERIORBETA)
// 결제 기록은 payments(product='interior')에 남기고, 이용권은 interior_credits 에 적립한다.
// payments 의 product 로 정밀 검사 이용권 판정과 분리된다.

const PLANS = {
  single: { amount: 59900, credits: 1, source: 'single', name: 'SKOPOS SDTI 인테리어 공간욕구검사 1회 이용권' },
  pack10: { amount: 100000, credits: 10, source: 'pack10', name: 'SKOPOS SDTI 인테리어 공간욕구검사 10회 이용권' },
};
const SALES_START = Date.parse('2026-12-01T00:00:00+09:00');
const SITE_ORIGIN = 'https://skopos.kr';

function json(statusCode, body) {
  return { statusCode, headers: { 'Access-Control-Allow-Origin': SITE_ORIGIN, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
function salesOpen() {
  return Date.now() >= SALES_START || process.env.INTERIOR_SALES_OPEN === '1';
}
async function cancelPayment(accessToken, impUid, reason) {
  try {
    const res = await fetch('https://api.iamport.kr/payments/cancel', {
      method: 'POST', headers: { Authorization: accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ imp_uid: impUid, reason }),
    });
    const data = await res.json();
    if (data.code !== 0) { console.error('interior cancel rejected', impUid, reason, JSON.stringify(data)); return false; }
    return true;
  } catch (e) { console.error('interior cancel failed', impUid, reason, e); return false; }
}
function cancelNotice(ok, msg, impUid) {
  return ok ? msg : '결제 확인에 실패했고 자동 취소도 완료되지 않았습니다. 결제 번호(' + impUid + ')를 skopos@skopos.kr 로 보내 주시면 바로 환불해 드리겠습니다.';
}
async function creditStatus(sb, uid) {
  const [{ data: credits }, { data: uses }] = await Promise.all([
    sb.from('interior_credits').select('credits,payment_id,payments(status)').eq('user_id', uid),
    sb.from('interior_credit_uses').select('result_id,started_at').eq('user_id', uid),
  ]);
  const total = (credits || []).filter((c) => !c.payment_id || ['paid', 'free'].includes(c.payments?.status)).reduce((s, c) => s + c.credits, 0);
  const used = (uses || []).length;
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const open = (uses || []).some((u) => !u.result_id && Date.parse(u.started_at) > dayAgo);
  return { total, used, remaining: Math.max(total - used, 0), open_session: open };
}
// 이용권 적립 (같은 결제에 두 번 적립되지 않도록 payment_id 고유)
async function grantCredits(sb, uid, paymentId, credits, source) {
  const { error } = await sb.from('interior_credits').upsert([{ user_id: uid, payment_id: paymentId, credits, source }], { onConflict: 'payment_id', ignoreDuplicates: true });
  if (error) { console.error('interior credit grant failed', paymentId, error.message); return false; }
  return true;
}

const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { success: false, message: 'Method Not Allowed' });
  try {
    const body = JSON.parse(event.body || '{}');
    const action = String(body.action || 'status');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return json(401, { success: false, message: '로그인이 필요합니다.' });
    const { data: userData, error: userError } = await sb.auth.getUser(token);
    if (userError || !userData?.user?.id || userData.user.is_anonymous) {
      return json(401, { success: false, message: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' });
    }
    const user = userData.user;
    const uid = user.id;
    const plans = Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, { amount: v.amount, credits: v.credits, name: v.name }]));

    if (action === 'status') {
      return json(200, { success: true, sales_open: salesOpen(), sales_start: SALES_START, plans, credits: await creditStatus(sb, uid) });
    }

    if (!salesOpen()) return json(403, { success: false, message: '정식판 이용권은 12월 1일부터 구매할 수 있어요.' });

    if (action === 'redeem') {
      const code = String(body.coupon_code || '').trim().toUpperCase();
      if (!/^[A-Z0-9-]{3,40}$/.test(code)) return json(400, { success: false, message: '쿠폰 코드를 확인해 주세요.' });
      const { data: coupon } = await sb.from('coupons').select('*').eq('code', code).maybeSingle();
      const now = Date.now();
      if (!coupon || !coupon.is_active || coupon.product !== 'interior') return json(400, { success: false, message: '사용할 수 없는 쿠폰입니다.' });
      if (coupon.starts_at && Date.parse(coupon.starts_at) > now) return json(400, { success: false, message: '아직 사용할 수 없는 쿠폰입니다.' });
      if (coupon.expires_at && Date.parse(coupon.expires_at) < now) return json(400, { success: false, message: '사용 기한이 지난 쿠폰입니다.' });
      const base = PLANS.single.amount;
      let discount = coupon.discount_type === 'percent' ? Math.floor(base * Number(coupon.discount_value || 0) / 100) : Number(coupon.discount_value || 0);
      if (coupon.max_discount_amount) discount = Math.min(discount, Number(coupon.max_discount_amount));
      discount = Math.max(0, Math.min(discount, base));
      if (base - discount !== 0) return json(400, { success: false, message: '이 쿠폰은 이용권 코드가 아니에요. 카카오톡 채널로 문의해 주세요.' });

      const merchantUid = 'SKOPOS-INT-FREE-' + Date.now();
      const { data: pay, error: payErr } = await sb.from('payments').insert([{
        user_id: uid, imp_uid: null, merchant_uid: merchantUid, pg: 'FREE_COUPON', product: 'interior',
        amount: 0, original_amount: base, discount_amount: discount, final_amount: 0, coupon_code: coupon.code,
        buyer_name: user.user_metadata?.full_name || user.user_metadata?.name || '', buyer_email: user.email || '', buyer_phone: '',
        status: 'free', paid_at: new Date().toISOString(), order_name: PLANS.single.name,
      }]).select('id').single();
      if (payErr) {
        // 쿠폰 사용 한도·1인 1회는 payments 트리거가 판정한다
        const m = String(payErr.message || '');
        const msg = /per-user/.test(m) ? '이미 사용한 쿠폰입니다.' : /usage limit/.test(m) ? '쿠폰이 모두 소진되었습니다.' : /unavailable/.test(m) ? '지금은 사용할 수 없는 쿠폰입니다.' : '쿠폰을 적용하지 못했어요. 잠시 후 다시 시도해 주세요.';
        console.error('interior redeem failed', code, m);
        return json(400, { success: false, message: msg });
      }
      if (!(await grantCredits(sb, uid, pay.id, 1, 'coupon'))) return json(500, { success: false, message: '이용권 적립에 실패했어요. 카카오톡 채널로 문의해 주세요.' });
      return json(200, { success: true, granted: 1, credits: await creditStatus(sb, uid) });
    }

    if (action === 'verify') {
      const { imp_uid, merchant_uid } = body;
      const plan = PLANS[body.plan] ? body.plan : null;
      if (!plan) return json(400, { success: false, message: '이용권 종류가 올바르지 않습니다.' });
      if (typeof imp_uid !== 'string' || !/^imp_\d{6,20}$/.test(imp_uid)) return json(400, { success: false, message: '결제 번호 형식이 올바르지 않습니다.' });
      if (merchant_uid && (typeof merchant_uid !== 'string' || merchant_uid.length > 80)) return json(400, { success: false, message: '주문 번호 형식이 올바르지 않습니다.' });

      // 이미 기록된 결제: 본인 것이면 적립 상태만 맞추고 그대로 성공
      const { data: existing } = await sb.from('payments').select('id,user_id,status,product,order_name').eq('imp_uid', imp_uid).maybeSingle();
      if (existing) {
        if (existing.user_id !== uid) return json(409, { success: false, message: '이미 다른 계정으로 처리된 결제입니다. 관리자에게 문의해 주세요.' });
        if (existing.product !== 'interior') return json(409, { success: false, message: '인테리어 검사 결제가 아닙니다.' });
        if (existing.status === 'cancelled') return json(400, { success: false, message: '취소된 결제입니다.' });
        const p = existing.order_name === PLANS.pack10.name ? PLANS.pack10 : PLANS.single;
        await grantCredits(sb, uid, existing.id, p.credits, p.source);
        return json(200, { success: true, already: true, credits: await creditStatus(sb, uid) });
      }

      const tokenRes = await fetch('https://api.iamport.kr/users/getToken', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imp_key: process.env.PORTONE_IMP_KEY, imp_secret: process.env.PORTONE_IMP_SECRET }),
      });
      const tokenData = await tokenRes.json();
      if (tokenData.code !== 0) return json(400, { success: false, message: '포트원 인증에 실패했습니다.' });
      const accessToken = tokenData.response.access_token;
      const payRes = await fetch(`https://api.iamport.kr/payments/${encodeURIComponent(imp_uid)}`, { headers: { Authorization: accessToken } });
      const payData = await payRes.json();
      if (payData.code !== 0) return json(400, { success: false, message: '결제 정보를 조회하지 못했습니다.' });
      const payment = payData.response;
      if (!payment || payment.imp_uid !== imp_uid || (merchant_uid && payment.merchant_uid !== merchant_uid)) {
        return json(400, { success: false, message: '결제 정보가 일치하지 않습니다. 관리자에게 문의해 주세요.' });
      }
      if (payment.status !== 'paid') return json(400, { success: false, message: `결제가 완료되지 않았습니다. (${payment.status})` });
      // 다른 상품(정밀 검사 등) 주문을 여기서 처리하거나 취소하지 않도록 주문 번호로 구분
      if (!String(payment.merchant_uid || '').startsWith('SKOPOS-INT-')) {
        return json(409, { success: false, message: '인테리어 검사 이용권 주문이 아닙니다.' });
      }
      const p = PLANS[plan];
      if (Number(payment.amount) !== p.amount) {
        console.error('interior amount mismatch', imp_uid, plan, payment.amount);
        const ok = await cancelPayment(accessToken, imp_uid, '결제 금액 검증 실패');
        return json(ok ? 400 : 500, { success: false, message: cancelNotice(ok, '결제 금액이 일치하지 않아 자동 취소했습니다.', imp_uid) });
      }

      const record = {
        user_id: uid, imp_uid, merchant_uid: payment.merchant_uid, pg: 'NHN KCP', product: 'interior',
        amount: payment.amount, original_amount: p.amount, discount_amount: 0, final_amount: p.amount, coupon_code: null,
        buyer_name: payment.buyer_name || '', buyer_email: payment.buyer_email || user.email || '', buyer_phone: payment.buyer_tel || '',
        status: 'paid', paid_at: new Date(payment.paid_at * 1000).toISOString(), order_name: p.name,
      };
      let payId = null;
      const { data: ins, error: insErr } = await sb.from('payments').insert([record]).select('id').single();
      if (insErr) {
        if (insErr.code === '23505') {
          const { data: again } = await sb.from('payments').select('id,user_id').eq('imp_uid', imp_uid).maybeSingle();
          if (!again || again.user_id !== uid) return json(409, { success: false, message: '결제 기록을 확인할 수 없습니다. 관리자에게 문의해 주세요.' });
          payId = again.id;
        } else {
          console.error('interior payment insert failed', imp_uid, insErr.message);
          return json(500, { success: false, message: '결제 기록 저장에 실패했습니다. 결제 번호(' + imp_uid + ')로 문의해 주세요.' });
        }
      } else payId = ins.id;
      if (!(await grantCredits(sb, uid, payId, p.credits, p.source))) {
        return json(500, { success: false, message: '이용권 적립에 실패했어요. 결제 번호(' + imp_uid + ')로 문의해 주시면 바로 처리해 드릴게요.' });
      }
      return json(200, { success: true, plan, granted: p.credits, credits: await creditStatus(sb, uid) });
    }

    return json(400, { success: false, message: '알 수 없는 요청입니다.' });
  } catch (e) {
    console.error('interior-order error', e);
    return json(500, { success: false, message: '서버 오류가 발생했습니다.' });
  }
};

serveNetlifyHandler(handler);
