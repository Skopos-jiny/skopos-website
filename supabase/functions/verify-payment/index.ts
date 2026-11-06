// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { process, serveNetlifyHandler } from './adapter.ts';

// netlify/functions/verify-payment.js
// PortOne V1 + NHN KCP payment verification with Supabase coupon validation.


const BASE_AMOUNT = 29900;
const ORDER_NAME = 'SKOPOS SDTI 정밀 검사';
// 커플 진단: 2인 정밀 검사 + 커플 결과지 2부
const COUPLE_AMOUNT = 49900;
const COUPLE_ORDER_NAME = 'SKOPOS SDTI 커플 진단 (2인)';

function makeCoupleCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
const SITE_ORIGIN = 'https://skopos.kr';

// 커플 진단 초대 코드: 같은 결제(imp_uid)에 이미 있으면 그대로, 없으면 새로 발급
async function ensureCoupleCode(sb, impUid, merchantUid, ownerId) {
  const { data: existing } = await sb.from('couples').select('code').eq('imp_uid', impUid).maybeSingle();
  if (existing?.code) return existing.code;
  for (let i = 0; i < 5; i++) {
    const code = makeCoupleCode();
    const { error: cErr } = await sb.from('couples').insert([{ code, owner_id: ownerId, imp_uid: impUid, merchant_uid: merchantUid }]);
    if (!cErr) return code;
    console.error('couples insert failed:', cErr.message);
  }
  return null;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': SITE_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

// Authorization: Bearer <supabase access_token> 에서 사용자 확인.
// 토큰이 유효하면 그 사용자의 id를 반환하고, body 의 user_id 는 무시한다.
// (클라이언트가 보낸 user_id 는 위조 가능하므로 신뢰하지 않는다)
async function resolveUserId(sb, event, bodyUserId) {
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token) {
    const { data, error } = await sb.auth.getUser(token);
    if (!error && data?.user?.id) return { userId: data.user.id, verified: true };
    // 토큰이 왔는데 유효하지 않으면 명시적으로 거부
    return { userId: null, verified: false, invalidToken: true };
  }
  // 토큰이 없으면 레거시 호환: body 값을 미검증 상태로 사용
  return { userId: bodyUserId || null, verified: false };
}

function calculateDiscount(coupon, originalAmount) {
  if (!coupon) return 0;

  let discount = 0;
  if (coupon.discount_type === 'fixed') {
    discount = Number(coupon.discount_value || 0);
  }

  if (coupon.discount_type === 'percent') {
    discount = Math.floor(originalAmount * Number(coupon.discount_value || 0) / 100);
    if (coupon.max_discount_amount) {
      discount = Math.min(discount, Number(coupon.max_discount_amount));
    }
  }

  return Math.max(0, Math.min(discount, originalAmount));
}

async function getValidCoupon(sb, couponCode, originalAmount, userId) {
  const code = String(couponCode || '').trim().toUpperCase();
  if (!code) {
    return {
      coupon: null,
      original_amount: originalAmount,
      discount_amount: 0,
      final_amount: originalAmount,
    };
  }

  const { data: coupon, error } = await sb
    .from('coupons')
    .select('*')
    .eq('code', code)
    .maybeSingle();

  if (error) throw new Error('쿠폰 조회 중 오류가 발생했습니다.');
  if (!coupon) throw new Error('존재하지 않는 쿠폰입니다.');
  if (!coupon.is_active) throw new Error('사용할 수 없는 쿠폰입니다.');

  const now = new Date();
  if (coupon.starts_at && new Date(coupon.starts_at) > now) {
    throw new Error('아직 사용할 수 없는 쿠폰입니다.');
  }
  if (coupon.expires_at && new Date(coupon.expires_at) < now) {
    throw new Error('만료된 쿠폰입니다.');
  }
  if (coupon.min_order_amount && originalAmount < Number(coupon.min_order_amount)) {
    throw new Error('쿠폰 최소 결제 금액을 충족하지 않습니다.');
  }
  if (coupon.usage_limit && Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) {
    throw new Error('쿠폰 사용 가능 횟수가 모두 소진되었습니다.');
  }

  if (userId && coupon.per_user_limit) {
    const { count, error: countError } = await sb
      .from('coupon_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('coupon_code', code)
      .eq('user_id', userId);

    if (countError) throw new Error('쿠폰 사용 이력 확인 중 오류가 발생했습니다.');
    if (Number(count || 0) >= Number(coupon.per_user_limit)) {
      throw new Error('이미 사용한 쿠폰입니다.');
    }
  }

  const discountAmount = calculateDiscount(coupon, originalAmount);
  const finalAmount = originalAmount - discountAmount;

  return {
    coupon,
    original_amount: originalAmount,
    discount_amount: discountAmount,
    final_amount: finalAmount,
  };
}

async function cancelPayment(accessToken, impUid, reason) {
  try {
    const res = await fetch('https://api.iamport.kr/payments/cancel', {
      method: 'POST',
      headers: { Authorization: accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ imp_uid: impUid, reason }),
    });
    const data = await res.json();
    if (data.code !== 0) {
      // 취소 실패는 반드시 로그에 남겨 운영자가 수동 환불할 수 있게 한다
      console.error('PortOne cancel rejected:', impUid, reason, JSON.stringify(data));
      return false;
    }
    return true;
  } catch (err) {
    console.error('PortOne cancel failed:', impUid, reason, err);
    return false;
  }
}

