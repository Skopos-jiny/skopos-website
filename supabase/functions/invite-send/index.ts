// @ts-nocheck
// invite-send: 업체가 입력한 고객 이메일로 검사 안내 메일을 보낸다 (Resend).
// 비밀값: RESEND_API_KEY (필수), RESEND_FROM (선택, 기본 'SKOPOS <no-reply@skopos.kr>')
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeHandler } from './core.ts';

const ALLOWED_ORIGINS = ['https://skopos.kr', 'https://www.skopos.kr'];
function isAllowedOrigin(o) {
  return ALLOWED_ORIGINS.includes(o) || /^https:\/\/([a-z0-9-]+\.)?skopos[a-z0-9-]*\.pages\.dev$/.test(o);
}
const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const handler = makeHandler({ sb, env: (k) => Deno.env.get(k), fetch: (u, o) => fetch(u, o) });

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
