// netlify/functions/verify-payment.js
// 포트원 V1 + NHN KCP 결제 검증 + Supabase/Airtable 동시 저장

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://skopos.kr',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: 'Method Not Allowed' }) };

  try {
    const { imp_uid, merchant_uid, amount, name, email, phone, user_id } = JSON.parse(event.body);
    if (!imp_uid)
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'imp_uid 누락' }) };

    // ── 1. 포트원 V1 액세스 토큰 ──────────────────────────────
    const tokenRes = await fetch('https://api.iamport.kr/users/getToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imp_key:    process.env.PORTONE_IMP_KEY,
        imp_secret: process.env.PORTONE_IMP_SECRET,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.code !== 0)
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: '포트원 인증 실패' }) };
    const accessToken = tokenData.response.access_token;

    // ── 2. 결제 정보 조회 ──────────────────────────────────────
    const payRes  = await fetch(`https://api.iamport.kr/payments/${imp_uid}`, {
      headers: { Authorization: accessToken },
    });
    const payData = await payRes.json();
    if (payData.code !== 0)
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: '결제 정보 조회 실패' }) };
    const payment = payData.response;

    // ── 3. 결제 상태 확인 ──────────────────────────────────────
    if (payment.status !== 'paid')
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: `결제 미완료 (${payment.status})` }) };

    // ── 4. 금액 위변조 검증 (핵심!) ───────────────────────────
    if (payment.amount !== 9900) {
      console.error(`금액 불일치: 기대=9900, 실제=${payment.amount}`);
      await fetch('https://api.iamport.kr/payments/cancel', {
        method: 'POST',
        headers: { Authorization: accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ imp_uid, reason: '금액 위변조 감지' }),
      });
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: '금액 불일치 — 자동 취소됨' }) };
    }

    const paymentRecord = {
      imp_uid,
      merchant_uid,
      pg:          'NHN KCP',
      amount:      payment.amount,
      buyer_name:  name  || payment.buyer_name  || '',
      buyer_email: email || payment.buyer_email || '',
      buyer_phone: phone || payment.buyer_tel   || '',
      status:      'paid',
      paid_at:     new Date(payment.paid_at * 1000).toISOString(),
      order_name:  'SKOPOS SDTI 정밀 검사',
    };

    // ── 5. Supabase payments 테이블 저장 ──────────────────────
    let supabasePaymentId = null;
    try {
      const sb = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
      );
      const insertData = {
        ...paymentRecord,
        user_id: user_id || null,
      };
      const { data: sbData, error: sbErr } = await sb
        .from('payments')
        .insert([insertData])
        .select('id')
        .single();
      if (sbErr) {
        console.error('Supabase payments 저장 실패:', sbErr);
      } else {
        supabasePaymentId = sbData?.id;
        console.log('Supabase payments 저장 성공:', supabasePaymentId);
      }
    } catch (sbEx) {
      console.error('Supabase 연결 오류:', sbEx);
    }

    // ── 6. Airtable 결제 기록 저장 (백업) ─────────────────────
    try {
      await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: paymentRecord }),
      });
    } catch (atEx) {
      console.error('Airtable 저장 오류:', atEx);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:    true,
        imp_uid,
        amount:     payment.amount,
        payment_id: supabasePaymentId,
      }),
    };
  } catch (err) {
    console.error('검증 함수 오류:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: '서버 오류: ' + err.message }) };
  }
};