const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method Not Allowed' });
  }

  try {
    const { imp_uid, merchant_uid, amount, coupon_code, name, email, phone, user_id, plan } = JSON.parse(event.body || '{}');
    const isCouple = plan === 'couple';
    const baseAmount = isCouple ? COUPLE_AMOUNT : BASE_AMOUNT;
    if (!imp_uid) return json(400, { success: false, message: 'imp_uid가 없습니다.' });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // 로그인 사용자 확인 (JWT 우선, 위조된 body user_id 차단)
    const auth = await resolveUserId(sb, event, user_id);
    if (auth.invalidToken) {
      return json(401, { success: false, message: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' });
    }
    const resolvedUserId = auth.userId;

    // 멱등성: 이미 기록된 결제(imp_uid)는 다시 검증·차감·취소하지 않는다.
    // 새로고침·중복 호출·재전송 때 쿠폰이 두 번 차감되거나, 쿠폰 재검증 실패·금액 불일치로
    // 이미 정상 처리된 결제가 자동 취소되는 일을 막는다.
    const { data: existingPay, error: existingErr } = await sb
      .from('payments')
      .select('id,user_id,status,order_name,merchant_uid,amount,original_amount,discount_amount,final_amount,coupon_code')
      .eq('imp_uid', imp_uid)
      .maybeSingle();
    if (existingErr) console.error('existing payment lookup failed:', imp_uid, existingErr.message);
    if (existingPay) {
      if (existingPay.user_id && resolvedUserId && existingPay.user_id !== resolvedUserId) {
        console.error('verify-payment: imp_uid already recorded for another user', imp_uid);
        return json(409, { success: false, message: '이미 다른 계정으로 처리된 결제입니다. 관리자에게 문의해 주세요.' });
      }
      if (existingPay.status === 'cancelled') {
        return json(400, { success: false, message: '취소된 결제입니다.' });
      }
      const wasCouple = /커플/.test(existingPay.order_name || '');
      let existingCode = null;
      if (wasCouple && existingPay.user_id) {
        existingCode = await ensureCoupleCode(sb, imp_uid, existingPay.merchant_uid || merchant_uid, existingPay.user_id);
      }
      return json(200, {
        success: true,
        already: true,
        plan: wasCouple ? 'couple' : 'single',
        couple_code: existingCode,
        imp_uid,
        amount: existingPay.amount,
        original_amount: existingPay.original_amount,
        discount_amount: existingPay.discount_amount,
        final_amount: existingPay.final_amount,
        coupon_code: existingPay.coupon_code || '',
        payment_id: existingPay.id,
      });
    }

    const tokenRes = await fetch('https://api.iamport.kr/users/getToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imp_key: process.env.PORTONE_IMP_KEY,
        imp_secret: process.env.PORTONE_IMP_SECRET,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.code !== 0) {
      return json(400, { success: false, message: '포트원 인증에 실패했습니다.' });
    }
    const accessToken = tokenData.response.access_token;

    const payRes = await fetch(`https://api.iamport.kr/payments/${imp_uid}`, {
      headers: { Authorization: accessToken },
    });
    const payData = await payRes.json();
    if (payData.code !== 0) {
      return json(400, { success: false, message: '결제 정보를 조회하지 못했습니다.' });
    }
    const payment = payData.response;

    if (payment.status !== 'paid') {
      return json(400, { success: false, message: `결제가 완료되지 않았습니다. (${payment.status})` });
    }

    // 쿠폰 사용은 JWT 로 검증된 로그인 사용자에게만 허용.
    // 토큰 없는 레거시 경로에서 미검증(또는 생략된) user_id 로
    // per_user_limit 검사를 우회하는 것을 차단한다.
    // 결제는 이미 확정된 상태이므로 거부 시 자동 취소를 동반한다.
    if (isCouple && (!auth.verified || String(coupon_code || '').trim())) {
      await cancelPayment(accessToken, imp_uid, '커플 진단 조건 불충족(로그인 필요·쿠폰 불가)');
      return json(400, { success: false, message: '커플 진단은 로그인 후 쿠폰 없이 결제할 수 있어요. 결제를 자동 취소했습니다.' });
    }

    if (String(coupon_code || '').trim() && !auth.verified) {
      console.error('Coupon payment without verified user:', imp_uid, coupon_code);
      await cancelPayment(accessToken, imp_uid, '쿠폰 결제 로그인 검증 실패');
      return json(401, { success: false, message: '쿠폰 사용에는 로그인이 필요합니다. 결제를 자동 취소했으니 로그인 후 다시 시도해 주세요.' });
    }

    // 쿠폰 재검증: 결제는 이미 완료된 상태이므로, 여기서 실패하면
    // 반드시 자동 취소해야 한다 (돈만 빠지고 기록·이용권이 없는 상태 방지)
    let couponResult;
    try {
      couponResult = await getValidCoupon(sb, coupon_code, baseAmount, resolvedUserId);
    } catch (couponErr) {
      console.error('Coupon revalidation failed after payment:', imp_uid, couponErr.message);
      await cancelPayment(accessToken, imp_uid, '쿠폰 검증 실패: ' + couponErr.message);
      return json(400, { success: false, message: '쿠폰 검증에 실패하여 결제를 자동 취소했습니다. (' + couponErr.message + ')' });
    }
    const expectedAmount = couponResult.final_amount;
    const clientAmount = Number(amount || 0);

    if (clientAmount !== expectedAmount || payment.amount !== expectedAmount) {
      console.error('Amount mismatch:', {
        clientAmount,
        expectedAmount,
        paidAmount: payment.amount,
        coupon_code,
      });
      await cancelPayment(accessToken, imp_uid, '결제 금액 검증 실패');
      return json(400, { success: false, message: '결제 금액이 일치하지 않아 자동 취소했습니다.' });
    }

    const paymentRecord = {
      imp_uid,
      merchant_uid,
      pg: 'NHN KCP',
      amount: payment.amount,
      original_amount: couponResult.original_amount,
      discount_amount: couponResult.discount_amount,
      final_amount: couponResult.final_amount,
      coupon_code: couponResult.coupon?.code || null,
      buyer_name: name || payment.buyer_name || '',
      buyer_email: email || payment.buyer_email || '',
      buyer_phone: phone || payment.buyer_tel || '',
      status: 'paid',
      paid_at: new Date(payment.paid_at * 1000).toISOString(),
      order_name: isCouple ? COUPLE_ORDER_NAME : ORDER_NAME,
    };

    let supabasePaymentId = null;
    const { data: sbData, error: sbErr } = await sb
      .from('payments')
      .insert([{ ...paymentRecord, user_id: resolvedUserId || null }])
      .select('id')
      .single();

    // 동시에 두 번 호출되어 다른 요청이 먼저 기록한 경우(imp_uid 중복)는
    // 쿠폰 차감·외부 기록을 반복하지 않는다
    const duplicateInsert = !!(sbErr && sbErr.code === '23505');
    if (sbErr) {
      if (duplicateInsert) {
        const { data: recorded, error: lookupError } = await sb.from('payments')
          .select('id,user_id,status').eq('imp_uid', imp_uid).maybeSingle();
        if (lookupError || !recorded || recorded.status !== 'paid' ||
            recorded.user_id !== (resolvedUserId || null)) {
          return json(409, { success: false, message: '결제 기록을 확인할 수 없습니다. 관리자에게 문의해 주세요.' });
        }
        supabasePaymentId = recorded.id;
      } else {
        console.error('Supabase payments insert failed:', sbErr);
        if (sbErr.code === 'P0001' && couponResult.coupon) {
          const cancelled = await cancelPayment(accessToken, imp_uid, '쿠폰 사용 한도 또는 유효기간 변경');
          return json(cancelled ? 400 : 500, { success: false, message: cancelled
            ? '쿠폰을 사용할 수 없어 결제를 자동 취소했습니다.'
            : '쿠폰 처리와 결제 취소에 실패했습니다. 관리자에게 결제 내역 확인을 요청해 주세요.' });
        }
        return json(500, { success: false, message: '결제 기록 저장에 실패했습니다. 다시 확인해 주세요. 문제가 계속되면 관리자에게 문의해 주세요.' });
      }
    } else {
      supabasePaymentId = sbData?.id || null;
    }

    // payments 트리거가 쿠폰 이력과 사용 횟수를 원자적으로 기록한다.

    try {
      if (!duplicateInsert && process.env.AIRTABLE_BASE && process.env.AIRTABLE_TOKEN) {
        const atRes = await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE}/payments`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: paymentRecord }),
        });
        const atData = await atRes.json();
        // 스키마 불일치(UNKNOWN_FIELD_NAME 등)가 침묵되지 않도록 로깅
        if (atData.error) console.error('Airtable payments insert error:', JSON.stringify(atData.error));
      }
    } catch (atEx) {
      console.error('Airtable insert failed:', atEx);
    }

    // 커플 진단: 파트너 초대 코드 발급
    let coupleCode = null;
    if (isCouple && resolvedUserId) {
      coupleCode = await ensureCoupleCode(sb, imp_uid, merchant_uid, resolvedUserId);
    }

    return json(200, {
      success: true,
      plan: isCouple ? 'couple' : 'single',
      couple_code: coupleCode,
      imp_uid,
      amount: payment.amount,
      original_amount: couponResult.original_amount,
      discount_amount: couponResult.discount_amount,
      final_amount: couponResult.final_amount,
      coupon_code: couponResult.coupon?.code || '',
      payment_id: supabasePaymentId,
    });
  } catch (err) {
    console.error('verify-payment error:', err);
    return json(500, { success: false, message: err.message || '서버 오류가 발생했습니다.' });
  }
};

serveNetlifyHandler(handler);
