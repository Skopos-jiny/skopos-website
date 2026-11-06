-- Integration test: all generated coupons, payments and ledger entries roll back.
begin;
set local statement_timeout = '10s';
do $$
declare uid uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then raise exception 'Test requires an existing auth user'; end if;
  perform set_config('skopos.test_uid', uid::text, true);
end;
$$;
set local role service_role;
do $$
declare
  test_code text := 'GPT-ROLLBACK-' || gen_random_uuid()::text;
  uid uuid := current_setting('skopos.test_uid')::uuid;
  pid uuid;
  uses integer;
  blocked boolean := false;
begin
  insert into public.coupons(code,name,discount_type,discount_value,usage_limit,per_user_limit)
    values(test_code,'Transaction rollback test','percent',100,2,1);
  insert into public.payments(user_id,merchant_uid,status,amount,original_amount,discount_amount,final_amount,coupon_code)
    values(uid,gen_random_uuid()::text,'free',0,29900,29900,0,test_code) returning id into pid;
  if (select count(*) from public.coupon_redemptions r where r.payment_id=pid) <> 1 then
    raise exception 'Missing or duplicate redemption';
  end if;
  if (select c.used_count from public.coupons c where c.code=test_code) <> 1 then
    raise exception 'Counter did not increment exactly once';
  end if;
  begin
    insert into public.payments(user_id,merchant_uid,status,amount,original_amount,discount_amount,final_amount,coupon_code)
      values(uid,gen_random_uuid()::text,'free',0,29900,29900,0,test_code);
  exception when raise_exception then blocked := true;
  end;
  if not blocked then raise exception 'Per-user limit was not enforced'; end if;
  if (select count(*) from public.payments p where p.coupon_code=test_code) <> 1 then
    raise exception 'Rejected payment was not rolled back';
  end if;
  update public.coupons c set per_user_limit=3 where c.code=test_code;
  blocked := false;
  begin
    insert into public.payments(user_id,merchant_uid,status,amount,original_amount,discount_amount,final_amount,coupon_code)
      values(uid,gen_random_uuid()::text,'free',0,null,29900,0,test_code);
  exception when not_null_violation then blocked := true;
  end;
  if not blocked then raise exception 'Ledger failure did not reject payment'; end if;
  if (select count(*) from public.payments p where p.coupon_code=test_code) <> 1 then
    raise exception 'Ledger failure left an orphan payment';
  end if;
  insert into public.payments(user_id,merchant_uid,status,amount,original_amount,discount_amount,final_amount,coupon_code)
    values(uid,gen_random_uuid()::text,'paid',14950,29900,14950,14950,test_code);
  blocked := false;
  begin
    insert into public.payments(user_id,merchant_uid,status,amount,original_amount,discount_amount,final_amount,coupon_code)
      values(uid,gen_random_uuid()::text,'free',0,29900,29900,0,test_code);
  exception when raise_exception then blocked := true;
  end;
  if not blocked then raise exception 'Total usage limit was not enforced'; end if;
  select c.used_count into uses from public.coupons c where c.code=test_code;
  if uses <> 2 then raise exception 'Rejected payment changed the counter'; end if;
  if (select count(*) from public.coupon_redemptions r where r.coupon_code=test_code) <> 2 then
    raise exception 'Wrong successful redemption count';
  end if;
  if has_function_privilege('anon','private.record_payment_coupon_usage()','EXECUTE')
    or has_function_privilege('authenticated','private.record_payment_coupon_usage()','EXECUTE') then
    raise exception 'Trigger function exposed to client roles';
  end if;
end;
$$;
rollback;
select 'PASS: free/paid logging, counters, user/global limits, ledger-failure rollback, client privilege isolation; test data rolled back' as result;
