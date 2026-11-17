-- 업체 화면 재설계 1단계 (2026-11-17): 이용권을 검사 시작이 아니라 상담 가이드 구매 때 쓴다
-- 2026-11-17_invite_email.sql 적용 뒤에 실행.
--  · 고객은 동의만 하면 바로 검사한다 (업체 이용권 확인 없음)
--  · 업체가 고객별로 구매해야 상담 가이드가 열린다 (검사 전 선구매 가능)
--  · 구매한 뒤에는 고객이 공유를 중지할 수 없다 (탈퇴하면 삭제)
--  · 고객 이메일을 저장해 표에 보여 주고 다시 보낼 때 쓴다

alter table public.business_clients add column if not exists email text not null default '' check (char_length(email) <= 120);
alter table public.business_clients add column if not exists purchased_at timestamptz;
alter table public.business_clients add column if not exists purchase_use_id uuid references public.interior_credit_uses(id) on delete set null;

-- 예전 방식(검사 시작 때 차감)으로 이미 이용권을 쓴 고객은 구매 완료로 옮긴다
update public.business_clients c set purchased_at = coalesce(c.started_at, now()),
       purchase_use_id = (select u.id from public.interior_credit_uses u where u.business_client_id = c.id order by u.started_at limit 1)
 where c.purchased_at is null and exists (select 1 from public.interior_credit_uses u where u.business_client_id = c.id);

create or replace function private.clean_email(e text) returns text
language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(e,'')) ~ '^[^[:space:]@<>(),;:"\\]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' and char_length(btrim(e)) <= 120 then btrim(e) end;
$$;
revoke all on function private.clean_email(text) from public, anon, authenticated;

-- 검사 시작: 동의만 확인한다. 이용권은 여기서 쓰지 않는다.
create or replace function public.invite_begin(p_code text) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c public.business_clients%rowtype; b public.businesses%rowtype;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into c from public.business_clients where invite_code = p_code for update;
  if not found or c.status = 'cancelled' then return json_build_object('ok', false, 'reason', 'invalid'); end if;
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

-- 상담 가이드 구매: 고객 1명당 이용권 1회. 여러 명을 한 번에 살 수 있고, 모자라면 아무도 차감하지 않는다.
create or replace function public.business_client_purchase(p_ids uuid[]) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype; n record; ids uuid[]; need int; cid uuid; use_id uuid; rid uuid;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid;
  if not found then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  if b.status = 'suspended' then return json_build_object('ok', false, 'reason', 'suspended'); end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 100 then
    return json_build_object('ok', false, 'reason', 'nothing_selected'); end if;
  perform pg_advisory_xact_lock(hashtext('interior:' || uid::text));
  select coalesce(array_agg(c.id), '{}') into ids from public.business_clients c
   where c.business_id = b.id and c.id = any(p_ids) and c.purchased_at is null and c.status <> 'cancelled' and c.revoked_at is null;
  need := coalesce(array_length(ids, 1), 0);
  if need = 0 then return json_build_object('ok', false, 'reason', 'nothing_to_purchase'); end if;
  select * into n from private.interior_credit_numbers(uid);
  if n.total - n.used < need then
    return json_build_object('ok', false, 'reason', 'no_credit', 'need', need, 'remaining', greatest(n.total - n.used, 0)); end if;
  foreach cid in array ids loop
    select result_id into rid from public.business_clients where id = cid;
    if rid is not null and exists (select 1 from public.interior_credit_uses u where u.result_id = rid) then rid := null; end if;
    insert into public.interior_credit_uses (user_id, business_client_id, result_id) values (uid, cid, rid) returning id into use_id;
    update public.business_clients set purchased_at = now(), purchase_use_id = use_id where id = cid;
  end loop;
  return json_build_object('ok', true, 'purchased', need, 'remaining', n.total - n.used - need);
end; $$;

