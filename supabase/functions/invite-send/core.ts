// @ts-nocheck
// invite-send 핵심 로직. Deno 와 분리해 두어 테스트할 수 있다.
//   action 'status' : 이메일 발송 준비 여부
//   action 'send'   : { client_id, email } 고객에게 검사 안내 메일 발송
export const SITE = 'https://skopos.kr';
const REASONS = {
  not_registered: '업체 정보 등록 후 이용할 수 있어요.',
  suspended: '이용이 중지된 업체예요.',
  not_found: '고객 항목을 찾지 못했어요.',
  not_sendable: '검사를 마쳤거나 취소한 고객에게는 보낼 수 없어요.',
  daily_limit: '오늘 보낼 수 있는 메일을 모두 보냈어요. 내일 다시 시도하거나 링크를 복사해 전달해 주세요.',
  client_limit: '이 고객에게는 하루 3번까지만 보낼 수 있어요.',
};
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function validEmail(e) {
  return typeof e === 'string' && e.length <= 120 && /^[^\s@<>(),;:"\\]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(e);
}
export function maskEmail(e) {
  const [u, d] = e.split('@');
  return u.slice(0, Math.min(2, Math.max(1, u.length - 1))) + '***@' + d;
}
const TESTS = {
  interior: { path: '/interior-beta?i=', name: 'SDTI 인테리어 공간욕구검사', subject: '인테리어 공간욕구검사', info: '56문항, 15분 안팎이에요.' },
  premium: { path: '/skopos_premium_quiz.html?i=', name: 'SDTI 정밀검사', subject: 'SDTI 정밀검사', info: '8개 영역 144문항이에요.' },
};
export function buildMail(businessName, code, testType) {
  const t = TESTS[testType] || TESTS.interior;
  const link = SITE + t.path + encodeURIComponent(code);
  const name = String(businessName || '').replace(/[\r\n]+/g, ' ').trim();
  const note = '고객님이 따로 결제하실 것은 없고, 결과는 동의하신 범위에서 상담 준비에만 쓰여요.';
  const subject = '[스코포스] ' + name + '에서 보낸 ' + t.subject + ' 안내';
  const text = name + '에서 상담 전에 ' + t.name + '를 요청했어요.\n\n'
    + t.info + ' ' + note + '\n\n'
    + '검사 시작: ' + link + '\n\n'
    + '이 메일은 ' + name + '의 요청으로 스코포스가 보냈어요. 요청한 적이 없다면 이 메일을 무시해 주세요.\n스코포스 ' + SITE;
  const html = '<div style="margin:0;padding:24px 12px;background:#F7F8FC;font-family:-apple-system,BlinkMacSystemFont,\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;color:#0F0F1A">'
    + '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:18px;padding:32px 28px">'
    + '<div style="font-size:18px;font-weight:900;letter-spacing:.02em">SKO<span style="color:#E91E8C">POS</span></div>'
    + '<h1 style="font-size:20px;line-height:1.5;margin:24px 0 12px">' + esc(name) + '에서 상담 전 검사를 요청했어요</h1>'
    + '<p style="font-size:15px;line-height:1.8;color:#5A5A6E;margin:0 0 8px">' + t.name + '예요. ' + t.info + '</p>'
    + '<p style="font-size:15px;line-height:1.8;color:#5A5A6E;margin:0 0 24px">' + note + '</p>'
    + '<a href="' + esc(link) + '" style="display:inline-block;padding:14px 28px;border-radius:50px;background:#E91E8C;color:#ffffff;font-size:15px;font-weight:800;text-decoration:none">검사 시작하기</a>'
    + '<p style="font-size:12px;line-height:1.7;color:#8890A4;margin:24px 0 0">버튼이 열리지 않으면 아래 주소를 복사해 주세요.<br><a href="' + esc(link) + '" style="color:#8890A4">' + esc(link) + '</a></p>'
    + '<hr style="border:0;border-top:1px solid #E4E7EF;margin:24px 0 16px">'
    + '<p style="font-size:12px;line-height:1.7;color:#8890A4;margin:0">이 메일은 ' + esc(name) + '의 요청으로 스코포스가 보냈어요. 요청한 적이 없다면 이 메일을 무시해 주세요.<br>스코포스 <a href="' + SITE + '" style="color:#8890A4">skopos.kr</a></p>'
    + '</div></div>';
  return { subject, text, html };
}

// deps: { sb (service role client), send }
//   send: 메일 발송 함수. 준비되지 않았으면 null. ({ to, subject, html, text }) => { ok, id, error }
export function makeHandler(deps) {
  const json = (status, body) => ({ status, body });
  return async function handler(method, headers, rawBody) {
    if (method !== 'POST') return json(405, { success: false, message: 'Method Not Allowed' });
    try {
      let body = {};
      try { body = JSON.parse(rawBody || '{}') || {}; } catch (_) { return json(400, { success: false, message: '요청 형식이 올바르지 않습니다.' }); }
      const action = String(body.action || 'status');
      const auth = headers.authorization || headers.Authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token) return json(401, { success: false, message: '로그인이 필요합니다.' });
      const { data: userData, error: userError } = await deps.sb.auth.getUser(token);
      if (userError || !userData?.user?.id || userData.user.is_anonymous) {
        return json(401, { success: false, message: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' });
      }
      const uid = userData.user.id;
      const configured = typeof deps.send === 'function';
      if (action === 'status') return json(200, { success: true, configured });
      if (action !== 'send') return json(400, { success: false, message: '알 수 없는 요청입니다.' });
      if (!configured) return json(503, { success: false, reason: 'not_configured', message: '이메일 발송을 준비하고 있어요. 링크를 복사해 전달해 주세요.' });

      const email = String(body.email || '').trim();
      const clientId = String(body.client_id || '');
      if (!validEmail(email)) return json(400, { success: false, reason: 'email_invalid', message: '이메일 주소를 다시 확인해 주세요.' });
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) return json(400, { success: false, reason: 'not_found', message: REASONS.not_found });
      const masked = maskEmail(email);

      const { data: prep, error: prepErr } = await deps.sb.rpc('invite_send_prepare', { p_uid: uid, p_client_id: clientId, p_masked: masked });
      if (prepErr || !prep) { console.error('invite-send prepare failed', prepErr && prepErr.message); return json(500, { success: false, message: '메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.' }); }
      if (prep.ok !== true) return json(prep.reason === 'daily_limit' || prep.reason === 'client_limit' ? 429 : 400, { success: false, reason: prep.reason, message: REASONS[prep.reason] || '메일을 보낼 수 없어요.' });

      const mail = buildMail(prep.business_name, prep.invite_code, prep.test_type);
      let ok = false, providerId = null, errText = null;
      try {
        const r = (await deps.send({ to: email, subject: mail.subject, html: mail.html, text: mail.text })) || {};
        ok = r.ok === true; providerId = r.id || null;
        if (!ok) errText = String(r.error || 'send failed').slice(0, 200);
      } catch (e) { errText = 'error ' + String(e && e.message || e).slice(0, 200); }
      await deps.sb.rpc('invite_send_finish', { p_send_id: prep.send_id, p_ok: ok, p_provider_id: providerId, p_error: errText });
      if (!ok) { console.error('invite-send mail failed', errText); return json(502, { success: false, reason: 'send_failed', message: '메일을 보내지 못했어요. 주소를 확인하거나 링크를 복사해 전달해 주세요.' }); }
      return json(200, { success: true, masked_to: masked });
    } catch (e) {
      console.error('invite-send error', e);
      return json(500, { success: false, message: '서버 오류가 발생했습니다.' });
    }
  };
}
