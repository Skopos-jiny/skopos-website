-- 2026-11-24 funnel_events 허용 목록 보완
-- 사이트가 이미 보내고 있지만 허용 목록에 없어 버려지던 이벤트 3개를 추가한다.
--   password_reset_request (login.html 비밀번호 재설정 요청)
--   couple_send            (couple.html 초대 링크·코드 전송)
--   couple_check_fail      (couple.html 이용권 조회 실패)
alter table public.funnel_events drop constraint if exists funnel_events_event_check;
alter table public.funnel_events add constraint funnel_events_event_check check (event = any (array[
  'free_quiz_complete','premium_quiz_complete','checkout_view','purchase','free_redeem',
  'couple_join','couple_report_view','couple_send','couple_check_fail',
  'interior_q_answered','interior_q_partial','interior_q_timeout',
  'interior_start','interior_complete','interior_pdf_customer','interior_pdf_consultant',
  'landing_view','signup','password_reset_request']::text[])) not valid;
alter table public.funnel_events validate constraint funnel_events_event_check;
