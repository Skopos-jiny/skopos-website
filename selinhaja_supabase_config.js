/* ════════════════════════════════════════════════════════════
   셀인하자 Supabase 공통 설정
   ────────────────────────────────────────────────────────────
   ⚠️ 아래 두 값만 본인 프로젝트 값으로 교체하세요.
   위치: Supabase 대시보드 > Project Settings > API
     - SUPABASE_URL        : "Project URL"
     - SUPABASE_ANON_KEY   : "Project API keys" 의 publishable(anon) 키
                             (sb_publishable_... 또는 레거시 anon 키)
   ※ secret(service_role) 키는 절대 여기에 넣지 마세요. 공개됩니다.
   ════════════════════════════════════════════════════════════ */

const SUPABASE_URL      = 'https://rgbukqphcqptnfeqipfn.supabase.co';        // 예: https://xxxxxxxx.supabase.co
const SUPABASE_ANON_KEY = 'sb_publishable_xlgB6ljvPFZ-W_yW8TOGQA_yVs6vPce';   // 예: sb_publishable_xxx... (또는 레거시 anon 키)

/* ──────────────────────────────────────────────
   아래는 수정하지 않아도 됩니다.
   supabase-js CDN이 먼저 로드된 뒤 이 파일이 실행됩니다.
   ────────────────────────────────────────────── */
let sb = null;
function getSupabase(){
  if (sb) return sb;
  if (!window.supabase) { console.warn('supabase-js CDN 미로드'); return null; }
  if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
    console.warn('Supabase 키 미설정 — 샘플/폴백 데이터로 동작합니다.');
    return null;
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return sb;
}
function isSupabaseReady(){
  return SUPABASE_URL !== 'YOUR_SUPABASE_URL'
      && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY'
      && !!window.supabase;
}
