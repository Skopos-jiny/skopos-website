-- 업체 워크스페이스·고객 매칭 (2026-11-16)
-- 업체 정보 등록 → 고객 초대 링크 → 고객이 시작 전 동의 → 업체 이용권으로 검사 → 업체가 상담 가이드 열람
-- 모든 변경은 아래 함수(RPC)로만 이뤄지고, 테이블은 본인 관련 행 조회만 허용한다.

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  biz_no text not null check (biz_no ~ '^[0-9]{10}$'),
  ceo_name text not null default '',
  manager_name text not null default '',
  phone text not null default '',
  email text not null default '',
  status text not null default 'pending' check (status in ('pending','verified','suspended')),
  terms_version text not null default '',
  agreed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.businesses enable row level security;
drop policy if exists "businesses select own" on public.businesses;
create policy "businesses select own" on public.businesses for select to authenticated
  using ((select auth.uid()) = owner_user_id);

create table if not exists public.business_clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  memo text not null default '' check (char_length(memo) <= 200),
  invite_code text not null unique,
  status text not null default 'invited' check (status in ('invited','accepted','testing','completed','cancelled')),
  client_user_id uuid references auth.users(id) on delete set null,
  result_id uuid,
  consent_version text,
  consented_at timestamptz,
  revoked_at timestamptz,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz
);
create index if not exists business_clients_business_idx on public.business_clients(business_id);
create index if not exists business_clients_client_idx on public.business_clients(client_user_id);
alter table public.business_clients enable row level security;
drop policy if exists "business_clients select related" on public.business_clients;
create policy "business_clients select related" on public.business_clients for select to authenticated
  using ((select auth.uid()) = client_user_id
      or exists (select 1 from public.businesses b where b.id = business_id and b.owner_user_id = (select auth.uid())));

alter table public.interior_credit_uses add column if not exists business_client_id uuid references public.business_clients(id) on delete set null;

-- 이용권 계산: 고객 초대에 쓴 회차는 업체 본인의 '진행 중 검사'로 보지 않는다
create or replace function private.interior_credit_numbers(uid uuid, out total integer, out used integer, out open_session boolean)
language sql stable security definer set search_path = '' as $$
  select
    coalesce((select sum(c.credits)::int from public.interior_credits c
              left join public.payments p on p.id = c.payment_id
              where c.user_id = uid and (c.payment_id is null or p.status in ('paid','free'))), 0),
    (select count(*)::int from public.interior_credit_uses u where u.user_id = uid),
    exists(select 1 from public.interior_credit_uses u where u.user_id = uid and u.business_client_id is null
           and u.result_id is null and u.started_at > now() - interval '24 hours');
$$;
revoke all on function private.interior_credit_numbers(uuid) from public, anon, authenticated;

