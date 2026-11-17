// @ts-nocheck
// invite-send: 업체가 입력한 고객 이메일로 검사 안내 메일을 보낸다.
// 발송 방법 (위에서부터 먼저 설정된 것을 쓴다)
//   1) Gmail SMTP: GMAIL_USER (로그인하는 Google 계정 주소), GMAIL_APP_PASSWORD (앱 비밀번호)
//      앱 비밀번호가 'skopos-mail' 이라는 이름으로 등록된 경우도 받는다.
//   2) Resend: RESEND_API_KEY
// 발신 주소: MAIL_FROM (기본 'SKOPOS <skopos@skopos.kr>')
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';
import { makeHandler } from './core.ts';

const ALLOWED_ORIGINS = ['https://skopos.kr', 'https://www.skopos.kr'];
function isAllowedOrigin(o) {
  return ALLOWED_ORIGINS.includes(o) || /^https:\/\/([a-z0-9-]+\.)?skopos[a-z0-9-]*\.pages\.dev$/.test(o);
}
const FROM = Deno.env.get('MAIL_FROM') || 'SKOPOS <skopos@skopos.kr>';

function makeSend() {
  const gUser = Deno.env.get('GMAIL_USER'), gPass = (Deno.env.get('GMAIL_APP_PASSWORD') || Deno.env.get('skopos-mail') || '').replace(/\s+/g, '');
  if (gUser && gPass) {
    // Edge Function 에서는 25·587 포트가 막혀 있어 465(SSL)를 쓴다
    const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: gUser, pass: gPass }, connectionTimeout: 10000, socketTimeout: 15000 });
    return async (m) => {
      try {
        const info = await transport.sendMail({ from: FROM, to: m.to, subject: m.subject, html: m.html, text: m.text });
        const ok = Array.isArray(info.accepted) && info.accepted.length > 0;
        return { ok, id: info.messageId || null, error: ok ? null : 'rejected ' + String(info.response || '') };
      } catch (e) { return { ok: false, error: 'smtp ' + String(e && (e.responseCode || e.code) || '') + ' ' + String(e && e.message || e) }; }
    };
  }
  const rKey = Deno.env.get('RESEND_API_KEY');
  if (rKey) {
    return async (m) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + rKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
      });
      let j = {}; try { j = await res.json(); } catch (_) {}
      const ok = res.ok && !!j.id;
      return { ok, id: j.id || null, error: ok ? null : String(res.status) + ' ' + String(j.name || j.message || '') };
    };
  }
  return null;
}

const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const handler = makeHandler({ sb, send: makeSend() });

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const cors = {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : 'https://skopos.kr',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const headers = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  const r = await handler(req.method, headers, req.method === 'POST' ? await req.text() : '');
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
});
