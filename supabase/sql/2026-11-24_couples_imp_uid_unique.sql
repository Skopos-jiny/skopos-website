-- 2026-11-24 커플 결제 1건당 초대 코드 1개 보장
-- verify-payment 재시도·새로고침이 동시에 들어와도 같은 imp_uid 로 코드가 두 개 생기지 않게 한다.
-- (적용 전 확인: couples 1행, imp_uid 중복 0건)
create unique index if not exists couples_imp_uid_key on public.couples (imp_uid) where imp_uid is not null;
