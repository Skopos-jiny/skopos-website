-- 코드 리뷰(2026-11-17 GPT) 반영
-- 2026-11-17_premium_purchase.sql 적용 뒤에 실행.
--  1) 업체 메모·구매 여부 등은 업체만 조회한다 (고객은 my_shares 함수로 필요한 항목만 본다)
--  2) 검사 결과는 저장할 때 넘긴 초대 코드로만 초대에 연결한다 (검사 종류·본인·동의 확인)
--  4) 고객이 탈퇴하면 업체가 입력한 이메일을 지우고, 90일 지난 미가입 고객 이메일은 고객 추가·목록 조회 때 정리한다

-- 1) 조회 정책: 업체 소유자만
drop policy if exists "business_clients select related" on public.business_clients;
drop policy if exists "business_clients select owner" on public.business_clients;
create policy "business_clients select owner" on public.business_clients for select to authenticated
  using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_user_id = (select auth.uid())));
revoke all on public.business_clients from anon;
revoke insert, update, delete, truncate, references, trigger on public.business_clients from authenticated;

-- 2) 결과 저장 시 초대 코드 (연결한 뒤에는 남기지 않는다)
alter table public.interior_results add column if not exists invite_code text;
alter table public.premium_results add column if not exists invite_code text;

create or replace function private.interior_results_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare use_id uuid; bc_id uuid; code text;
begin
  code := new.invite_code; new.invite_code := null;
  if coalesce(auth.role(), 'anon') not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' and code is not null then
    -- 초대 검사: 넘어온 코드의 초대가 본인 것이고, 인테리어 검사이며, 동의가 유지된 진행 중 건이어야 한다
    select id into bc_id from public.business_clients
      where invite_code = code and client_user_id = new.user_id and test_type = 'interior' and status = 'testing'
        and result_id is null and consented_at is not null and revoked_at is null
      for update;
    if bc_id is null then raise exception 'invite_not_active' using errcode = 'P0001'; end if;
    update public.business_clients set result_id = new.id, status = 'completed', completed_at = now() where id = bc_id;
    update public.interior_credit_uses set result_id = new.id where business_client_id = bc_id and result_id is null;
    new.version := 'official';
    return new;
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

create or replace function private.premium_results_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare bc_id uuid; code text;
begin
  code := new.invite_code; new.invite_code := null;
  if code is null then return new; end if;
  select id into bc_id from public.business_clients
   where invite_code = code and client_user_id = new.user_id and test_type = 'premium' and status = 'testing'
     and premium_result_id is null and consented_at is not null and revoked_at is null
   for update;
  if bc_id is not null then
    update public.business_clients set premium_result_id = new.id, status = 'completed', completed_at = now() where id = bc_id;
  end if;
  return new;
end; $$;
drop trigger if exists premium_results_link on public.premium_results;
create trigger premium_results_link before insert on public.premium_results
  for each row execute function private.premium_results_link();

-- 4) 이메일 정리
-- 고객이 탈퇴하면(계정 삭제로 client_user_id 가 비면) 업체가 입력한 이메일을 지운다
create or replace function private.business_clients_on_unlink() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.client_user_id is not null and new.client_user_id is null then new.email := ''; end if;
  return new;
end; $$;
drop trigger if exists business_clients_on_unlink on public.business_clients;
create trigger business_clients_on_unlink before update of client_user_id on public.business_clients
  for each row execute function private.business_clients_on_unlink();

-- 가입하지 않은 고객의 이메일은 초대 후 90일이 지나면 지운다. 어느 업체든 고객을 추가할 때 전체를 정리한다
-- (각 업체가 목록을 열 때 자기 업체분을 정리하는 것은 그대로 둔다)
create or replace function private.business_clients_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.business_clients set email = ''
   where status = 'invited' and client_user_id is null and email <> '' and invited_at < now() - interval '90 days';
  return null;
end; $$;
drop trigger if exists business_clients_cleanup on public.business_clients;
create trigger business_clients_cleanup after insert on public.business_clients
  for each statement execute function private.business_clients_cleanup();
revoke all on function private.business_clients_on_unlink() from public, anon, authenticated;
revoke all on function private.business_clients_cleanup() from public, anon, authenticated;
