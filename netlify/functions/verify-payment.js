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
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
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
    await fetch('https://api.iamport.kr/payments/cancel', {
      method: 'POST',
      headers: { Authorization: accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ imp_uid: impUid, reason }),
    });
  } catch (err) {
    console.error('PortOne cancel failed:', err);
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

    const couponResult = await getValidCoupon(sb, coupon_code, BASE_AMOUNT, user_id);
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
      .insert([{ ...paymentRecord, user_id: user_id || null }])
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
        user_id: user_id || null,
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
        await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE}/payments`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: paymentRecord }),
        });
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
