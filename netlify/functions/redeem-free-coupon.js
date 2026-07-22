// netlify/functions/redeem-free-coupon.js
// 100% 할인(최종 ₩0) 쿠폰 전용 발급 함수.
// PG 결제가 없는 무료 쿠폰을 서버에서 재검증한 뒤, 결제 없이 정밀 검사 이용권을 발급합니다.
// 클라이언트가 보낸 금액은 신뢰하지 않고 서버가 쿠폰을 다시 계산해 final_amount === 0 만 통과시킵니다.

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
  if (!code) throw new Error('쿠폰 코드가 없습니다.');

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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method Not Allowed' });
  }

  try {
    const { coupon_code, name, email, phone } = JSON.parse(event.body || '{}');

    if (!coupon_code) {
      return json(400, { success: false, message: '쿠폰 코드가 없습니다.' });
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // 무료 발급은 로그인 사용자만 가능. body 의 user_id 는 위조 가능하므로
    // 반드시 Authorization 헤더의 Supabase JWT 로 사용자를 확인한다.
    // (미검증 user_id 를 허용하면 가짜 id 를 돌려가며 per_user_limit 을 우회할 수 있음)
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return json(401, { success: false, message: '로그인이 필요합니다.' });
    }
    const { data: userData, error: userError } = await sb.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      return json(401, { success: false, message: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' });
    }
    const user_id = userData.user.id;

    // 멱등성: 이미 이용권(결제 또는 무료 발급)이 있는 사용자는
    // 중복 발급 없이 성공으로 응답한다 (반복 호출로 인한 행 남발 방지)
    const { data: existing, error: existingErr } = await sb
      .from('payments')
      .select('id')
      .eq('user_id', user_id)
      .in('status', ['paid', 'free'])
      .limit(1);
    if (!existingErr && existing && existing.length) {
      return json(200, {
        success: true,
        free: true,
        already: true,
        message: '이미 이용권이 있습니다.',
        amount: 0,
        payment_id: existing[0].id,
      });
    }

    // 서버가 쿠폰을 다시 계산. 클라이언트 금액은 신뢰하지 않는다.
    const couponResult = await getValidCoupon(sb, coupon_code, BASE_AMOUNT, user_id);

    // 이 함수는 오직 최종 0원 쿠폰만 처리한다. 0원이 아니면 카드 결제 경로로 보낸다.
    if (couponResult.final_amount !== 0) {
      return json(400, {
        success: false,
        message: '무료 발급 대상 쿠폰이 아닙니다. 카드 결제를 진행해 주세요.',
        final_amount: couponResult.final_amount,
        requires_payment: true,
      });
    }

    const merchantUid = 'SKOPOS-FREE-' + Date.now();

    const paymentRecord = {
      imp_uid: null,
      merchant_uid: merchantUid,
      pg: 'FREE_COUPON',
      amount: 0,
      original_amount: couponResult.original_amount,
      discount_amount: couponResult.discount_amount,
      final_amount: 0,
      coupon_code: couponResult.coupon.code,
      buyer_name: name || '',
      buyer_email: email || '',
      buyer_phone: phone || '',
      status: 'free',
      paid_at: new Date().toISOString(),
      order_name: ORDER_NAME,
    };

    let supabasePaymentId = null;
    const { data: sbData, error: sbErr } = await sb
      .from('payments')
      .insert([{ ...paymentRecord, user_id }])
      .select('id')
      .single();

    if (sbErr) {
      console.error('Supabase payments insert failed (free):', sbErr);
      return json(500, { success: false, message: '발급 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
    }
    supabasePaymentId = sbData?.id || null;

    const { error: redemptionError } = await sb.from('coupon_redemptions').insert([{
      coupon_code: couponResult.coupon.code,
      user_id,
      imp_uid: null,
      merchant_uid: merchantUid,
      original_amount: couponResult.original_amount,
      discount_amount: couponResult.discount_amount,
      final_amount: 0,
    }]);

    if (redemptionError) {
      console.error('Coupon redemption insert failed (free):', redemptionError);
    }

    const { error: updateCouponError } = await sb
      .from('coupons')
      .update({ used_count: Number(couponResult.coupon.used_count || 0) + 1 })
      .eq('code', couponResult.coupon.code);

    if (updateCouponError) {
      console.error('Coupon used_count update failed (free):', updateCouponError);
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
        if (atData.error) console.error('Airtable payments insert error (free):', JSON.stringify(atData.error));
      }
    } catch (atEx) {
      console.error('Airtable insert failed (free):', atEx);
    }

    return json(200, {
      success: true,
      free: true,
      merchant_uid: merchantUid,
      amount: 0,
      original_amount: couponResult.original_amount,
      discount_amount: couponResult.discount_amount,
      final_amount: 0,
      coupon_code: couponResult.coupon.code,
      payment_id: supabasePaymentId,
    });
  } catch (err) {
    console.error('redeem-free-coupon error:', err);
    return json(500, { success: false, message: err.message || '서버 오류가 발생했습니다.' });
  }
};
