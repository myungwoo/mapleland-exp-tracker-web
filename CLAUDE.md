# CLAUDE.md

이 파일은 Claude Code(및 다른 AI 에이전트)가 이 저장소에서 작업할 때 필요한 규칙과 도메인 지식을 정리한 것입니다.

## 프로젝트 한 줄 요약

메이플랜드 게임 화면을 브라우저에서 캡처해 **레벨과 경험치를 OCR로 읽어** 누적 EXP·페이스를 실시간으로 보여주는 정적 웹앱입니다. 서버가 없고(GitHub Pages 정적 배포), 모든 처리는 브라우저에서 일어납니다.

## 명령

```bash
npm run dev              # 개발 서버 (http://localhost:3000)
npm run build            # 정적 export → out/  (next.config.js의 output: "export")
npm run lint             # ESLint
npx tsc --noEmit         # 타입 검사
npm run test:pixel-font  # 픽셀 글꼴 인식기 자체 검증 (유일한 자동 테스트)
```

변경 후에는 **최소한 타입 검사와 lint**를, 인식 로직을 건드렸다면 `test:pixel-font`까지 돌려 주세요.

## 코드 스타일

- **주석·커밋 메시지·UI 문구는 한국어**로 씁니다.
- 주석은 "무엇"이 아니라 **"왜"** 를 적습니다. 이 저장소는 `// 왜: ...` 형태를 관례로 씁니다. 특히 브라우저/OCR 관련 우회 코드에는 반드시 이유를 남기세요. (없으면 다음 사람이 "불필요해 보이는 코드"로 지웁니다)
- 들여쓰기는 **탭**입니다. (`components/PaceChart.tsx`, `lib/pip/*`, `lib/assetPath.ts`는 스페이스로 남아 있는 예외입니다)
- 문자열은 쌍따옴표, 세미콜론을 씁니다.
- `cn()`(`lib/cn.ts`)으로 Tailwind 클래스를 조합합니다. `classnames`를 직접 import하지 마세요.
- 새 파일을 만들 때 Tailwind 클래스를 쓰면 `tailwind.config.ts`의 `content`에 해당 경로가 포함되는지 확인하세요.

## 디렉터리 구조

| 경로 | 역할 |
|---|---|
| `app/` | Next.js App Router. 페이지는 사실상 `ExpTracker` 하나입니다. |
| `components/` | UI 컴포넌트. `ExpTracker.tsx`가 전체를 조립하는 컨테이너입니다. |
| `features/exp-tracker/hooks/` | 측정 관련 훅(캡처, OCR 샘플링, 스톱워치, 차트 시리즈, 공유, 외부 WS) |
| `features/exp-tracker/records/` | 기록 저장(IndexedDB) + 스냅샷 정규화/버전 마이그레이션 |
| `lib/` | 순수 로직(OCR, 캔버스, EXP 테이블, 포맷, 페이스 계산, PiP) |
| `hooks/` | 앱 전역 훅(전역 단축키) |
| `tools/pixel-font/` | 픽셀 글꼴 템플릿 추출·검증 Node 스크립트 |
| `tools/hotkey-ws/` | (고급) 전역 핫키 → 로컬 WebSocket 브로드캐스트 Python GUI |

**원칙**: 측정 로직은 훅으로 분리하고, `ExpTracker`는 조립만 합니다. 계산이 필요한 코드는 React에 의존하지 않는 `lib/`의 순수 함수로 빼세요. (테스트와 재사용이 쉬워집니다)

## 반드시 알아야 하는 도메인 지식

### 1. EXP와 레벨은 인식 방식이 완전히 다릅니다

- **EXP**: 메이플랜드 2.0의 EXP 텍스트는 안티에일리어싱이 없는 **5x7px 비트맵 글꼴**입니다. 그래서 Tesseract를 쓰지 않고 `lib/pixelOcr.ts`가 **픽셀 단위 템플릿 매칭**으로 읽습니다. 훨씬 정확하고 훨씬 쌉니다.
  - **ROI 캔버스는 반드시 원본 배율(scale: 1)로 넘겨야 합니다.** 확대하거나 이진화하면 글리프가 뭉개져서 인식이 망가집니다.
  - 글리프 템플릿(`lib/pixelFont.ts`)은 **반드시 실제 게임 캡처에서** 뽑아야 합니다. 비슷한 시스템 폰트에서 유추하면 5, 7 같은 글자가 틀립니다. (실제로 틀렸던 이력이 있습니다)
  - 확신이 없으면 `null`을 반환합니다. **틀린 값을 흘리는 것보다 측정을 건너뛰는 게 낫습니다.**