-- 사업자등록번호 검증번호 확인
create or replace function private.valid_biz_no(n text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare w int[] := array[1,3,7,1,3,7,1,3,5]; s int := 0; i int;
begin
  if n !~ '^[0-9]{10}$' then return false; end if;
  for i in 1..9 loop s := s + substr(n,i,1)::int * w[i]; end loop;
  s := s + (substr(n,9,1)::int * 5) / 10;
  return ((10 - (s % 10)) % 10) = substr(n,10,1)::int;
end; $$;

-- ── 업체 쪽 ──────────────────────────────────────────────
create or replace function public.business_me() returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype; n record;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid;
  if not found then return json_build_object('ok', true, 'registered', false); end if;
  select * into n from private.interior_credit_numbers(uid);
  return json_build_object('ok', true, 'registered', true,
    'business', json_build_object('id', b.id, 'name', b.name, 'biz_no', b.biz_no, 'ceo_name', b.ceo_name,
      'manager_name', b.manager_name, 'phone', b.phone, 'email', b.email, 'status', b.status, 'created_at', b.created_at),
    'credits', json_build_object('total', n.total, 'used', n.used, 'remaining', greatest(n.total - n.used, 0)));
end; $$;

create or replace function public.business_register(p_name text, p_biz_no text, p_ceo text, p_manager text, p_phone text, p_email text, p_agree boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); no text := regexp_replace(coalesce(p_biz_no,''), '[^0-9]', '', 'g'); old public.businesses%rowtype;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  if coalesce(p_agree, false) is not true then return json_build_object('ok', false, 'reason', 'agree_required'); end if;
  if char_length(btrim(coalesce(p_name,''))) not between 1 and 60 then return json_build_object('ok', false, 'reason', 'name_required'); end if;
  if not private.valid_biz_no(no) then return json_build_object('ok', false, 'reason', 'biz_no_invalid'); end if;
  if char_length(btrim(coalesce(p_manager,''))) < 1 or char_length(btrim(coalesce(p_phone,''))) < 8 then
    return json_build_object('ok', false, 'reason', 'contact_required'); end if;
  select * into old from public.businesses where owner_user_id = uid;
  if found then
    if old.status = 'suspended' then return json_build_object('ok', false, 'reason', 'suspended'); end if;
    update public.businesses set name = btrim(p_name), biz_no = no, ceo_name = left(btrim(coalesce(p_ceo,'')),40),
      manager_name = left(btrim(p_manager),40), phone = left(btrim(p_phone),30), email = left(btrim(coalesce(p_email,'')),120),
      status = case when old.biz_no <> no then 'pending' else old.status end, updated_at = now()
      where id = old.id;
    return json_build_object('ok', true, 'updated', true);
  end if;
  insert into public.businesses (owner_user_id, name, biz_no, ceo_name, manager_name, phone, email, terms_version, agreed_at)
  values (uid, btrim(p_name), no, left(btrim(coalesce(p_ceo,'')),40), left(btrim(p_manager),40), left(btrim(p_phone),30),
          left(btrim(coalesce(p_email,'')),120), 'biz-v1-2026-11', now());
  return json_build_object('ok', true, 'created', true);
end; $$;

create or replace function public.business_client_add(p_name text, p_memo text)
returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype; code text; cid uuid; open_count int;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid;
  if not found then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  if b.status = 'suspended' then return json_build_object('ok', false, 'reason', 'suspended'); end if;
  if char_length(btrim(coalesce(p_name,''))) not between 1 and 40 then return json_build_object('ok', false, 'reason', 'name_required'); end if;
  select count(*) into open_count from public.business_clients where business_id = b.id and status in ('invited','accepted');
  if open_count >= 200 then return json_build_object('ok', false, 'reason', 'too_many_open_invites'); end if;
  code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  insert into public.business_clients (business_id, display_name, memo, invite_code)
  values (b.id, btrim(p_name), left(btrim(coalesce(p_memo,'')), 200), code) returning id into cid;
  return json_build_object('ok', true, 'id', cid, 'invite_code', code);
end; $$;

create or replace function public.business_clients_list() returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid;
  if not found then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  return json_build_object('ok', true, 'clients', coalesce((
    select json_agg(json_build_object('id', c.id, 'name', c.display_name, 'memo', c.memo, 'status', c.status,
      'invite_code', case when c.status in ('invited','accepted','testing') then c.invite_code end,
      'shared', (c.status = 'completed' and c.revoked_at is null and c.client_user_id is not null
                 and exists (select 1 from public.interior_results r where r.id = c.result_id)),
      'revoked', c.revoked_at is not null,
      'invited_at', c.invited_at, 'started_at', c.started_at, 'completed_at', c.completed_at) order by c.invited_at desc)
    from public.business_clients c where c.business_id = b.id and c.status <> 'cancelled'), '[]'::json));
end; $$;

create or replace function public.business_client_cancel(p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  update public.business_clients c set status = 'cancelled'
   where c.id = p_id and c.status in ('invited','accepted')
     and exists (select 1 from public.businesses b where b.id = c.business_id and b.owner_user_id = uid);
  get diagnostics n = row_count;
  return json_build_object('ok', n = 1, 'reason', case when n = 1 then null else 'not_cancellable' end);
end; $$;

-- 상담 가이드 열람: 업체 소유자 + 고객 동의 유지 + 결과 존재
create or replace function public.business_client_guide(p_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c public.business_clients%rowtype; r public.interior_results%rowtype;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select c0.* into c from public.business_clients c0 join public.businesses b on b.id = c0.business_id
   where c0.id = p_id and b.owner_user_id = uid and b.status <> 'suspended';
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.status <> 'completed' then return json_build_object('ok', false, 'reason', 'not_completed'); end if;
  if c.revoked_at is not null or c.consented_at is null or c.client_user_id is null then
    return json_build_object('ok', false, 'reason', 'not_shared'); end if;
  select * into r from public.interior_results where id = c.result_id and user_id = c.client_user_id;
  if not found then return json_build_object('ok', false, 'reason', 'result_deleted'); end if;
  return json_build_object('ok', true, 'id', r.id, 'date', r.created_at, 'state', r.form_state, 'name', c.display_name);
end; $$;

-- ── 고객 쪽 ──────────────────────────────────────────────
-- 초대 링크 안내 (로그인 전에도 업체 이름만 확인 가능)
create or replace function public.invite_info(p_code text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  select bc.status, bc.client_user_id, b.name, b.status as bstatus into c
    from public.business_clients bc join public.businesses b on b.id = bc.business_id
   where bc.invite_code = p_code;
  if not found or c.status = 'cancelled' or c.bstatus = 'suspended' then
    return json_build_object('ok', false, 'reason', 'invalid'); end if;
  return json_build_object('ok', true, 'business_name', c.name, 'status', c.status,
    'taken_by_other', c.client_user_id is not null and c.client_user_id is distinct from auth.uid());
end; $$;

-- 시작 전 동의 + 초대 수락
create or replace function public.invite_accept(p_code text) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c public.business_clients%rowtype;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select bc.* into c from public.business_clients bc join public.businesses b on b.id = bc.business_id
   where bc.invite_code = p_code and b.status <> 'suspended' for update of bc;
  if not found or c.status = 'cancelled' then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  if c.client_user_id is not null and c.client_user_id <> uid then return json_build_object('ok', false, 'reason', 'taken'); end if;
  if c.status = 'completed' then return json_build_object('ok', false, 'reason', 'completed'); end if;
  update public.business_clients set client_user_id = uid,
    consented_at = coalesce(consented_at, now()), consent_version = coalesce(consent_version, 'invite-v1-2026-11'),
    revoked_at = null, accepted_at = coalesce(accepted_at, now()),
    status = case when status = 'invited' then 'accepted' else status end
   where id = c.id;
  return json_build_object('ok', true);
end; $$;

-- 검사 시작: 업체 이용권 1회 차감 (같은 초대는 완료 전까지 다시 차감하지 않음)
create or replace function public.invite_begin(p_code text) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c public.business_clients%rowtype; b public.businesses%rowtype; n record;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into c from public.business_clients where invite_code = p_code;
  if not found or c.status = 'cancelled' then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  if c.client_user_id is distinct from uid or c.consented_at is null or c.revoked_at is not null then
    return json_build_object('ok', false, 'reason', 'consent_required'); end if;
  select * into b from public.businesses where id = c.business_id;
  if b.status = 'suspended' then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  if c.status = 'completed' then return json_build_object('ok', false, 'reason', 'completed'); end if;
  if c.status = 'testing' then return json_build_object('ok', true, 'reused', true, 'business_name', b.name); end if;
  perform pg_advisory_xact_lock(hashtext('interior:' || b.owner_user_id::text));
  select * into c from public.business_clients where id = c.id for update;
  if c.status = 'testing' then return json_build_object('ok', true, 'reused', true, 'business_name', b.name); end if;
  if c.status <> 'accepted' then return json_build_object('ok', false, 'reason', 'consent_required'); end if;
  select * into n from private.interior_credit_numbers(b.owner_user_id);
  if n.total - n.used <= 0 then return json_build_object('ok', false, 'reason', 'no_credit'); end if;
  insert into public.interior_credit_uses (user_id, business_client_id) values (b.owner_user_id, c.id);
  update public.business_clients set status = 'testing', started_at = now() where id = c.id;
  return json_build_object('ok', true, 'reused', false, 'business_name', b.name);
end; $$;

-- 내가 공유 중인 업체 목록, 공유 중지
create or replace function public.my_shares() returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  return json_build_object('ok', true, 'shares', coalesce((
    select json_agg(json_build_object('id', c.id, 'business_name', b.name, 'status', c.status, 'result_id', c.result_id,
      'consented_at', c.consented_at, 'revoked', c.revoked_at is not null) order by c.consented_at desc)
    from public.business_clients c join public.businesses b on b.id = c.business_id
    where c.client_user_id = uid and c.consented_at is not null and c.status <> 'cancelled'), '[]'::json));
end; $$;

create or replace function public.invite_revoke(p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  update public.business_clients set revoked_at = now() where id = p_id and client_user_id = uid and revoked_at is null;
  get diagnostics n = row_count;
  return json_build_object('ok', n = 1);
end; $$;

do $$
declare f text;
begin
  foreach f in array array['business_me()','business_register(text,text,text,text,text,text,boolean)','business_client_add(text,text)',
    'business_clients_list()','business_client_cancel(uuid)','business_client_guide(uuid)','invite_accept(text)','invite_begin(text)',
    'my_shares()','invite_revoke(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to anon, authenticated;
revoke all on function private.valid_biz_no(text) from public, anon, authenticated;

-- ── 결과 저장 규칙: 초대 검사는 날짜와 관계없이 그 초대에 연결 ──
create or replace function private.interior_results_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare use_id uuid; bc_id uuid;
begin
  if coalesce(auth.role(), 'anon') not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    select id into bc_id from public.business_clients
      where client_user_id = new.user_id and status = 'testing' and result_id is null
      order by started_at desc limit 1 for update;
    if bc_id is not null then
      update public.business_clients set result_id = new.id, status = 'completed', completed_at = now() where id = bc_id;
      update public.interior_credit_uses set result_id = new.id where business_client_id = bc_id and result_id is null;
      new.version := 'official';
      return new;
    end if;
  end if;
  if now() < timestamptz '2026-12-01 00:00:00+09' then return new; end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('interior:' || new.user_id::text));
    select id into use_id from public.interior_credit_uses
      where user_id = new.user_id and business_client_id is null and result_id is null and started_at > now() - interval '24 hours'
      order by started_at desc limit 1;
    if use_id is null then raise exception 'interior_no_session' using errcode = 'P0001'; end if;
    update public.interior_credit_uses set result_id = new.id where id = use_id;
    new.version := 'official';
    return new;
  end if;
  if old.version <> 'official' then raise exception 'interior_beta_readonly' using errcode = 'P0001'; end if;
  if old.created_at < now() - interval '24 hours' then raise exception 'interior_edit_window_closed' using errcode = 'P0001'; end if;
  new.version := 'official';
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  return new;
end; $$;
