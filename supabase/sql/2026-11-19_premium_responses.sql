-- SDTI 정밀검사 응답 원본 저장 (2026-11-19)
-- 위치: supabase/sql/2026-11-19_premium_responses.sql
-- 2026-11-19 Supabase에 적용 완료 (migration: premium_responses_20261119)
-- 기존 RLS(본인 행만 insert/select)를 그대로 따르도록 새 테이블 대신 premium_results에 컬럼을 추가한다.

alter table public.premium_results
  add column if not exists responses        jsonb,
  add column if not exists quiz_version     text,
  add column if not exists scoring_version  text,
  add column if not exists research_consent boolean not null default false;

comment on column public.premium_results.responses is
  '문항별 원응답. {"v":문항세트버전,"sv":채점버전,"age":연령대,"q":품질플래그,"items":[[문항ID, 값, 응답시간ms], ...]} / 값: 척도 1~5(5=매우 그렇다), 선택형 0~3(보기 순서), null=시간 초과';
comment on column public.premium_results.quiz_version     is '문항 세트 버전 (예: P1.0). 문항을 바꿀 때마다 올린다';
comment on column public.premium_results.scoring_version  is '채점 방식 버전 (예: 2026-11-16)';
comment on column public.premium_results.research_consent is '응답을 비식별 형태로 문항 개선 연구에 쓰는 데 동의(선택)';

-- 연구용 조회: 동의자만, user_id·invite_code 제외. private 스키마라 API로 노출되지 않음(SQL 편집기 전용).
create or replace view private.research_responses as
select id, created_at, result_type, quiz_version, scoring_version, scores, responses
from public.premium_results
where research_consent = true
  and responses is not null;

-- 배포 후 확인 (테스트 응답 1건 뒤 실행): items 길이 144, 값 범위, 응답시간이 들어왔는지
-- select quiz_version, scoring_version, research_consent,
--        jsonb_array_length(responses->'items') as n_items,
--        responses->'items'->0 as first_item
-- from public.premium_results order by created_at desc limit 1;
