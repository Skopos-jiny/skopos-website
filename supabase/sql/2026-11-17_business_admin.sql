-- 업체 관리자 화면 보완 (2026-11-17)
-- 2026-11-16_business_workspace.sql 적용 뒤에 실행. 새 함수 3개만 추가하고 기존 테이블·함수는 바꾸지 않는다.

-- 고객 이름(별칭)·메모 수정
create or replace function public.business_client_update(p_id uuid, p_name text, p_memo text) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  if char_length(btrim(coalesce(p_name,''))) not between 1 and 40 then return json_build_object('ok', false, 'reason', 'name_required'); end if;
  update public.business_clients c set display_name = btrim(p_name), memo = left(btrim(coalesce(p_memo,'')), 200)
   where c.id = p_id and c.status <> 'cancelled'
     and exists (select 1 from public.businesses b where b.id = c.business_id and b.owner_user_id = uid and b.status <> 'suspended');
  get diagnostics n = row_count;
  return json_build_object('ok', n = 1, 'reason', case when n = 1 then null else 'not_found' end);
end; $$;

-- 초대 링크 다시 만들기: 검사 시작 전에만. 이전 링크는 바로 쓸 수 없게 된다. 이미 동의한 고객은 새 링크로 이어서 진행.
create or replace function public.business_client_reissue(p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); code text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16); n int;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  update public.business_clients c set invite_code = code
   where c.id = p_id and c.status in ('invited','accepted')
     and exists (select 1 from public.businesses b where b.id = c.business_id and b.owner_user_id = uid and b.status <> 'suspended');
  get diagnostics n = row_count;
  if n <> 1 then return json_build_object('ok', false, 'reason', 'not_reissuable'); end if;
  return json_build_object('ok', true, 'invite_code', code);
end; $$;

-- 이용권 받은 내역·사용 내역 (업체 계정 본인 것만)
create or replace function public.business_credit_history() returns json
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  if not exists (select 1 from public.businesses where owner_user_id = uid) then
    return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  return json_build_object('ok', true,
    'grants', coalesce((select json_agg(g order by g.created_at desc) from (
        select c.credits, c.source, c.created_at from public.interior_credits c
          left join public.payments p on p.id = c.payment_id
         where c.user_id = uid and (c.payment_id is null or p.status in ('paid','free'))
         order by c.created_at desc limit 200) g), '[]'::json),
    'uses', coalesce((select json_agg(u order by u.started_at desc) from (
        select bc.display_name as name, u0.business_client_id is not null as invited,
               u0.started_at, (u0.result_id is not null) as completed
          from public.interior_credit_uses u0
          left join public.business_clients bc on bc.id = u0.business_client_id
         where u0.user_id = uid
         order by u0.started_at desc limit 200) u), '[]'::json));
end; $$;

do $$
declare f text;
begin
  foreach f in array array['business_client_update(uuid,text,text)','business_client_reissue(uuid)','business_credit_history()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
