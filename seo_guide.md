# SKOPOS 검색엔진 등록 가이드
# Google · 네이버 · 카카오(Daum) 노출 방법

---

## ✅ STEP 1 — 파일 업로드 (먼저 완료)

GitHub에 아래 파일들을 업로드하세요:

```
📁 저장소 루트
├── index.html          ← SEO 메타태그 포함 (완료)
├── skopos_quiz.html    ← SEO 메타태그 포함 (완료)
├── sitemap.xml         ← 새로 추가 ✅
├── robots.txt          ← 새로 추가 ✅
└── og-image.jpg        ← 직접 만들어서 추가 필요 ⚠️
```

### og-image.jpg 만드는 방법
카카오톡·구글에서 링크 공유 시 나타나는 미리보기 이미지입니다.
- 사이즈: **1200 × 630px**
- 도구: Canva (무료) → 새 디자인 → 커스텀 크기 1200×630
- 내용: 스코포스 로고 + 한 줄 설명 + 공간 사진
- 저장: JPG로 내보내기 → `og-image.jpg`로 이름 변경

---

## ✅ STEP 2 — Google Search Console 등록

### 접속
🔗 https://search.google.com/search-console

### 절차
1. Google 계정으로 로그인
2. **속성 추가** 클릭
3. **URL 접두어** 선택 → `https://skopos.kr` 입력
4. **소유권 확인** 방법 선택:
   - **HTML 태그** 방법 추천
   - 제공되는 코드를 `index.html`의 `<head>` 안에 붙여넣기
   ```html
   <meta name="google-site-verification" content="여기에_코드_입력">
   ```
   - GitHub에 저장 후 **확인** 클릭
5. 소유권 확인 완료 후 **사이트맵 제출**
   - 좌측 메뉴 → **Sitemaps**
   - `sitemap.xml` 입력 후 제출
6. **URL 검사** → `https://skopos.kr` 입력 → **색인 생성 요청**

### 완료 후
- 보통 **1~2주** 내 Google 검색에 노출
- Search Console에서 노출수·클릭수 확인 가능

---

## ✅ STEP 3 — 네이버 서치어드바이저 등록

### 접속
🔗 https://searchadvisor.naver.com

### 절차
1. 네이버 로그인
2. **웹마스터 도구** → **사이트 등록**
3. `https://skopos.kr` 입력
4. **소유 확인** → HTML 태그 방법:
   ```html
   <meta name="naver-site-verification" content="여기에_코드_입력">
   ```
   `index.html` `<head>` 안에 추가 → GitHub 저장 → 확인 클릭
5. 소유 확인 후 **요청** 탭 → **사이트맵 제출**
   - `https://skopos.kr/sitemap.xml` 입력
6. **요청** → **웹 페이지 수집** → URL 입력 후 수집 요청

### 완료 후
- 보통 **1~3주** 내 네이버 검색에 노출
- "스코포스", "skopos.kr" 검색 시 노출 확인

---

## ✅ STEP 4 — 카카오(Daum) 검색 등록

카카오톡 검색은 **Daum 검색**과 연동됩니다.

### 접속
🔗 https://register.search.daum.net

### 절차
1. Kakao 계정으로 로그인
2. **신규 등록** → `https://skopos.kr` 입력
3. 사이트 정보 입력:
   - 사이트명: `스코포스 (SKOPOS)`
   - 카테고리: 인테리어/생활
4. **등록 신청** 클릭

### 완료 후
- 보통 **1~2주** 내 Daum·카카오 검색 노출

---

## ✅ STEP 5 — 네이버 SEO 강화 (블로그 연동)

네이버는 **자사 블로그 콘텐츠**를 더 우선 노출합니다.

### 네이버 블로그 개설 권장
1. 네이버 블로그 개설: `blog.naver.com/skopos_official`
2. 프로필에 `skopos.kr` 링크 추가
3. 앞서 작성한 **카페 게시글** 동일 내용을 블로그에도 발행
4. 글마다 태그 추가: `#인테리어컨설팅 #반셀프인테리어 #공간컨설팅 #스코포스`

---

## 📊 검색 노출 체크리스트

```
□ og-image.jpg 제작 및 GitHub 업로드
□ index.html에 Google 소유권 확인 코드 추가
□ index.html에 Naver 소유권 확인 코드 추가
□ GitHub에 sitemap.xml 업로드
□ GitHub에 robots.txt 업로드
□ Google Search Console 사이트맵 제출
□ 네이버 서치어드바이저 사이트맵 제출
□ Daum 검색 신규 등록
□ 네이버 블로그 개설 및 1차 게시글 발행
```

---

## ⏱️ 예상 노출 일정

| 검색엔진 | 등록 후 노출까지 |
|---------|--------------|
| Google  | 1~2주 |
| 네이버  | 2~4주 |
| 카카오/Daum | 1~2주 |

> 💡 **팁**: 등록 직후 본인이 직접 검색해서 클릭하면 크롤러 수집이 빨라집니다.
> "스코포스 인테리어", "반셀프 인테리어 컨설팅" 등 키워드로 검색해보세요.

---

*SKOPOS 검색엔진 등록 가이드 — 2025*
