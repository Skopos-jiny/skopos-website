SKOPOS (스코포스) 웹사이트 저장소
skopos.kr

■ 구성
- 화면: Cloudflare Pages (이 저장소 main 브랜치에 올리면 자동 배포, 빌드 없음)
- 서버 기능: Supabase Edge Functions (supabase/functions 폴더가 원본)
  verify-payment, validate-coupon, redeem-free-coupon, couple, naver-auth, portone-webhook
- 데이터: Supabase (결제, 검사 결과, 쿠폰, 커플 진단, 유입 기록)
- netlify 폴더는 이전 호스팅 시절 코드로, 현재는 사용하지 않습니다.

■ 주요 페이지
- /                     홈
- /skopos_quiz          SDTI 기초 검사 (무료)
- /skopos_premium_quiz  SDTI 정밀 검사
- /payment              결제 (정밀 검사, 커플 진단)
- /couple               커플 진단 결과지
- /mypage               마이페이지
- /skopos_sample_result 정밀 검사 결과 샘플

■ 운영 메모
- 비밀번호, API 키 등 비밀 정보는 이 저장소에 적지 않습니다 (공개 저장소).
- 서버 비밀 값은 Supabase 대시보드의 Edge Function Secrets 에서 관리합니다.
- _redirects, _headers 는 Cloudflare Pages 설정 파일입니다.
