// netlify/functions/naver-auth.js
// 네이버 OAuth code -> 네이버 프로필 조회 -> Supabase 세션 발급

const { createClient } = require('@supabase/supabase-js');

const allowedOrigins = new Set([
  'https://skopos.kr',
  'https://www.skopos.kr',
  'https://skopos153.netlify.app',
]);

function json(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://skopos.kr',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

async function verifySupabaseOtp(supabase, email, linkData) {
  const props = linkData?.properties || {};
  const tokenHash = props.hashed_token || props.token_hash;
  const emailOtp = props.email_otp;
  const verificationType = props.verification_type || 'magiclink';

  const attempts = [];

  if (tokenHash) {
    attempts.push({ token_hash: tokenHash, type: verificationType });
    attempts.push({ token_hash: tokenHash, type: 'email' });
    attempts.push({ token_hash: tokenHash, type: 'magiclink' });
  }

  if (emailOtp) {
    attempts.push({ email, token: emailOtp, type: verificationType });
    attempts.push({ email, token: emailOtp, type: 'email' });
    attempts.push({ email, token: emailOtp, type: 'magiclink' });
  }

  let lastError = null;

  for (const params of attempts) {
    const { data, error } = await supabase.auth.verifyOtp(params);
    if (!error && data?.session?.access_token && data?.session?.refresh_token) {
      return data.session;
    }
    lastError = error;
  }

  throw lastError || new Error('Supabase 세션 생성 실패');
}

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';

  if (event.httpMethod === 'OPTIONS') {
    return json(200, { success: true }, origin);
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'POST 요청만 허용됩니다.' }, origin);
  }

  try {
    const {
      NAVER_CLIENT_ID,
      NAVER_CLIENT_SECRET,
      SUPABASE_URL,
      SUPABASE_SERVICE_KEY,
    } = process.env;

    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return json(500, {
        success: false,
        message: '서버 환경변수가 누락되었습니다.',
      }, origin);
    }

    const { code, state, redirect_uri } = JSON.parse(event.body || '{}');

    if (!code || !state || !redirect_uri) {
      return json(400, {
        success: false,
        message: '네이버 인증 정보가 누락되었습니다.',
      }, origin);
    }

    const tokenRes = await fetch('https://nid.naver.com/oauth2.0/token?' + new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: NAVER_CLIENT_ID,
      client_secret: NAVER_CLIENT_SECRET,
      code,
      state,
      redirect_uri,
    }));

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      return json(400, {
        success: false,
        message: tokenData.error_description || tokenData.error || '네이버 토큰 발급 실패',
      }, origin);
    }

    const profileRes = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const profileData = await profileRes.json();
    const profile = profileData.response;

    if (!profileRes.ok || !profile?.email) {
      return json(400, {
        success: false,
        message: '네이버 프로필 조회 실패',
      }, origin);
    }

    const email = profile.email;
    const name = profile.name || profile.nickname || '네이버 사용자';
    const metadata = {
      full_name: name,
      provider: 'naver',
      naver_id: profile.id ? `naver_${profile.id}` : '',
      avatar_url: profile.profile_image || '',
    };

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        data: metadata,
        redirectTo: redirect_uri,
      },
    });

    if (linkError) {
      throw linkError;
    }

    const session = await verifySupabaseOtp(supabase, email, linkData);

    if (session.user?.id) {
      await supabase.auth.admin.updateUserById(session.user.id, {
        user_metadata: metadata,
        email_confirm: true,
      });
    }

    return json(200, {
      success: true,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }, origin);
  } catch (err) {
    console.error('naver-auth error:', err);

    return json(500, {
      success: false,
      message: err.message || '네이버 로그인 처리 실패',
    }, origin);
  }
};
