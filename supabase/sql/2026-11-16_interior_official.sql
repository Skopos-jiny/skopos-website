-- SDTI 인테리어 공간욕구검사 정식판 (2026-12-01 출시) 이용권 구조
-- 1회 이용권 59,900원 / 10회 이용권 100,000원 (한 계정에서 10번) / INTERIORBETA = 1회 무료
-- 이용권 1회 = 검사 시작 1번(24시간 안 재진입은 같은 회차) + 저장 결과 영구 열람

-- 1) 결제 상품 구분 (정밀 검사 이용권 판정에서 인테리어 결제를 빼기 위함)
alter table public.payments add column if not exists product text not null default 'premium';
alter table public.payments drop constraint if exists payments_product_check;
alter table public.payments add constraint payments_product_check check (product in ('premium','couple','interior'));
update public.payments set product = 'couple' where product = 'premium' and (order_name like '%커플%' or pg = 'couple');

-- 2) 이용권 적립
create table if not exists public.interior_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_id uuid unique references public.payments(id) on delete set null,
  credits integer not null check (credits between 1 and 100),
  source text not null check (source in ('single','pack10','coupon','admin')),
  created_at timestamptz not null default now()
);
create index if not exists interior_credits_user_idx on public.interior_credits(user_id);
alter table public.interior_credits enable row level security;
drop policy if exists "interior_credits select own" on public.interior_credits;
create policy "interior_credits select own" on public.interior_credits for select to authenticated using ((select auth.uid()) = user_id);

-- 3) 이용권 사용 (검사 시작 1번 = 1행, 결과를 지워도 되돌아오지 않음)
create table if not exists public.interior_credit_uses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  result_id uuid unique,
  started_at timestamptz not null default now()
);
create index if not exists interior_credit_uses_user_idx on public.interior_credit_uses(user_id);
alter table public.interior_credit_uses enable row level security;
drop policy if exists "interior_credit_uses select own" on public.interior_credit_uses;
create policy "interior_credit_uses select own" on public.interior_credit_uses for select to authenticated using ((select auth.uid()) = user_id);

-- 4) 잔여 계산: 취소된 결제의 이용권은 빼고 계산
create or replace function private.interior_credit_numbers(uid uuid, out total integer, out used integer, out open_session boolean)
language sql stable security definer set search_path = '' as $$
  select
    coalesce((select sum(c.credits)::int from public.interior_credits c
              left join public.payments p on p.id = c.payment_id
              where c.user_id = uid and (c.payment_id is null or p.status in ('paid','free'))), 0),
    (select count(*)::int from public.interior_credit_uses u where u.user_id = uid),
    exists(select 1 from public.interior_credit_uses u where u.user_id = uid and u.result_id is null and u.started_at > now() - interval '24 hours');
$$;

create or replace function public.interior_credit_status()
returns json language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n record;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  select * into n from private.interior_credit_numbers(uid);
  return json_build_object('ok', true, 'total', n.total, 'used', n.used,
    'remaining', greatest(n.total - n.used, 0), 'open_session', n.open_session);
end; $$;

-- 검사 시작: 24시간 안에 시작해 아직 저장하지 않은 회차가 있으면 그대로 쓰고, 없으면 1회 차감
create or replace function public.interior_begin()
returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n record;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'login_required'); end if;
  perform pg_advisory_xact_lock(hashtext('interior:' || uid::text));
  select * into n from private.interior_credit_numbers(uid);
  if n.open_session then
    return json_build_object('ok', true, 'reused', true, 'remaining', greatest(n.total - n.used, 0));
  end if;
  if n.total - n.used <= 0 then
    return json_build_object('ok', false, 'reason', 'no_credit', 'remaining', 0);
  end if;
  insert into public.interior_credit_uses(user_id) values (uid);
  return json_build_object('ok', true, 'reused', false, 'remaining', n.total - n.used - 1);
end; $$;

revoke all on function public.interior_credit_status() from public, anon;
revoke all on function public.interior_begin() from public, anon;
grant execute on function public.interior_credit_status() to authenticated;
grant execute on function public.interior_begin() to authenticated;
revoke all on function private.interior_credit_numbers(uuid) from public, anon, authenticated;

-- 5) 결과 저장 규칙 (2026-12-01 00:00 KST 이후, 회원 화면 기준. 관리자 작업은 제외)
--    새 저장: 열린 회차가 있어야 하고 그 회차에 연결 / 수정: 정식판 결과만, 저장 후 24시간 안 / 베타 결과는 읽기 전용
create or replace function private.interior_results_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare use_id uuid;
begin
  if coalesce(auth.role(), 'anon') not in ('authenticated', 'anon') then return new; end if;
  if now() < timestamptz '2026-12-01 00:00:00+09' then return new; end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('interior:' || new.user_id::text));
    select id into use_id from public.interior_credit_uses
      where user_id = new.user_id and result_id is null and started_at > now() - interval '24 hours'
      order by started_at desc limit 1;
    if use_id is null then raise exception 'interior_no_session' using errcode = 'P0001'; end if;
    update public.interior_credit_uses set result_id = new.id where id = use_id;
    new.version := 'official';
    return new;
  end if;
  -- UPDATE
  if old.version <> 'official' then raise exception 'interior_beta_readonly' using errcode = 'P0001'; end if;
  if old.created_at < now() - interval '24 hours' then raise exception 'interior_edit_window_closed' using errcode = 'P0001'; end if;
  new.version := 'official';
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  return new;
end; $$;

drop trigger if exists interior_results_beta_cutoff on public.interior_results;
drop function if exists public.interior_results_beta_cutoff();
drop trigger if exists interior_results_guard on public.interior_results;
create trigger interior_results_guard before insert or update on public.interior_results
  for each row execute function private.interior_results_guard();

-- 6) 사전 베타 이용권 코드: 정식판 1회 무료, 12/1~12/31, 한 계정 1회, 전체 한도 없음
insert into public.coupons (code, name, discount_type, discount_value, starts_at, expires_at, usage_limit, used_count, per_user_limit, is_active, product)
values ('INTERIORBETA', '인테리어 공간욕구검사 사전 베타 이용권', 'fixed', 59900,
        timestamptz '2026-12-01 00:00:00+09', timestamptz '2026-12-31 23:59:59+09', null, 0, 1, true, 'interior')
on conflict (code) do nothing;
