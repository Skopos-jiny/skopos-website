// ═══════════════════════════════════════════════════
// SKOPOS — Airtable 참여자 저장 함수 v2
// ═══════════════════════════════════════════════════

exports.handler = async (event) => {

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE  = process.env.AIRTABLE_BASE;
  const TABLE = process.env.AIRTABLE_TABLE;

  if (!TOKEN || !BASE || !TABLE) {
    console.error('[SKOPOS] 환경변수 누락:', { TOKEN: !!TOKEN, BASE: !!BASE, TABLE: !!TABLE });
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: '환경변수 미설정', detail: { TOKEN: !!TOKEN, BASE: !!BASE, TABLE: !!TABLE } }),
    };
  }

  try {
    const raw = JSON.parse(event.body);

    // ★ Airtable 필드명 매핑 (한글 필드명 기준)
    const fields = {};
    const MAP = {
      name:              '이름',
      email:             '이메일',
      phone:             '연락처',
      quiz_type:         '퀴즈종류',
      result_type:       '진단유형',
      result_group:      '유형그룹',
      marketing_consent: '마케팅동의',
      score_sensory:     '감각처리',
      score_safety:      '안전회복',
      score_social:      '사회연결',
      score_identity:    '자아표현',
      score_aesthetic:   '미적감수성',
      score_control:     '공간통제',
      score_nature:      '자연친화',
      score_lifestyle:   '삶의방식',
      participated_at:   '참여일시',
    };

    Object.entries(MAP).forEach(([eng, kor]) => {
      if (raw[eng] !== undefined && raw[eng] !== '') {
        fields[kor] = raw[eng];
      }
    });

    console.log('[SKOPOS] 저장 필드:', JSON.stringify(fields));

    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });

    const data = await res.json();
    console.log('[SKOPOS] 응답:', JSON.stringify(data));

    if (data.error) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: data.error.message || JSON.stringify(data.error) }) };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, id: data.id }) };

  } catch (err) {
    console.error('[SKOPOS] 오류:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
