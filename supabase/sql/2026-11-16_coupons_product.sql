-- 쿠폰 적용 상품 구분 (2026-11-16 적용 완료)
-- 기존 쿠폰은 모두 정밀 검사용(premium)으로 간주. 인테리어 정식판 쿠폰은 product='interior' 로 등록.
alter table public.coupons add column if not exists product text not null default 'premium';
alter table public.coupons drop constraint if exists coupons_product_check;
alter table public.coupons add constraint coupons_product_check check (product in ('premium','couple','interior','any'));
comment on column public.coupons.product is '쿠폰 적용 상품: premium(정밀 검사) / couple / interior / any';
