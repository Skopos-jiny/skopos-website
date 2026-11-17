-- 정밀검사 업체용 횟수권 결제 (2026-11-17): 결제 1건에 한 번만 적립하고, 취소된 결제의 횟수권은 세지 않는다
-- 2026-11-17_business_stage2.sql 적용 뒤에 실행.
alter table public.business_premium_credits add column if not exists payment_id uuid unique references public.payments(id) on delete set null;

create or replace function private.premium_credit_numbers(uid uuid, out total integer, out used integer)
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(c.credits)::int from public.business_premium_credits c
                    left join public.payments p on p.id = c.payment_id
                   where c.user_id = uid and (c.payment_id is null or p.status in ('paid','free'))), 0),
         (select count(*)::int from public.business_premium_uses where user_id = uid);
$$;
revoke all on function private.premium_credit_numbers(uuid) from public, anon, authenticated;

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
        select pc.credits, pc.source, pc.created_at, 'premium' from public.business_premium_credits pc
          left join public.payments pp on pp.id = pc.payment_id
         where pc.user_id = uid and (pc.payment_id is null or pp.status in ('paid','free'))
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
revoke all on function public.business_credit_history() from public, anon;
grant execute on function public.business_credit_history() to authenticated;
