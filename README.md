# 메이플 경험치 측정기 ⏱️📈

[![Website - Live](https://img.shields.io/badge/Website-Live-2ea44f?style=flat&logo=githubpages)](https://myungwoo.github.io/mapleland-exp-tracker-web/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3.x-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Deploy](https://github.com/myungwoo/mapleland-exp-tracker-web/actions/workflows/gh-pages.yml/badge.svg)](.github/workflows/gh-pages.yml)

게임 창을 선택하고 레벨/경험치 영역(ROI)을 OCR로 읽어, 경과 시간 동안 얻은 경험치를 측정·예측하는 웹앱입니다.
설치 없이 브라우저에서 동작하며, GitHub Pages로 정적 호스팅이 가능합니다.

---

## ✨ 기능
- 화면/창 캡처로 게임 창 선택 (브라우저 권한 필요)
- ROI 지정: 레벨, 경험치(예: `XXXXXXXX[YY.YY%]`) 영역 드래그 선택
- 타이머 시작/일시정지/재개/초기화 및 Space 단축키
- 누적 경험치(값/퍼센트), 평균 표시 시간 기반 예상값, 다음 `N시간 되는 시각` 표시
- 디버그 미리보기(전처리 전/후 이미지)
- 로컬 저장: ROI/설정 유지

---

## 🧰 기술 스택
- Next.js 15 (App Router, 정적 Export)
- React 18 + TypeScript
- Tailwind CSS
- Tesseract.js (Web Worker OCR)
- Zustand(간단 상태) / LocalStorage

---

## 🖥️ 로컬 실행
```bash
npm install
npm run dev
# http://localhost:3000 접속
```

---

## 🖱️ 사용 방법
1. 우상단 “설정” → “게임 창 선택”으로 캡처 권한 허용
2. ROI 설정에서 “레벨 ROI 설정”, “경험치 ROI 설정”을 각각 드래그로 지정
   - 레벨: 숫자만 포함하도록 타이트하게
   - 경험치: `XXXXXXXX[YY.YY%]` 전체 문자열이 들어오도록
3. “타이머 시작”(또는 Space)
4. 메인 화면에서
   - ⏱️ 경과 시간(HH:MM:ss)
   - 📈 현재까지 획득한 경험치(값) [퍼센트%]
   - 🕒 다음 `N시간 되는 시각`
   - 📊 평균 표시 시간({설정값}분) 동안 평균 경험치 예상량

---

## 🧪 정확도 팁
- 레벨 숫자는 주황 박스 위 흰색 스프라이트이므로, ROI를 숫자 스트로크가 잘 보이게 작게 지정하세요.
- 해상도가 낮으면 ROI 스케일이 자동 증가하니, 너무 넓게 잡지 않는 것이 좋습니다.
- EXP는 대괄호 안 퍼센트가 명확히 포함되도록 ROI를 조절하세요.

---

## 📝 라이선스
MIT © 2025

---

## 🙏 크레딧
- OCR: [Tesseract.js](https://github.com/naptha/tesseract.js)
- 아이디어/요구사항: 레벨/EXP 실시간 측정 및 예측
