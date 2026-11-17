-- 업체 화면 2단계 (2026-11-17): 검사 유형 2종(인테리어·정밀), 폴더, 일괄 처리, 공유 중지 요청(7일 뒤 적용), 구매한 결과 삭제 제한
-- 2026-11-17_business_purchase.sql 적용 뒤에 실행.

create table if not exists public.business_folders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  parent_id uuid references public.business_folders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);
create index if not exists business_folders_business_idx on public.business_folders(business_id);
alter table public.business_folders enable row level security;

alter table public.business_clients add column if not exists test_type text not null default 'interior' check (test_type in ('interior','premium'));
alter table public.business_clients add column if not exists premium_result_id bigint;
alter table public.business_clients add column if not exists folder_id uuid references public.business_folders(id) on delete set null;

-- 정밀검사 횟수권 (업체용). 인테리어 이용권(interior_credits)과 따로 센다.
create table if not exists public.business_premium_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credits integer not null check (credits between 1 and 1000),
  source text not null default 'admin' check (source in ('admin','purchase','coupon')),
  created_at timestamptz not null default now()
);
create table if not exists public.business_premium_uses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_client_id uuid references public.business_clients(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists business_premium_credits_user_idx on public.business_premium_credits(user_id);
create index if not exists business_premium_uses_user_idx on public.business_premium_uses(user_id);
alter table public.business_premium_credits enable row level security;
alter table public.business_premium_uses enable row level security;

create or replace function private.premium_credit_numbers(uid uuid, out total integer, out used integer)
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(credits)::int from public.business_premium_credits where user_id = uid), 0),
         (select count(*)::int from public.business_premium_uses where user_id = uid);
$$;
revoke all on function private.premium_credit_numbers(uuid) from public, anon, authenticated;

-- ── 업체 정보 + 이용권(유형별) + 이용 기준 버전 ──
create or replace function public.business_me() returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype; n record; p record;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid;
  if not found then return json_build_object('ok', true, 'registered', false); end if;
  select * into n from private.interior_credit_numbers(uid);
  select * into p from private.premium_credit_numbers(uid);
  return json_build_object('ok', true, 'registered', true,
    'business', json_build_object('id', b.id, 'name', b.name, 'biz_no', b.biz_no, 'ceo_name', b.ceo_name,
      'manager_name', b.manager_name, 'phone', b.phone, 'email', b.email, 'status', b.status, 'created_at', b.created_at,
      'terms_version', b.terms_version),
    'credits', json_build_object('total', n.total, 'used', n.used, 'remaining', greatest(n.total - n.used, 0)),
    'premium_credits', json_build_object('total', p.total, 'used', p.used, 'remaining', greatest(p.total - p.used, 0)));
end; $$;

create or replace function public.business_terms_agree() returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  update public.businesses set terms_version = 'biz-v2-2026-11', agreed_at = now() where owner_user_id = uid and status <> 'suspended';
  get diagnostics n = row_count;
  return json_build_object('ok', n = 1);
end; $$;

-- ── 폴더 ──
create or replace function public.business_folder_save(p_id uuid, p_name text, p_parent uuid default null) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype; fid uuid; cnt int;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid and status <> 'suspended';
  if not found then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  if char_length(btrim(coalesce(p_name,''))) not between 1 and 40 then return json_build_object('ok', false, 'reason', 'name_required'); end if;
  if p_id is not null then
    update public.business_folders set name = btrim(p_name) where id = p_id and business_id = b.id returning id into fid;
    return json_build_object('ok', fid is not null, 'id', fid);
  end if;
  select count(*) into cnt from public.business_folders where business_id = b.id;
  if cnt >= 100 then return json_build_object('ok', false, 'reason', 'too_many_folders'); end if;
  -- 2단계까지만: 상위 폴더는 이 업체의 최상위 폴더여야 한다
  if p_parent is not null and not exists (select 1 from public.business_folders where id = p_parent and business_id = b.id and parent_id is null) then
    return json_build_object('ok', false, 'reason', 'parent_invalid'); end if;
  insert into public.business_folders (business_id, parent_id, name) values (b.id, p_parent, btrim(p_name)) returning id into fid;
  return json_build_object('ok', true, 'id', fid);
