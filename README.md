# 메이플랜드 경험치 측정기 ⏱️📈

[![Website - Live](https://img.shields.io/badge/Website-Live-2ea44f?style=flat&logo=githubpages)](https://myungwoo.github.io/mapleland-exp-tracker-web/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3.x-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Deploy](https://github.com/myungwoo/mapleland-exp-tracker-web/actions/workflows/gh-pages.yml/badge.svg)](.github/workflows/gh-pages.yml)

설치 없이 브라우저에서 바로 사용하는 경험치(Exp) 측정·예측 웹앱입니다. 🎮
게임 창의 레벨/경험치 영역(ROI)을 화면 캡처로 지정하면, 경과 시간 대비 누적 경험치와 페이스를 깔끔하게 보여줍니다.
GitHub Pages로 정적 호스팅되어 가볍고 빠릅니다.

---

## 🚀 바로 시작하기
- 라이브 웹앱: https://myungwoo.github.io/mapleland-exp-tracker-web/
- 첫 사용 시 브라우저의 화면 캡처 권한이 필요합니다.

---

## ✨ 주요 기능
- 화면/창 캡처로 게임 창 선택 (브라우저 권한 필요)
- ROI 지정: 레벨, 경험치(예: `XXXXXXXX[YY.YY%]`) 영역 드래그 선택
- 측정 시작/일시정지/재개/초기화 및 Space 단축키
- 누적 경험치(값/퍼센트), 페이스 기준 시간(X분) 기반 페이스 표시, 다음 `N시간 되는 시각` 표시
- 디버그 미리보기(전처리 전/후 이미지)
- 로컬 저장: ROI/설정 자동 유지(LocalStorage)
- PiP 모드(Document Picture‑in‑Picture): 항상 위 미니 창에서 진행 상황 확인, 타이머 제어(시작/일시정지/초기화)

---

## 🧭 튜토리얼로 시작하기
1. 튜토리얼 열기: 처음 접속하면 화면 중앙에 튜토리얼이 표시됩니다.
2. 게임 창 선택: "게임 창 선택"을 눌러 화면/창 캡처 권한을 허용하고, 메이플랜드 게임 창을 선택하세요.
   - 브라우저 정책상 새로고침/재접속 시 다시 선택이 필요합니다.
3. 레벨 ROI 영역 선택: 화면의 레벨 숫자만 포함되도록 드래그해 지정합니다. "LV." 텍스트는 제외하세요.
4. 경험치 ROI 영역 선택: `XXXXXXXX[YY.YY%]` 전체가 들어오도록 드래그해 지정합니다. `EXP.` 텍스트는 제외하세요.
5. 렉이 느리면 측정 주기 조절: 1/5/10초 중에서 선택할 수 있습니다(기본 1초).
6. PiP 모드로 간편하게 보기: "PiP 열기"를 눌러 작은 항상 위 창을 띄웁니다. 해당 창에서 측정 시작/일시정지와 초기화를 바로 제어할 수 있습니다. (최신 크롬 권장, 브라우저 지원 필요)

### 튜토리얼을 건너뛰었거나 다시 설정하려면
- 좌상단 `설정` 버튼을 눌러 설정 창을 연 뒤 `게임 창 선택`을 클릭합니다.
- `레벨 ROI 설정` / `경험치 ROI 설정` 버튼으로 각각 영역을 지정합니다.
- 상단 우측 컨트롤에서 `측정 시작`/`초기화`, `PiP 열기`를 사용할 수 있습니다. Space로 시작/일시정지, R로 초기화가 가능합니다.

---

## 🧪 정확도 팁
- 레벨 숫자는 주황 박스 위 흰색 스프라이트이므로, ROI를 숫자 스트로크가 뚜렷하게 보이도록 작게 지정하세요.
- 해상도가 낮으면 ROI 스케일이 자동 증가하므로, 너무 넓게 잡지 않는 것이 좋습니다.
- EXP는 대괄호 안 퍼센트를 명확히 포함하도록 ROI를 조절하세요.

---

## 🔒 권한과 개인정보
- 화면/창 캡처 권한은 브라우저가 제공하며, 선택한 윈도우 영역만 캡처합니다.
- OCR(Tesseract.js)은 브라우저 내부(Web Worker)에서 동작합니다.
- 캡처 이미지/인식 결과/설정 값은 서버로 전송되지 않으며, ROI/설정은 로컬(LocalStorage)에만 저장됩니다.

---

## 🌐 브라우저 호환성
- 데스크톱 Chrome/Edge 최신 버전 권장
- Safari는 권한 팝업 동작이 다를 수 있습니다.
- 모바일 브라우저는 화면 캡처 제약으로 일부 기능이 제한될 수 있습니다.

---

## 🔧 문제 해결
- "게임 창 선택" 목록이 비어있다면: 브라우저/OS의 화면 녹화 권한을 확인하고 재시도하세요.
- ROI 인식이 불안정하다면: ROI를 더 타이트하게 줄이거나 게임 해상도를 높여보세요.
- 퍼센트가 인식되지 않으면: `[...]` 전체가 ROI 안에 들어왔는지 확인하세요.

---

## 🖥️ 로컬 실행
```bash
npm install
npm run dev
# http://localhost:3000
```
- Node.js 18+ 권장
- 정적 배포: `npm run build && npm run export`

---

## 🧰 기술 스택
- Next.js 15 (App Router, 정적 Export)
- React 18 + TypeScript
- Tailwind CSS
- Tesseract.js (Web Worker OCR)
- Zustand / LocalStorage

---

## 📝 라이선스
이 프로젝트는 MIT 라이선스에 따라 배포됩니다. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.

---

## 🙏 크레딧
- OCR: [Tesseract.js](https://github.com/naptha/tesseract.js)
- 아이디어/요구사항: 레벨/EXP 실시간 측정 및 예측
