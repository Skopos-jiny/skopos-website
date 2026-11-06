-- Apply after deploying verify-payment and redeem-free-coupon without their
-- separate redemption inserts/counter updates. No customer codes are embedded.
alter table public.coupon_redemptions
  add column payment_id uuid references public.payments(id) on delete set null;
create unique index coupon_redemptions_payment_id_key
  on public.coupon_redemptions(payment_id);
create index coupon_redemptions_coupon_user_idx
  on public.coupon_redemptions(coupon_code, user_id);

-- Repair only usage supported by an existing successful payment record.
insert into public.coupon_redemptions
  (payment_id, coupon_code, user_id, imp_uid, merchant_uid,
   original_amount, discount_amount, final_amount, redeemed_at)
select p.id, p.coupon_code, p.user_id, p.imp_uid, p.merchant_uid,
       p.original_amount, p.discount_amount, p.final_amount,
       coalesce(p.paid_at, p.created_at, now())
from public.payments p
join public.coupons c on c.code = p.coupon_code
where p.status in ('paid', 'free')
  and p.original_amount is not null and p.discount_amount is not null
  and p.final_amount is not null;

-- Do not reduce counters which may include older records no longer retained.
update public.coupons c
set used_count = greatest(c.used_count, r.total)
from (select coupon_code, count(*)::integer as total
      from public.coupon_redemptions group by coupon_code) r
where c.code = r.coupon_code;

create schema if not exists private;
create function private.record_payment_coupon_usage()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  coupon public.coupons%rowtype;
  user_uses integer;
begin
  if new.status not in ('paid', 'free') or nullif(new.coupon_code, '') is null then
    return new;
  end if;
  -- Serialize uses of the same coupon, including two simultaneous requests.
  select * into coupon from public.coupons
    where code = new.coupon_code for update;
  if not found then raise exception 'Coupon not found'; end if;
  if not coupon.is_active
    or (coupon.starts_at is not null and coupon.starts_at > now())
    or (coupon.expires_at is not null and coupon.expires_at < now()) then
    raise exception 'Coupon is unavailable';
  end if;
  if coupon.usage_limit is not null and coupon.usage_limit > 0
    and coupon.used_count >= coupon.usage_limit then
    raise exception 'Coupon usage limit reached';
  end if;
  if new.user_id is null then raise exception 'Coupon requires a verified user'; end if;
  if coupon.per_user_limit > 0 then
    select count(*) into user_uses from public.coupon_redemptions
      where coupon_code = new.coupon_code and user_id = new.user_id;
    if user_uses >= coupon.per_user_limit then
      raise exception 'Coupon per-user limit reached';
    end if;
  end if;
  insert into public.coupon_redemptions
    (payment_id, coupon_code, user_id, imp_uid, merchant_uid,
     original_amount, discount_amount, final_amount, redeemed_at)
  values
    (new.id, new.coupon_code, new.user_id, new.imp_uid, new.merchant_uid,
     new.original_amount, new.discount_amount, new.final_amount,
     coalesce(new.paid_at, now()));
  update public.coupons set used_count = used_count + 1 where code = new.coupon_code;
  return new;
end;
$$;
revoke all on function private.record_payment_coupon_usage() from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.record_payment_coupon_usage() to service_role;

create trigger payments_record_coupon_usage
after insert on public.payments
for each row execute function private.record_payment_coupon_usage();

comment on function private.record_payment_coupon_usage() is
  'Atomically records successful coupon payments and increments usage. A ledger failure rolls back the payment insert.';