end; $$;

create or replace function public.business_folder_delete(p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  delete from public.business_folders f where f.id = p_id
     and exists (select 1 from public.businesses b where b.id = f.business_id and b.owner_user_id = uid);
  get diagnostics n = row_count;
  return json_build_object('ok', n = 1);
end; $$;

create or replace function public.business_clients_move(p_ids uuid[], p_folder uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype; n int;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid and status <> 'suspended';
  if not found then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  if p_folder is not null and not exists (select 1 from public.business_folders where id = p_folder and business_id = b.id) then
    return json_build_object('ok', false, 'reason', 'folder_invalid'); end if;
  update public.business_clients set folder_id = p_folder where business_id = b.id and id = any(coalesce(p_ids, '{}'));
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'moved', n);
end; $$;

-- ── 고객 추가 (검사 유형, 폴더) ──
create or replace function private.business_client_insert(p_business uuid, p_name text, p_memo text, p_email text, p_test text, p_folder uuid, out cid uuid, out code text)
language plpgsql security definer set search_path = '' as $$
begin
  code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  insert into public.business_clients (business_id, display_name, memo, invite_code, email, test_type, folder_id)
  values (p_business, btrim(p_name), left(btrim(coalesce(p_memo,'')), 200), code, coalesce(p_email,''), p_test, p_folder) returning id into cid;
end; $$;
revoke all on function private.business_client_insert(uuid, text, text, text, text, uuid) from public, anon, authenticated;

drop function if exists public.business_client_add(text, text, text);
create or replace function public.business_client_add(p_name text, p_memo text, p_email text default null, p_test text default 'interior', p_folder uuid default null)
returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype; r record; open_count int; em text := '';
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid;
  if not found then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  if b.status = 'suspended' then return json_build_object('ok', false, 'reason', 'suspended'); end if;
  if char_length(btrim(coalesce(p_name,''))) not between 1 and 40 then return json_build_object('ok', false, 'reason', 'name_required'); end if;
  if coalesce(p_test,'') not in ('interior','premium') then return json_build_object('ok', false, 'reason', 'test_invalid'); end if;
  if btrim(coalesce(p_email,'')) <> '' then
    em := private.clean_email(p_email);
    if em is null then return json_build_object('ok', false, 'reason', 'email_invalid'); end if;
  end if;
  if p_folder is not null and not exists (select 1 from public.business_folders where id = p_folder and business_id = b.id) then p_folder := null; end if;
  select count(*) into open_count from public.business_clients where business_id = b.id and status in ('invited','accepted');
  if open_count >= 200 then return json_build_object('ok', false, 'reason', 'too_many_open_invites'); end if;
  select * into r from private.business_client_insert(b.id, p_name, p_memo, em, p_test, p_folder);
  return json_build_object('ok', true, 'id', r.cid, 'invite_code', r.code);
end; $$;

-- 일괄 추가: [{name, email}] 최대 50줄. 형식이 틀린 줄은 건너뛰고 줄 번호를 알려 준다.
create or replace function public.business_clients_add_bulk(p_rows jsonb, p_test text default 'interior', p_folder uuid default null)
returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype; it jsonb; i int := 0; added int := 0; skipped int[] := '{}'; nm text; em text; open_count int; r record;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid;
  if not found then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  if b.status = 'suspended' then return json_build_object('ok', false, 'reason', 'suspended'); end if;
  if coalesce(p_test,'') not in ('interior','premium') then return json_build_object('ok', false, 'reason', 'test_invalid'); end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 50 then
    return json_build_object('ok', false, 'reason', 'rows_invalid'); end if;
  if p_folder is not null and not exists (select 1 from public.business_folders where id = p_folder and business_id = b.id) then p_folder := null; end if;
  select count(*) into open_count from public.business_clients where business_id = b.id and status in ('invited','accepted');
  if open_count + jsonb_array_length(p_rows) > 200 then return json_build_object('ok', false, 'reason', 'too_many_open_invites'); end if;
  for it in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; nm := btrim(coalesce(it->>'name','')); em := '';
    if btrim(coalesce(it->>'email','')) <> '' then em := private.clean_email(it->>'email'); end if;
    if char_length(nm) not between 1 and 40 or em is null then skipped := skipped || i; continue; end if;
    select * into r from private.business_client_insert(b.id, nm, '', em, p_test, p_folder);
    added := added + 1;
  end loop;
  return json_build_object('ok', true, 'added', added, 'skipped', to_json(skipped));
end; $$;

-- ── 목록: 유형, 폴더, 공유 중지 예정일 포함. 가입하지 않은 고객의 이메일은 90일 뒤 지운다 ──
drop function if exists public.business_clients_list();
create or replace function public.business_clients_list() returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid;
  if not found then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  update public.business_clients set email = ''
   where business_id = b.id and status = 'invited' and email <> '' and invited_at < now() - interval '90 days';
  return json_build_object('ok', true,
   'folders', coalesce((select json_agg(json_build_object('id', f.id, 'name', f.name, 'parent_id', f.parent_id) order by f.created_at)
                        from public.business_folders f where f.business_id = b.id), '[]'::json),
   'clients', coalesce((
    select json_agg(json_build_object('id', c.id, 'name', c.display_name, 'memo', c.memo, 'status', c.status, 'email', c.email,
      'test_type', c.test_type, 'folder_id', c.folder_id,
      'invite_code', case when c.status in ('invited','accepted','testing') then c.invite_code end,
      'purchased_at', c.purchased_at,
      'has_result', x.has_result,
      'shared', (x.has_result and c.purchased_at is not null and (c.revoked_at is null or c.revoked_at > now())),
      'revoked', (c.revoked_at is not null and c.revoked_at <= now()),
      'revoke_at', case when c.revoked_at > now() then c.revoked_at end,
      'mail', (select json_build_object('to', s.masked_to, 'at', s.created_at) from public.business_client_sends s
                where s.business_client_id = c.id and s.status = 'sent' order by s.created_at desc limit 1),
      'invited_at', c.invited_at, 'started_at', c.started_at, 'completed_at', c.completed_at) order by c.invited_at desc)
    from public.business_clients c
    cross join lateral (select (c.status = 'completed' and c.client_user_id is not null and case when c.test_type = 'premium'
        then exists (select 1 from public.premium_results r where r.id = c.premium_result_id)
        else exists (select 1 from public.interior_results r where r.id = c.result_id) end) as has_result) x
    where c.business_id = b.id and c.status <> 'cancelled'), '[]'::json));
end; $$;

-- ── 구매: 유형별 횟수권에서 1회씩. 어느 한쪽이라도 모자라면 아무것도 차감하지 않는다 ──
create or replace function public.business_client_purchase(p_ids uuid[]) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype; n record; p record; ids uuid[]; pids uuid[]; need int; pneed int; cid uuid; use_id uuid; rid uuid;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid;
  if not found then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  if b.status = 'suspended' then return json_build_object('ok', false, 'reason', 'suspended'); end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 100 then
    return json_build_object('ok', false, 'reason', 'nothing_selected'); end if;
  perform pg_advisory_xact_lock(hashtext('interior:' || uid::text));
  select coalesce(array_agg(c.id) filter (where c.test_type = 'interior'), '{}'), coalesce(array_agg(c.id) filter (where c.test_type = 'premium'), '{}')
    into ids, pids from public.business_clients c
   where c.business_id = b.id and c.id = any(p_ids) and c.purchased_at is null and c.status <> 'cancelled' and c.revoked_at is null;
  need := coalesce(array_length(ids, 1), 0); pneed := coalesce(array_length(pids, 1), 0);
  if need + pneed = 0 then return json_build_object('ok', false, 'reason', 'nothing_to_purchase'); end if;
  select * into n from private.interior_credit_numbers(uid);
  select * into p from private.premium_credit_numbers(uid);
  if n.total - n.used < need then
    return json_build_object('ok', false, 'reason', 'no_credit', 'type', 'interior', 'need', need, 'remaining', greatest(n.total - n.used, 0)); end if;
  if p.total - p.used < pneed then
    return json_build_object('ok', false, 'reason', 'no_credit', 'type', 'premium', 'need', pneed, 'remaining', greatest(p.total - p.used, 0)); end if;
  foreach cid in array ids loop
    select result_id into rid from public.business_clients where id = cid;
    if rid is not null and exists (select 1 from public.interior_credit_uses u where u.result_id = rid) then rid := null; end if;
    insert into public.interior_credit_uses (user_id, business_client_id, result_id) values (uid, cid, rid) returning id into use_id;
    update public.business_clients set purchased_at = now(), purchase_use_id = use_id where id = cid;
  end loop;
  foreach cid in array pids loop
    insert into public.business_premium_uses (user_id, business_client_id) values (uid, cid);
    update public.business_clients set purchased_at = now() where id = cid;
  end loop;
  return json_build_object('ok', true, 'purchased', need + pneed, 'remaining', n.total - n.used - need, 'premium_remaining', p.total - p.used - pneed);
end; $$;

create or replace function public.business_client_cancel(p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c public.business_clients%rowtype; refunded boolean := false;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select c0.* into c from public.business_clients c0 join public.businesses b on b.id = c0.business_id
   where c0.id = p_id and b.owner_user_id = uid and c0.status in ('invited','accepted') for update of c0;
  if not found then return json_build_object('ok', false, 'reason', 'not_cancellable'); end if;
  if c.purchased_at is not null then
    delete from public.interior_credit_uses where business_client_id = c.id and result_id is null;
    delete from public.business_premium_uses where business_client_id = c.id;
    refunded := true;
  end if;
  update public.business_clients set status = 'cancelled', email = '', purchased_at = null, purchase_use_id = null where id = c.id;
  return json_build_object('ok', true, 'refunded', refunded);
end; $$;

-- ── 열람: 인테리어 상담 가이드 / 정밀검사 리포트 ──
create or replace function public.business_client_guide(p_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c public.business_clients%rowtype; r public.interior_results%rowtype;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select c0.* into c from public.business_clients c0 join public.businesses b on b.id = c0.business_id
   where c0.id = p_id and b.owner_user_id = uid and b.status <> 'suspended' and c0.test_type = 'interior';
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.status <> 'completed' then return json_build_object('ok', false, 'reason', 'not_completed'); end if;
  if c.purchased_at is null then return json_build_object('ok', false, 'reason', 'not_purchased'); end if;
  if (c.revoked_at is not null and c.revoked_at <= now()) or c.consented_at is null or c.client_user_id is null then
    return json_build_object('ok', false, 'reason', 'not_shared'); end if;
  select * into r from public.interior_results where id = c.result_id and user_id = c.client_user_id;
  if not found then return json_build_object('ok', false, 'reason', 'result_deleted'); end if;
  return json_build_object('ok', true, 'id', r.id, 'date', r.created_at, 'state', r.form_state, 'name', c.display_name);
end; $$;

create or replace function public.business_client_report(p_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c public.business_clients%rowtype; r public.premium_results%rowtype;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select c0.* into c from public.business_clients c0 join public.businesses b on b.id = c0.business_id
   where c0.id = p_id and b.owner_user_id = uid and b.status <> 'suspended' and c0.test_type = 'premium';
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.status <> 'completed' then return json_build_object('ok', false, 'reason', 'not_completed'); end if;
  if c.purchased_at is null then return json_build_object('ok', false, 'reason', 'not_purchased'); end if;
  if (c.revoked_at is not null and c.revoked_at <= now()) or c.consented_at is null or c.client_user_id is null then
    return json_build_object('ok', false, 'reason', 'not_shared'); end if;
  select * into r from public.premium_results where id = c.premium_result_id and user_id = c.client_user_id;
  if not found then return json_build_object('ok', false, 'reason', 'result_deleted'); end if;
  return json_build_object('ok', true, 'result_type', r.result_type, 'scores', r.scores, 'date', r.created_at, 'name', c.display_name);
end; $$;

-- ── 고객 쪽 ──
create or replace function public.invite_info(p_code text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  select bc.status, bc.client_user_id, bc.test_type, b.name, b.status as bstatus into c
    from public.business_clients bc join public.businesses b on b.id = bc.business_id
   where bc.invite_code = p_code;
  if not found or c.status = 'cancelled' or c.bstatus = 'suspended' then
    return json_build_object('ok', false, 'reason', 'invalid'); end if;
  return json_build_object('ok', true, 'business_name', c.name, 'status', c.status, 'test_type', c.test_type,
    'taken_by_other', c.client_user_id is not null and c.client_user_id is distinct from auth.uid());
end; $$;

drop function if exists public.invite_begin(text);
create or replace function public.invite_begin(p_code text, p_type text default 'interior') returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c public.business_clients%rowtype; b public.businesses%rowtype;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into c from public.business_clients where invite_code = p_code for update;
  if not found or c.status = 'cancelled' or c.test_type <> coalesce(p_type, 'interior') then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  if c.client_user_id is distinct from uid or c.consented_at is null or c.revoked_at is not null then
    return json_build_object('ok', false, 'reason', 'consent_required'); end if;
  select * into b from public.businesses where id = c.business_id;
  if b.status = 'suspended' then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  if c.status = 'completed' then return json_build_object('ok', false, 'reason', 'completed'); end if;
  if c.status = 'testing' then return json_build_object('ok', true, 'reused', true, 'business_name', b.name); end if;
  if c.status <> 'accepted' then return json_build_object('ok', false, 'reason', 'consent_required'); end if;
  update public.business_clients set status = 'testing', started_at = now() where id = c.id;
  return json_build_object('ok', true, 'reused', false, 'business_name', b.name);
end; $$;

-- 공유 중지: 구매 전에는 바로, 구매한 검사 결과는 요청 7일 뒤에 중지된다.
-- 검사 전에 미리 구매한 건을 고객이 중지하면 업체 이용권을 돌려준다.
create or replace function public.invite_revoke(p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c public.business_clients%rowtype; eff timestamptz := now();
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into c from public.business_clients where id = p_id and client_user_id = uid and revoked_at is null for update;
  if not found then return json_build_object('ok', false); end if;
  if c.purchased_at is not null and c.status = 'completed' then eff := now() + interval '7 days';
  elsif c.purchased_at is not null then
    delete from public.interior_credit_uses where business_client_id = c.id and result_id is null;
    delete from public.business_premium_uses where business_client_id = c.id;
    update public.business_clients set purchased_at = null, purchase_use_id = null where id = c.id;
  end if;
  update public.business_clients set revoked_at = eff where id = c.id;
  return json_build_object('ok', true, 'effective_at', eff, 'delayed', eff > now());
end; $$;

create or replace function public.my_shares() returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  return json_build_object('ok', true, 'shares', coalesce((
    select json_agg(json_build_object('id', c.id, 'business_name', b.name, 'status', c.status, 'result_id', c.result_id, 'test_type', c.test_type,
      'consented_at', c.consented_at, 'revoked', (c.revoked_at is not null and c.revoked_at <= now()),
      'revoke_at', case when c.revoked_at > now() then c.revoked_at end,
      'purchased', c.purchased_at is not null) order by c.consented_at desc)
    from public.business_clients c join public.businesses b on b.id = c.business_id
    where c.client_user_id = uid and c.consented_at is not null and c.status <> 'cancelled'), '[]'::json));
end; $$;

-- 업체가 구매해 공유 중인 인테리어 결과는 고객이 바로 지울 수 없다 (공유 중지 요청 후 7일 뒤, 또는 회원 탈퇴)
create or replace function private.interior_results_delete_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and auth.uid() = old.user_id and exists (
      select 1 from public.business_clients c where c.result_id = old.id and c.purchased_at is not null
         and (c.revoked_at is null or c.revoked_at > now())) then
    raise exception 'shared_result_locked' using errcode = 'P0001';
  end if;
  return old;
end; $$;
drop trigger if exists interior_results_delete_guard on public.interior_results;
create trigger interior_results_delete_guard before delete on public.interior_results
  for each row execute function private.interior_results_delete_guard();

-- 정밀검사 결과 저장 시 초대 검사에 연결
create or replace function private.premium_results_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare bc_id uuid;
begin
  select id into bc_id from public.business_clients
   where client_user_id = new.user_id and test_type = 'premium' and status = 'testing' and premium_result_id is null
   order by started_at desc limit 1 for update;
  if bc_id is not null then
    update public.business_clients set premium_result_id = new.id, status = 'completed', completed_at = now() where id = bc_id;
  end if;
  return new;
end; $$;
drop trigger if exists premium_results_link on public.premium_results;
create trigger premium_results_link after insert on public.premium_results
  for each row execute function private.premium_results_link();

-- 초대로 정밀검사를 한 고객이 자기 결과를 다시 열 수 있는지
create or replace function public.premium_invite_entitled() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('ok', true, 'entitled', exists (select 1 from public.business_clients
    where client_user_id = auth.uid() and test_type = 'premium' and premium_result_id is not null));
$$;

-- 발송 준비: 검사 유형을 함께 돌려준다 (링크 주소가 다르다)
create or replace function public.invite_send_prepare(p_uid uuid, p_client_id uuid, p_masked text) returns json
language plpgsql security definer set search_path = '' as $$
declare b public.businesses%rowtype; c public.business_clients%rowtype; day_count int; day_limit int; client_count int; sid uuid;
begin
  if p_uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = p_uid;
  if not found then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  if b.status = 'suspended' then return json_build_object('ok', false, 'reason', 'suspended'); end if;
  perform pg_advisory_xact_lock(hashtext('invite_send:' || b.id::text));
  select * into c from public.business_clients where id = p_client_id and business_id = b.id;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.status not in ('invited','accepted','testing') then return json_build_object('ok', false, 'reason', 'not_sendable'); end if;
  select count(*) into day_count from public.business_client_sends
   where business_id = b.id and status in ('pending','sent') and created_at > now() - interval '24 hours';
  day_limit := case when b.status = 'verified' then 200 else 20 end;
  if day_count >= day_limit then return json_build_object('ok', false, 'reason', 'daily_limit'); end if;
  select count(*) into client_count from public.business_client_sends
   where business_client_id = c.id and status in ('pending','sent') and created_at > now() - interval '24 hours';
  if client_count >= 3 then return json_build_object('ok', false, 'reason', 'client_limit'); end if;
  insert into public.business_client_sends (business_id, business_client_id, masked_to)
  values (b.id, c.id, left(coalesce(p_masked,''), 120)) returning id into sid;
  return json_build_object('ok', true, 'send_id', sid, 'invite_code', c.invite_code, 'business_name', b.name, 'test_type', c.test_type);
end; $$;

create or replace function public.business_credit_history() returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  if not exists (select 1 from public.businesses where owner_user_id = uid) then
    return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  return json_build_object('ok', true,
    'grants', coalesce((select json_agg(g order by g.created_at desc) from (
        select c.credits, c.source, c.created_at, 'interior' as test_type from public.interior_credits c
          left join public.payments p on p.id = c.payment_id
         where c.user_id = uid and (c.payment_id is null or p.status in ('paid','free'))
        union all
        select pc.credits, pc.source, pc.created_at, 'premium' from public.business_premium_credits pc where pc.user_id = uid
        order by created_at desc limit 200) g), '[]'::json),
    'uses', coalesce((select json_agg(u order by u.started_at desc) from (
        select bc.display_name as name, u0.business_client_id is not null as invited, u0.started_at, 'interior' as test_type
          from public.interior_credit_uses u0 left join public.business_clients bc on bc.id = u0.business_client_id
         where u0.user_id = uid
        union all
        select bc.display_name, true, pu.created_at, 'premium'
          from public.business_premium_uses pu left join public.business_clients bc on bc.id = pu.business_client_id
         where pu.user_id = uid
        order by started_at desc limit 200) u), '[]'::json));
end; $$;

do $$
declare f text;
begin
  foreach f in array array['business_me()','business_terms_agree()','business_folder_save(uuid,text,uuid)','business_folder_delete(uuid)',
    'business_clients_move(uuid[],uuid)','business_client_add(text,text,text,text,uuid)','business_clients_add_bulk(jsonb,text,uuid)',
    'business_clients_list()','business_client_purchase(uuid[])','business_client_cancel(uuid)','business_client_guide(uuid)',
    'business_client_report(uuid)','invite_begin(text,text)','invite_revoke(uuid)','my_shares()','premium_invite_entitled()','business_credit_history()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to anon, authenticated;
revoke all on function public.invite_send_prepare(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.invite_send_prepare(uuid, uuid, text) to service_role;
