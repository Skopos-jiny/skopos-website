// netlify/functions/validate-coupon.js
// Checks a coupon before opening the payment window.

const { createClient } = require('@supabase/supabase-js');

const BASE_AMOUNT = 9900;
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method Not Allowed' });
  }

  try {
    const { coupon_code, amount, user_id } = JSON.parse(event.body || '{}');
    const code = String(coupon_code || '').trim().toUpperCase();
    const originalAmount = Number(amount || BASE_AMOUNT);

    if (!code) {
      return json(400, { success: false, message: '쿠폰 코드를 입력해주세요.' });
    }

    if (originalAmount !== BASE_AMOUNT) {
      return json(400, { success: false, message: '결제 금액이 올바르지 않습니다.' });
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // JWT 가 있으면 검증된 사용자 id 로 대체 (per_user_limit 판정 정확도 향상)
    let resolvedUserId = user_id || null;
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token) {
      const { data: userData, error: userError } = await sb.auth.getUser(token);
      if (!userError && userData?.user?.id) resolvedUserId = userData.user.id;
    }

    const { data: coupon, error } = await sb
      .from('coupons')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (error) {
      console.error('Coupon select failed:', error);
      return json(500, { success: false, message: '쿠폰 조회 중 오류가 발생했습니다.' });
    }

    if (!coupon) {
      return json(404, { success: false, message: '존재하지 않는 쿠폰입니다.' });
    }

    if (!coupon.is_active) {
      return json(400, { success: false, message: '사용할 수 없는 쿠폰입니다.' });
    }

    const now = new Date();
    if (coupon.starts_at && new Date(coupon.starts_at) > now) {
      return json(400, { success: false, message: '아직 사용할 수 없는 쿠폰입니다.' });
    }

    if (coupon.expires_at && new Date(coupon.expires_at) < now) {
      return json(400, { success: false, message: '만료된 쿠폰입니다.' });
    }

    if (coupon.min_order_amount && originalAmount < Number(coupon.min_order_amount)) {
      return json(400, { success: false, message: '쿠폰 최소 결제 금액을 충족하지 않습니다.' });
    }

    if (coupon.usage_limit && Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) {
      return json(400, { success: false, message: '쿠폰 사용 가능 횟수가 모두 소진되었습니다.' });
    }

    if (resolvedUserId && coupon.per_user_limit) {
      const { count, error: countError } = await sb
        .from('coupon_redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('coupon_code', code)
        .eq('user_id', resolvedUserId);

      if (countError) {
        console.error('Coupon redemption count failed:', countError);
        return json(500, { success: false, message: '쿠폰 사용 이력 확인 중 오류가 발생했습니다.' });
      }

      if (Number(count || 0) >= Number(coupon.per_user_limit)) {
        return json(400, { success: false, message: '이미 사용한 쿠폰입니다.' });
      }
    }

    const discountAmount = calculateDiscount(coupon, originalAmount);
    const finalAmount = originalAmount - discountAmount;

    return json(200, {
      success: true,
      original_amount: originalAmount,
      discount_amount: discountAmount,
      final_amount: finalAmount,
      coupon: {
        code: coupon.code,
        name: coupon.name,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
      },
    });
  } catch (err) {
    console.error('validate-coupon error:', err);
    return json(500, { success: false, message: err.message || '서버 오류가 발생했습니다.' });
  }
};
