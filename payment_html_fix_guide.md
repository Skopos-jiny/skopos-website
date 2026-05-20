# payment.html 수정 가이드

## 🔍 발견된 문제

GitHub 저장소의 `payment.html` 안에 **5페이지 PDF 리포트** 라는 문구가 있는데,
실제 PDF는 10페이지로 확장되었습니다. 결제 직전 사용자가 보는 가치 인식 문구라
**우선 수정 필요**.

## 📍 수정 위치 찾기

`payment.html` 파일을 열어 다음 텍스트를 찾으세요:

```
SDTI 144문항 · 12가지 욕구 유형 · 8영역 분석
소품 처방 + 컬러 팔레트 + 5페이지 PDF 리포트
```

## ✏️ 권장 수정안 (3가지 옵션)

### 옵션 A — 간결한 갱신 (최소 변경)
```
SDTI 144문항 · 12가지 욕구 유형 · 8영역 분석
소품 처방 + 컬러 팔레트 + 10페이지 PDF 리포트
```

### 옵션 B — 가치 강화 (추천 ⭐)
```
SDTI 144문항 · 12가지 욕구 유형 · 8영역 분석
계절별 가이드 + 컬러 팔레트 + 10페이지 PDF 리포트
```

### 옵션 C — 최대 가치 어필
```
SDTI 144문항 · 12가지 욕구 유형 · 8영역 분석
계절별 가이드 + 30/60/90일 액션 플랜 + 10페이지 PDF
```

## 💡 추천 이유

**옵션 B**가 가장 좋습니다:
- "계절별 가이드"는 우리가 신설한 최강 차별화 포인트
- 9,900원 결제 후 받는 가치를 가장 명확히 전달
- 결제 페이지 사용자의 마지막 망설임을 잡아줌

## 🔧 GitHub에서 수정하는 방법

### 방법 1: 웹 에디터 (가장 빠름)
1. https://github.com/Skopos-jiny/skopos-website/blob/main/payment.html 접속
2. 오른쪽 위 연필 아이콘 ✏️ 클릭
3. Ctrl+F (또는 Cmd+F)로 "5페이지 PDF" 검색
4. 위 옵션 B로 교체
5. 페이지 하단 "Commit changes" → 커밋 메시지: `fix: PDF 페이지 수를 10페이지로 갱신 (5 → 10)`
6. "Commit changes" 클릭

### 방법 2: 로컬 클론 후 push
```bash
git clone https://github.com/Skopos-jiny/skopos-website.git
cd skopos-website
# payment.html을 에디터로 열어 수정
git add payment.html
git commit -m "fix: PDF 페이지 수를 10페이지로 갱신 (5 → 10)"
git push origin main
```

## ⏱️ 배포 시간

- Netlify 자동 배포: 약 30초~1분
- 실제 적용 확인: https://skopos.kr/payment.html