- **레벨**: 오렌지 타일 위 스프라이트 숫자라 픽셀 글꼴이 아닙니다. `lib/canvas.ts`의 색 기반 전처리 후 **Tesseract**(`lib/ocr.ts`)로 읽습니다. 워커 하나를 공유하며 `setParameters`로 모드를 바꿔 쓰므로, **동시 실행되면 서로의 파라미터를 덮어씁니다.**

### 2. 이상치 필터가 측정 품질의 핵심입니다

`features/exp-tracker/hooks/useOcrSampling.ts`가 `EXP_TABLE`(레벨별 필요 EXP)을 기준으로 OCR 결과를 검증합니다: 값↔퍼센트 정합성, 레벨 급변(`level_jump`), 같은 레벨에서의 과도한 급락(`implausible_drop`, 사망 패널티는 최대 10%p). 이상치는 누적/차트에 반영하지 않습니다. **임계값을 바꿀 때는 왜 그 값인지 주석에 남기세요.**

### 3. ROI는 "비디오 픽셀 좌표"로 저장됩니다

`lib/canvas.ts`의 `toVideoSpaceRect`는 정수화만 합니다. 캡처 해상도나 게임 창 크기가 바뀌면 ROI가 어긋나므로 사용자가 다시 지정해야 합니다. ROI 저장 방식을 바꾸려면 `RoiOverlay`(CSS↔비디오 좌표 변환)와 이 함수를 함께 고쳐야 합니다.

### 4. 측정 루프는 setInterval + 단일 in-flight 가드입니다

OCR이 측정 주기보다 오래 걸릴 수 있어서, 동시에 여러 샘플이 쌓이지 않도록 in-flight Promise로 막습니다. 인터벌 콜백에 **렌더 시점의 함수를 그대로 넘기면 stale closure**가 되어 "측정 중 설정 변경이 반영되지 않는" 버그가 생깁니다. 최신 함수를 ref로 참조하세요.

### 5. 상태 저장 위치

- `localStorage`: 설정 (`intervalSec`, `roiLevel`, `roiExp`, `paceWindowMin`, `expPercentValidationEnabled`, `chartShowAxisLabels`, `chartShowGrid`, `onboardingDone`) — `lib/persist.ts`의 `usePersistentState`
- `IndexedDB`: 측정 기록 (`features/exp-tracker/records/`) — 예전에는 localStorage였고 마이그레이션 코드가 남아 있습니다.
- 기록 스냅샷은 **버전이 있고 하위 호환을 지킵니다.** 포맷을 바꾸면 `records/snapshot.ts`의 `normalizeSnapshot`에 마이그레이션을 추가하세요. 사용자가 내보낸 JSON 파일이 있으므로 옛 버전을 깨면 안 됩니다.

### 6. 서버가 없습니다

`output: "export"` 정적 빌드이고 GitHub Pages 서브패스로 배포됩니다. 그래서:

- 서버 컴포넌트에서의 데이터 fetch, API 라우트, 미들웨어, `next/image` 최적화를 쓸 수 없습니다.
- `<img>`나 CSS에서 asset을 참조할 때는 `lib/assetPath.ts`의 `assetPath()`로 basePath를 붙여야 합니다.
- SSR 단계에는 `window`/`document`/`localStorage`가 없습니다. 브라우저 API는 `useEffect` 안에서 접근하고, 지원 여부 판별(예: 문서 PiP)도 마운트 이후에 하세요. (그렇지 않으면 hydration 불일치가 납니다)

## 자주 실수하는 지점

- 픽셀을 되읽을 캔버스는 `getContext("2d", { willReadFrequently: true })`로 만들어야 합니다. **컨텍스트 속성은 처음 생성할 때만 반영**되므로, 캔버스를 만드는 쪽(`lib/canvas.ts`)에서 플래그를 주지 않으면 나중에 되읽는 쪽에서 같은 옵션으로 요청해도 무시됩니다.
- 캔버스는 `useRef`로 재사용합니다. 매 샘플 새로 만들면 GC 압박이 커집니다. 단, SSR에서 `document.createElement`를 호출하지 않도록 지연 생성하세요.
- `toDataURL()`은 비쌉니다. 디버그 미리보기에서만 쓰고 갱신 주기를 제한하세요.
- 장시간(수 시간) 실행을 전제로 합니다. 히스토리 포인트 상한, Tesseract 워커 주기적 재시작 같은 방어 코드를 함부로 제거하지 마세요.

## 배포

`main`에 push하면 `.github/workflows/gh-pages.yml`이 `GITHUB_PAGES=true`로 빌드해 `out/`을 GitHub Pages에 배포합니다.
