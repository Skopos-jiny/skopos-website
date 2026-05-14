// netlify/functions/naver-auth.js
// 네이버 OAuth 코드 → 토큰 교환 → Supabase 사용자 생성/로그인

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://skopos.kr',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers, body: JSON.stringify({ success: false }) };

  try {
    const { code, redirect_uri } = JSON.parse(event.body);

    // 1. 네이버 토큰 발급
    const tokenRes = await fetch('https://nid.naver.com/oauth2.0/token?' + new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     process.env.NAVER_CLIENT_ID,
      client_secret: process.env.NAVER_CLIENT_SECRET,
      code,
      redirect_uri,
    }));
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token)
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: '네이버 토큰 발급 실패' }) };

    // 2. 네이버 사용자 정보 조회
    const profileRes = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
    });
    const profileData = await profileRes.json();
    const profile = profileData.response;
    if (!profile)
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: '네이버 프로필 조회 실패' }) };

    const email    = profile.email;
    const name     = profile.name || profile.nickname || '네이버 사용자';
    const naverId  = 'naver_' + profile.id;

    // 3. Supabase Admin으로 사용자 생성 또는 조회
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY  // Service Role Key (비공개)
    );

    // 기존 사용자 확인
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    let user = existingUsers?.users?.find(u => u.email === email);

    if (!user) {
      // 신규 사용자 생성
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          full_name:   name,
          provider:    'naver',
          naver_id:    naverId,
          avatar_url:  profile.profile_image || '',
        },
      });
      if (createErr) throw createErr;
      user = newUser.user;
    }

    // 4. 해당 사용자로 세션 생성
    const { data: sessionData, error: sessionErr } = await supabase.auth.admin.createSession({
      user_id: user.id,
    });
    if (sessionErr) throw sessionErr;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:       true,
        access_token:  sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
      }),
    };

  } catch (err) {
    console.error('naver-auth 오류:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: err.message }) };
  }
};
