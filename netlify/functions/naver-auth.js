// netlify/functions/naver-auth.js
// 네이버 OAuth 코드 → 토큰 교환 → 네이버 프로필 조회 → Supabase 사용자 생성/조회
// 주의: Supabase Admin API에는 createSession()이 없으므로 세션 토큰을 만들지 않고 사용자 정보를 반환합니다.

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://skopos.kr',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        message: 'POST 요청만 허용됩니다.',
      }),
    };
  }

  try {
    const { code, redirect_uri } = JSON.parse(event.body || '{}');

    if (!code || !redirect_uri) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: 'code 또는 redirect_uri가 없습니다.',
        }),
      };
    }

    if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          message: '네이버 환경변수가 설정되지 않았습니다.',
        }),
      };
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          message: 'Supabase 환경변수가 설정되지 않았습니다.',
        }),
      };
    }

    // 1. 네이버 토큰 발급
    const tokenRes = await fetch(
      'https://nid.naver.com/oauth2.0/token?' +
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: process.env.NAVER_CLIENT_ID,
          client_secret: process.env.NAVER_CLIENT_SECRET,
          code,
          redirect_uri,
        })
    );

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: '네이버 토큰 발급 실패',
          detail: tokenData,
        }),
      };
    }

    // 2. 네이버 사용자 정보 조회
    const profileRes = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: {
        Authorization: 'Bearer ' + tokenData.access_token,
      },
    });

    const profileData = await profileRes.json();
    const profile = profileData.response;

    if (!profileRes.ok || !profile) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: '네이버 프로필 조회 실패',
          detail: profileData,
        }),
      };
    }

    const email = profile.email;
    const name = profile.name || profile.nickname || '네이버 사용자';
    const naverId = 'naver_' + profile.id;
    const avatarUrl = profile.profile_image || '';

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: '네이버 계정에서 이메일을 가져오지 못했습니다.',
        }),
      };
    }

    // 3. Supabase Admin Client 생성
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // 4. 기존 사용자 확인
    // 작은 규모에서는 listUsers로 충분합니다. 사용자가 많아지면 별도 profiles 테이블 조회 방식으로 바꾸는 것을 권장합니다.
    const { data: existingUsers, error: listErr } = await supabase.auth.admin.listUsers();

    if (listErr) {
      throw listErr;
    }

    let user = existingUsers?.users?.find((u) => u.email === email);

    // 5. 신규 사용자 생성
    if (!user) {
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          full_name: name,
          name,
          provider: 'naver',
          naver_id: naverId,
          avatar_url: avatarUrl,
        },
        app_metadata: {
          provider: 'naver',
        },
      });

      if (createErr) {
        throw createErr;
      }

      user = newUser.user;
    } else {
      // 기존 사용자라면 네이버 프로필 정보를 최신 상태로 업데이트합니다.
      const { data: updatedUser, error: updateErr } = await supabase.auth.admin.updateUserById(
        user.id,
        {
          user_metadata: {
            ...(user.user_metadata || {}),
            full_name: name,
            name,
            provider: 'naver',
            naver_id: naverId,
            avatar_url: avatarUrl,
          },
          app_metadata: {
            ...(user.app_metadata || {}),
            provider: 'naver',
          },
        }
      );

      if (!updateErr && updatedUser?.user) {
        user = updatedUser.user;
      }
    }

    // 6. createSession()은 존재하지 않으므로 호출하지 않습니다.
    // 프론트엔드는 아래 user 값을 localStorage/sessionStorage 등에 저장해서 로그인 상태로 사용하세요.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name,
          provider: 'naver',
          naver_id: naverId,
          avatar_url: avatarUrl,
        },
      }),
    };
  } catch (err) {
    console.error('naver-auth 오류:', err);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: err.message || '서버 오류가 발생했습니다.',
      }),
    };
  }
};
