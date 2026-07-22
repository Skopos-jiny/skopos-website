// netlify/functions/verify-payment.js
// PortOne V1 + NHN KCP payment verification with Supabase coupon validation.

const { createClient } = require('@supabase/supabase-js');

const BASE_AMOUNT = 9900;
const ORDER_NAME = 'SKOPOS SDTI 정밀 검사';
const SITE_ORIGIN = 'https://skopos.kr';

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
    }
  } catch (err) {
    console.error('PortOne cancel failed:', impUid, reason, err);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method Not Allowed' });
  }

  try {
    const { imp_uid, merchant_uid, amount, coupon_code, name, email, phone, user_id } = JSON.parse(event.body || '{}');
    if (!imp_uid) return json(400, { success: false, message: 'imp_uid가 없습니다.' });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // 로그인 사용자 확인 (JWT 우선, 위조된 body user_id 차단)
    const auth = await resolveUserId(sb, event, user_id);
    if (auth.invalidToken) {
      return json(401, { success: false, message: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' });
    }
    const resolvedUserId = auth.userId;

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
    if (String(coupon_code || '').trim() && !auth.verified) {
      console.error('Coupon payment without verified user:', imp_uid, coupon_code);
      await cancelPayment(accessToken, imp_uid, '쿠폰 결제 로그인 검증 실패');
      return json(401, { success: false, message: '쿠폰 사용에는 로그인이 필요합니다. 결제를 자동 취소했으니 로그인 후 다시 시도해 주세요.' });
    }

    // 쿠폰 재검증: 결제는 이미 완료된 상태이므로, 여기서 실패하면
    // 반드시 자동 취소해야 한다 (돈만 빠지고 기록·이용권이 없는 상태 방지)
    let couponResult;
    try {
      couponResult = await getValidCoupon(sb, coupon_code, BASE_AMOUNT, resolvedUserId);
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
      order_name: ORDER_NAME,
    };

    let supabasePaymentId = null;
    const { data: sbData, error: sbErr } = await sb
      .from('payments')
      .insert([{ ...paymentRecord, user_id: resolvedUserId || null }])
      .select('id')
      .single();

    if (sbErr) {
      console.error('Supabase payments insert failed:', sbErr);
    } else {
      supabasePaymentId = sbData?.id || null;
    }

    if (couponResult.coupon) {
      const { error: redemptionError } = await sb.from('coupon_redemptions').insert([{
        coupon_code: couponResult.coupon.code,
        user_id: resolvedUserId || null,
        imp_uid,
        merchant_uid,
        original_amount: couponResult.original_amount,
        discount_amount: couponResult.discount_amount,
        final_amount: couponResult.final_amount,
      }]);

      if (redemptionError) {
        console.error('Coupon redemption insert failed:', redemptionError);
      }

      const { error: updateCouponError } = await sb
        .from('coupons')
        .update({ used_count: Number(couponResult.coupon.used_count || 0) + 1 })
        .eq('code', couponResult.coupon.code);

      if (updateCouponError) {
        console.error('Coupon used_count update failed:', updateCouponError);
      }
    }

    try {
      if (process.env.AIRTABLE_BASE && process.env.AIRTABLE_TOKEN) {
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

    return json(200, {
      success: true,
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
