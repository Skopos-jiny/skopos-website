// netlify/functions/verify-payment.js
// 포트원 V2 + NHN KCP 결제 검증
// 배포 위치: /netlify/functions/verify-payment.js

exports.handler = async (event) => {
  // CORS
  const headers = {
    'Access-Control-Allow-Origin': 'https://skopos.kr',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: 'Method Not Allowed' }) };
  }

  try {
    const { paymentId, amount } = JSON.parse(event.body);

    if (!paymentId) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'paymentId 누락' }) };
    }

    // ── 1. 포트원 V2 API 시크릿으로 결제 조회 ──────────────────
    // 환경변수: PORTONE_V2_API_SECRET (포트원 콘솔 > 연동 정보 > API Keys)
    const payRes = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
      headers: {
        'Authorization': `PortOne ${process.env.PORTONE_V2_API_SECRET}`,
      },
    });

    if (!payRes.ok) {
      const errText = await payRes.text();
      console.error('포트원 결제 조회 실패:', errText);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, message: '결제 정보 조회 실패' }),
      };
    }

    const payment = await payRes.json();

    // ── 2. 결제 상태 검증 ──────────────────────────────────────
    if (payment.status !== 'PAID') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, message: `결제 미완료 (상태: ${payment.status})` }),
      };
    }

    // ── 3. 금액 위변조 검증 (핵심!) ───────────────────────────
    const paidAmount = payment.amount?.total;
    if (paidAmount !== 9900) {
      console.error(`금액 불일치: 기대=${9900}, 실제=${paidAmount}`);
      // 금액 불일치 시 포트원 V2로 결제 취소 요청
      await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `PortOne ${process.env.PORTONE_V2_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: '결제 금액 위변조 감지' }),
      });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, message: '결제 금액 불일치 — 자동 취소 처리됨' }),
      };
    }

    // ── 4. 웹훅 중복 처리 방지 (Airtable에 이미 저장된 건인지 확인) ──
    // 필요 시 Airtable 조회 로직 추가

    // ── 5. Airtable에 결제 기록 저장 ──────────────────────────
    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE}/payments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            payment_id:   paymentId,
            pg:           'NHN KCP',
            amount:       paidAmount,
            buyer_name:   payment.customer?.fullName  || '',
            buyer_email:  payment.customer?.email     || '',
            buyer_phone:  payment.customer?.phoneNumber || '',
            status:       'PAID',
            paid_at:      payment.paidAt || new Date().toISOString(),
            order_name:   payment.orderName || 'SKOPOS 정밀 공간 취향 진단',
          },
        }),
      }
    );

    if (!airtableRes.ok) {
      console.error('Airtable 저장 실패:', await airtableRes.text());
      // Airtable 저장 실패해도 결제는 성공으로 처리
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        paymentId,
        amount: paidAmount,
        message: '결제 검증 완료',
      }),
    };

  } catch (err) {
    console.error('검증 함수 오류:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, message: '서버 오류: ' + err.message }),
    };
  }
};
