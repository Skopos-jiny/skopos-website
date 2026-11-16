-- 인테리어 베타 종료(2026-12-01 00:00 KST) 이후 회원 화면의 새 저장·수정 차단 (미적용: 적용 승인 필요)
-- 삭제와 관리자(service_role) 작업은 허용. 정식판에서 같은 테이블을 쓰려면 이 트리거를 고치거나 지운다.
create or replace function public.interior_results_beta_cutoff()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if now() >= timestamptz '2026-12-01 00:00:00+09'
     and coalesce(auth.role(), 'anon') in ('authenticated', 'anon') then
    raise exception 'interior beta closed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists interior_results_beta_cutoff on public.interior_results;
create trigger interior_results_beta_cutoff
  before insert or update on public.interior_results
  for each row execute function public.interior_results_beta_cutoff();
