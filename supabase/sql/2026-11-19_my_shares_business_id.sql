-- 2026-11-19 마이페이지 공유 업체 수를 고유 업체 기준으로 세기 위해 my_shares 결과에 business_id 추가 (기존 필드 유지)
CREATE OR REPLACE FUNCTION public.my_shares()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := auth.uid();
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  return json_build_object('ok', true, 'shares', coalesce((
    select json_agg(json_build_object('id', c.id, 'business_id', c.business_id, 'business_name', b.name, 'status', c.status, 'result_id', c.result_id, 'test_type', c.test_type,
      'consented_at', c.consented_at, 'revoked', (c.revoked_at is not null and c.revoked_at <= now()),
      'revoke_at', case when c.revoked_at > now() then c.revoked_at end,
      'purchased', c.purchased_at is not null) order by c.consented_at desc)
    from public.business_clients c join public.businesses b on b.id = c.business_id
    where c.client_user_id = uid and c.consented_at is not null and c.status <> 'cancelled'), '[]'::json));
end; $function$;
