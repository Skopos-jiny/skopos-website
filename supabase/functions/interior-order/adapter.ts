// @ts-nocheck
// Netlify 형식 핸들러({statusCode, headers, body})를 Supabase Edge Function(Deno.serve)으로 연결하는 어댑터
export const process = {
  env: new Proxy({}, {
    get: (_t, k) => {
      const key = String(k);
      if (key === 'SUPABASE_SERVICE_KEY') return Deno.env.get('SUPABASE_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      return Deno.env.get(key);
    },
  }),
};

const ALLOWED_ORIGINS = ['https://skopos.kr', 'https://www.skopos.kr', 'https://skopos153.netlify.app'];
function isAllowedOrigin(o) {
  return ALLOWED_ORIGINS.includes(o) || /^https:\/\/([a-z0-9-]+\.)?skopos[a-z0-9-]*\.pages\.dev$/.test(o);
}

export function serveNetlifyHandler(handler) {
  Deno.serve(async (req) => {
    const url = new URL(req.url);
    const headers = {};
    req.headers.forEach((v, k) => { headers[k] = v; });
    const origin = headers['origin'] || '';
    const cors = {
      'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : 'https://skopos.kr',
      'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    const body = (req.method === 'GET' || req.method === 'HEAD') ? null : await req.text();
    const event = {
      httpMethod: req.method,
      headers,
      body,
      queryStringParameters: Object.fromEntries(url.searchParams),
      path: url.pathname,
      rawUrl: req.url,
    };
    try {
      const r = (await handler(event)) || { statusCode: 204 };
      const h = new Headers(r.headers || {});
      for (const [k, v] of Object.entries(cors)) h.set(k, v);
      return new Response(r.body ?? '', { status: r.statusCode || 200, headers: h });
    } catch (e) {
      console.error('handler crash', e);
      return new Response(JSON.stringify({ success: false, message: 'internal error' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  });
}
