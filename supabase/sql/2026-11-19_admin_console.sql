-- 관리자 계정과 업체 승인 화면 (2026-11-19)
-- 관리자: skopos@skopos.kr. 관리자 목록은 private 스키마에만 두고, 화면은 아래 RPC로만 읽고 바꾼다.
-- 업체 상태 의미(기존과 동일): pending 확인 중(이용 가능, 초대 메일 하루 20건) / verified 확인 완료(하루 200건) / suspended 이용 중지

create table if not exists private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);
alter table private.admins enable row level security;
revoke all on private.admins from public, anon, authenticated;

insert into private.admins (user_id, email)
select id, lower(email) from auth.users where lower(email) = 'skopos@skopos.kr'
on conflict (user_id) do nothing;

-- 업체 상태 변경 이력 (누가, 언제, 무엇에서 무엇으로, 메모)
create table if not exists private.business_status_log (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  note text not null default '',
  admin_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists business_status_log_biz_idx on private.business_status_log (business_id, created_at desc);
alter table private.business_status_log enable row level security;
revoke all on private.business_status_log from public, anon, authenticated;

create or replace function private.is_admin(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and exists (select 1 from private.admins a where a.user_id = p_uid);
$$;
revoke all on function private.is_admin(uuid) from public, anon, authenticated;

-- 로그인한 사람이 관리자인지
create or replace function public.admin_me() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  return json_build_object('ok', true, 'admin', private.is_admin(auth.uid()));
end; $$;

-- 등록 업체 현황 (관리자 전용)
create or replace function public.admin_businesses() returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  if not private.is_admin(uid) then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  return json_build_object('ok', true,
    'summary', (select json_build_object(
        'total', count(*),
        'pending', count(*) filter (where status = 'pending'),
        'verified', count(*) filter (where status = 'verified'),
        'suspended', count(*) filter (where status = 'suspended')) from public.businesses),
    'businesses', coalesce((select json_agg(x order by x.status_rank, x.created_at desc) from (
      select b.id, b.name, b.biz_no, b.ceo_name, b.manager_name, b.phone, b.email, b.status,
             case b.status when 'pending' then 0 when 'verified' then 1 else 2 end as status_rank,
             b.terms_version, b.agreed_at, b.created_at, b.updated_at,
             u.email as owner_email, u.created_at as owner_joined_at, u.last_sign_in_at as owner_last_sign_in,
             (select count(*) from public.business_clients c where c.business_id = b.id and c.status <> 'cancelled') as clients,
             (select count(*) from public.business_clients c where c.business_id = b.id and c.status = 'completed') as completed,
             (select json_build_object('total', n.total, 'used', n.used) from private.interior_credit_numbers(b.owner_user_id) n) as interior_credits,
             (select json_build_object('total', p.total, 'used', p.used) from private.premium_credit_numbers(b.owner_user_id) p) as premium_credits,
             (select json_build_object('from', l.from_status, 'to', l.to_status, 'note', l.note, 'at', l.created_at, 'by', a.email)
                from private.business_status_log l left join private.admins a on a.user_id = l.admin_user_id
               where l.business_id = b.id order by l.created_at desc limit 1) as last_review
        from public.businesses b
        left join auth.users u on u.id = b.owner_user_id) x), '[]'::json));
end; $$;

-- 업체 상태 변경: 승인(verified) / 이용 중지(suspended) / 확인 중으로 되돌리기(pending)
create or replace function public.admin_business_set_status(p_id uuid, p_status text, p_note text default '') returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); old text;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  if not private.is_admin(uid) then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_status not in ('pending', 'verified', 'suspended') then return json_build_object('ok', false, 'reason', 'bad_status'); end if;
  if p_status = 'suspended' and char_length(btrim(coalesce(p_note, ''))) < 2 then
    return json_build_object('ok', false, 'reason', 'note_required'); end if;
  select status into old from public.businesses where id = p_id for update;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if old = p_status then return json_build_object('ok', true, 'unchanged', true, 'status', old); end if;
  update public.businesses set status = p_status, updated_at = now() where id = p_id;
  insert into private.business_status_log (business_id, from_status, to_status, note, admin_user_id)
  values (p_id, old, p_status, left(btrim(coalesce(p_note, '')), 300), uid);
  return json_build_object('ok', true, 'status', p_status, 'from', old);
end; $$;

-- 업체별 상태 변경 이력
create or replace function public.admin_business_log(p_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  if not private.is_admin(uid) then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  return json_build_object('ok', true, 'log', coalesce((select json_agg(json_build_object(
      'from', l.from_status, 'to', l.to_status, 'note', l.note, 'at', l.created_at, 'by', a.email) order by l.created_at desc)
    from private.business_status_log l left join private.admins a on a.user_id = l.admin_user_id
   where l.business_id = p_id), '[]'::json));
end; $$;

do $$
declare f text;
begin
  foreach f in array array['admin_me()','admin_businesses()','admin_business_set_status(uuid,text,text)','admin_business_log(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
