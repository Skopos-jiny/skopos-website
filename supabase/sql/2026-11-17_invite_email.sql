-- 검사 안내 이메일 발송 (2026-11-17)
-- 업체가 입력한 고객 이메일로 검사 링크를 보낸다. 이메일 원문은 저장하지 않고 가린 값과 결과만 남긴다.
-- 발송은 Edge Function invite-send 가 service_role 로 아래 함수 2개를 불러 처리한다.

create table if not exists public.business_client_sends (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  business_client_id uuid not null references public.business_clients(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email')),
  masked_to text not null default '',
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  provider_id text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists business_client_sends_business_idx on public.business_client_sends(business_id, created_at);
create index if not exists business_client_sends_client_idx on public.business_client_sends(business_client_id, created_at);
alter table public.business_client_sends enable row level security;
-- 정책 없음: 화면에서 직접 조회하지 않고 함수로만 다룬다.

-- 발송 전 확인: 업체 소유, 상태, 하루 한도. 통과하면 발송 기록(pending)을 만들고 링크 정보를 돌려준다.
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
  if day_count >= day_limit then
    return json_build_object('ok', false, 'reason', 'daily_limit'); end if;
  select count(*) into client_count from public.business_client_sends
   where business_client_id = c.id and status in ('pending','sent') and created_at > now() - interval '24 hours';
  if client_count >= 3 then return json_build_object('ok', false, 'reason', 'client_limit'); end if;
  insert into public.business_client_sends (business_id, business_client_id, masked_to)
  values (b.id, c.id, left(coalesce(p_masked,''), 120)) returning id into sid;
  return json_build_object('ok', true, 'send_id', sid, 'invite_code', c.invite_code, 'business_name', b.name);
end; $$;

create or replace function public.invite_send_finish(p_send_id uuid, p_ok boolean, p_provider_id text, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.business_client_sends set status = case when p_ok then 'sent' else 'failed' end,
    provider_id = left(p_provider_id, 100), error = left(p_error, 300)
   where id = p_send_id and status = 'pending';
$$;

revoke all on function public.invite_send_prepare(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.invite_send_finish(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.invite_send_prepare(uuid, uuid, text) to service_role;
grant execute on function public.invite_send_finish(uuid, boolean, text, text) to service_role;

-- 고객 목록에 마지막 메일 발송 결과(가린 주소, 시각) 추가
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
      'mail', (select json_build_object('to', s.masked_to, 'at', s.created_at) from public.business_client_sends s
                where s.business_client_id = c.id and s.status = 'sent' order by s.created_at desc limit 1),
      'invited_at', c.invited_at, 'started_at', c.started_at, 'completed_at', c.completed_at) order by c.invited_at desc)
    from public.business_clients c where c.business_id = b.id and c.status <> 'cancelled'), '[]'::json));
end; $$;
