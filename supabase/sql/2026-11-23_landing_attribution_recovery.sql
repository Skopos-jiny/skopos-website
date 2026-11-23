-- 2026-11-23 광고 랜딩 계측·계정 유입 출처·결제 복구 대기열
-- 1) funnel_events: landing_view, signup 이벤트 허용
alter table public.funnel_events drop constraint if exists funnel_events_event_check;
alter table public.funnel_events add constraint funnel_events_event_check check (event = any (array[
  'free_quiz_complete','premium_quiz_complete','checkout_view','purchase','free_redeem',
  'couple_join','couple_report_view','interior_q_answered','interior_q_partial','interior_q_timeout',
  'interior_start','interior_complete','interior_pdf_customer','interior_pdf_consultant',
  'landing_view','signup']::text[]));

-- 2) 계정별 첫/마지막 유입 출처 (사용자당 1행, 본인만 insert/select, 수정 불가)
create table if not exists public.user_attribution (
  user_id uuid primary key references auth.users(id) on delete cascade,
  anon_id text check (char_length(anon_id) <= 64),
  first_source text check (char_length(first_source) <= 100),
  first_medium text check (char_length(first_medium) <= 100),
  first_campaign text check (char_length(first_campaign) <= 150),
  first_content text check (char_length(first_content) <= 150),
  first_seen_at timestamptz,
  last_source text check (char_length(last_source) <= 100),
  last_medium text check (char_length(last_medium) <= 100),
  last_campaign text check (char_length(last_campaign) <= 150),
  last_content text check (char_length(last_content) <= 150),
  landing_page text check (char_length(landing_page) <= 200),
  created_at timestamptz not null default now()
);
alter table public.user_attribution enable row level security;
drop policy if exists "user_attribution insert own" on public.user_attribution;
create policy "user_attribution insert own" on public.user_attribution
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "user_attribution select own" on public.user_attribution;
create policy "user_attribution select own" on public.user_attribution
  for select to authenticated using (user_id = (select auth.uid()));

-- 3) 결제 복구 대기열 (웹훅이 기록 누락·커플 코드 누락을 발견하면 적재, 서비스 키 전용)
create table if not exists public.payment_recovery_queue (
  imp_uid text primary key check (char_length(imp_uid) <= 40),
  merchant_uid text check (char_length(merchant_uid) <= 80),
  amount integer,
  order_name text check (char_length(order_name) <= 100),
  paid_at timestamptz,
  reason text not null check (reason in ('no_payment_record','couple_code_missing')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  note text check (char_length(note) <= 500)
);
alter table public.payment_recovery_queue enable row level security;
-- 정책 없음: anon/authenticated 접근 불가, service role 만 사용