-- 상담 가이드 열람: 업체 소유 + 구매 완료 + 고객 동의 + 결과 존재
create or replace function public.business_client_guide(p_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c public.business_clients%rowtype; r public.interior_results%rowtype;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select c0.* into c from public.business_clients c0 join public.businesses b on b.id = c0.business_id
   where c0.id = p_id and b.owner_user_id = uid and b.status <> 'suspended';
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.status <> 'completed' then return json_build_object('ok', false, 'reason', 'not_completed'); end if;
  if c.purchased_at is null then return json_build_object('ok', false, 'reason', 'not_purchased'); end if;
  if c.revoked_at is not null or c.consented_at is null or c.client_user_id is null then
    return json_build_object('ok', false, 'reason', 'not_shared'); end if;
  select * into r from public.interior_results where id = c.result_id and user_id = c.client_user_id;
  if not found then return json_build_object('ok', false, 'reason', 'result_deleted'); end if;
  return json_build_object('ok', true, 'id', r.id, 'date', r.created_at, 'state', r.form_state, 'name', c.display_name);
end; $$;

-- 링크 취소: 검사 시작 전에만. 선구매한 고객이면 이용권 1회를 돌려주고, 저장한 이메일은 지운다.
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
    refunded := true;
  end if;
  update public.business_clients set status = 'cancelled', email = '', purchased_at = null, purchase_use_id = null where id = c.id;
  return json_build_object('ok', true, 'refunded', refunded);
end; $$;

-- 고객 추가·수정: 이메일을 함께 저장한다
drop function if exists public.business_client_add(text, text);
create or replace function public.business_client_add(p_name text, p_memo text, p_email text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype; code text; cid uuid; open_count int; em text := '';
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid;
  if not found then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  if b.status = 'suspended' then return json_build_object('ok', false, 'reason', 'suspended'); end if;
  if char_length(btrim(coalesce(p_name,''))) not between 1 and 40 then return json_build_object('ok', false, 'reason', 'name_required'); end if;
  if btrim(coalesce(p_email,'')) <> '' then
    em := private.clean_email(p_email);
    if em is null then return json_build_object('ok', false, 'reason', 'email_invalid'); end if;
  end if;
  select count(*) into open_count from public.business_clients where business_id = b.id and status in ('invited','accepted');
  if open_count >= 200 then return json_build_object('ok', false, 'reason', 'too_many_open_invites'); end if;
  code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  insert into public.business_clients (business_id, display_name, memo, invite_code, email)
  values (b.id, btrim(p_name), left(btrim(coalesce(p_memo,'')), 200), code, em) returning id into cid;
  return json_build_object('ok', true, 'id', cid, 'invite_code', code);
end; $$;

drop function if exists public.business_client_update(uuid, text, text);
-- p_email: null 이면 그대로 두고, 빈 값이면 지운다
create or replace function public.business_client_update(p_id uuid, p_name text, p_memo text, p_email text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int; em text;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  if char_length(btrim(coalesce(p_name,''))) not between 1 and 40 then return json_build_object('ok', false, 'reason', 'name_required'); end if;
  if p_email is not null and btrim(p_email) <> '' then
    em := private.clean_email(p_email);
    if em is null then return json_build_object('ok', false, 'reason', 'email_invalid'); end if;
  elsif p_email is not null then em := '';
  end if;
  update public.business_clients c set display_name = btrim(p_name), memo = left(btrim(coalesce(p_memo,'')), 200), email = coalesce(em, c.email)
   where c.id = p_id and c.status <> 'cancelled'
     and exists (select 1 from public.businesses b where b.id = c.business_id and b.owner_user_id = uid and b.status <> 'suspended');
  get diagnostics n = row_count;
  return json_build_object('ok', n = 1, 'reason', case when n = 1 then null else 'not_found' end);
end; $$;

create or replace function public.business_clients_list() returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.businesses%rowtype;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into b from public.businesses where owner_user_id = uid;
  if not found then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  return json_build_object('ok', true, 'clients', coalesce((
    select json_agg(json_build_object('id', c.id, 'name', c.display_name, 'memo', c.memo, 'status', c.status, 'email', c.email,
      'invite_code', case when c.status in ('invited','accepted','testing') then c.invite_code end,
      'purchased_at', c.purchased_at,
      'has_result', (c.status = 'completed' and c.client_user_id is not null
                     and exists (select 1 from public.interior_results r where r.id = c.result_id)),
      'shared', (c.status = 'completed' and c.purchased_at is not null and c.revoked_at is null and c.client_user_id is not null
                 and exists (select 1 from public.interior_results r where r.id = c.result_id)),
      'revoked', c.revoked_at is not null,
      'mail', (select json_build_object('to', s.masked_to, 'at', s.created_at) from public.business_client_sends s
                where s.business_client_id = c.id and s.status = 'sent' order by s.created_at desc limit 1),
      'invited_at', c.invited_at, 'started_at', c.started_at, 'completed_at', c.completed_at) order by c.invited_at desc)
    from public.business_clients c where c.business_id = b.id and c.status <> 'cancelled'), '[]'::json));
end; $$;

-- 고객 쪽: 업체가 구매한 뒤에는 공유를 중지할 수 없다
create or replace function public.my_shares() returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  return json_build_object('ok', true, 'shares', coalesce((
    select json_agg(json_build_object('id', c.id, 'business_name', b.name, 'status', c.status, 'result_id', c.result_id,
      'consented_at', c.consented_at, 'revoked', c.revoked_at is not null, 'locked', c.purchased_at is not null and c.revoked_at is null) order by c.consented_at desc)
    from public.business_clients c join public.businesses b on b.id = c.business_id
    where c.client_user_id = uid and c.consented_at is not null and c.status <> 'cancelled'), '[]'::json));
end; $$;

create or replace function public.invite_revoke(p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  if exists (select 1 from public.business_clients where id = p_id and client_user_id = uid and purchased_at is not null and revoked_at is null) then
    return json_build_object('ok', false, 'reason', 'purchased'); end if;
  update public.business_clients set revoked_at = now() where id = p_id and client_user_id = uid and revoked_at is null;
  get diagnostics n = row_count;
  return json_build_object('ok', n = 1);
end; $$;

-- 시작 전 동의 문구가 바뀌었으므로 동의문 버전을 올린다 (invite-v2-2026-11)
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
    consented_at = coalesce(consented_at, now()), consent_version = coalesce(consent_version, 'invite-v2-2026-11'),
    revoked_at = null, accepted_at = coalesce(accepted_at, now()),
    status = case when status = 'invited' then 'accepted' else status end
   where id = c.id;
  return json_build_object('ok', true);
end; $$;

do $$
declare f text;
begin
  foreach f in array array['business_client_purchase(uuid[])','business_client_add(text,text,text)','business_client_update(uuid,text,text,text)',
    'business_client_cancel(uuid)','business_client_guide(uuid)','business_clients_list()','invite_begin(text)','invite_accept(text)','my_shares()','invite_revoke(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
