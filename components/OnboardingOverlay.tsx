import React from "react";
import Image from "next/image";
import { assetPath } from "@/lib/assetPath";

type Props = {
  open: boolean;
  step: number; // 0..4
  hasStream: boolean;
  pipSupported?: boolean;
  onSelectWindow: () => Promise<void> | void;
  onActivateLevel: () => void;
  onActivateExp: () => void;
  onSetIntervalSec: (sec: number) => void;
  onNext: () => void;
  onSkip: () => void;
  onClose: () => void;
  // Existing ROI previews
  hasLevelRoi?: boolean;
  levelRoiPreview?: string | null;
  hasExpRoi?: boolean;
  expRoiPreview?: string | null;
  // OCR texts
  ocrLevelText?: string | null;
  ocrExpText?: string | null;
  // Current sampling interval (for step 4 button labels)
  currentIntervalSec?: number;
  // Open PiP (for step 5)
  onOpenPip?: () => void;
};

const stepTitles = [
  "1. 메이플랜드 게임 창 선택",
  "2. 레벨 ROI 영역 선택",
  "3. 경험치 ROI 영역 선택",
  "4. 렉이 느려지면 샘플링 간격 조절",
  "5. PIP 모드로 간편하게 보기"
] as const;

export default function OnboardingOverlay(props: Props) {
  if (!props.open) return null;
  const { step } = props;

  const renderBody = () => {
    switch (step) {
      case 0:
        return (
          <>
            <p className="text-white/90">
              브라우저 정책상 페이지를 새로 열 때마다 추적할 게임 창을 다시 선택해야 합니다.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button className="btn btn-primary" onClick={() => props.onSelectWindow()}>
                게임 창 선택
              </button>
              {props.hasStream ? <span className="text-emerald-300 text-sm">선택됨</span> : null}
            </div>
          </>
        );
      case 1:
        return (
          <>
            <p className="text-white/90">
              화면의 레벨 숫자만 포함되도록 영역을 드래그해서 지정하세요. 영역 안에 <span className="font-semibold">&quot;LV.&quot;</span> 텍스트는 포함되지 않도록 해주세요.
              게임 창 크기를 바꾸면 ROI를 다시 설정해야 합니다.
            </p>
            <div className="mt-3 p-3 rounded border border-white/15 bg-white/5">
              <div className="text-sm text-white/80 mb-2">올바른 선택 예시</div>
              <Image
                src={assetPath("/examples/level-roi.png")}
                alt="레벨 ROI 올바른 선택 예시"
                width={640}
                height={200}
                className="max-h-36 w-auto rounded border border-white/10 bg-black/40"
              />
            </div>
            {props.hasLevelRoi ? (
              <div className="mt-3 p-3 rounded border border-white/15 bg-white/5">
                <div className="text-sm text-white/80 mb-2">이미 선택한 ROI가 있습니다. 확인하고 이상이 없으면 건너뛰셔도 됩니다.</div>
                {props.levelRoiPreview ? (
                  // 왜: dataURL 미리보기는 next/image 최적화 이점이 거의 없어 <img>를 사용합니다.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={props.levelRoiPreview}
                    alt="선택된 레벨 ROI 미리보기"
                    className="max-h-32 rounded border border-white/10"
                  />
                ) : null}
                {typeof props.ocrLevelText === "string" ? (
                  <div className="mt-2">
                    <div className="text-xs text-white/70 mb-1">인식된 텍스트 (1초마다 갱신)</div>
                    <pre className="text-xs bg-black/40 border border-white/10 rounded p-2 whitespace-pre-wrap break-all">
                      {props.ocrLevelText || "-"}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4">
              <button className="btn" onClick={props.onActivateLevel}>레벨 ROI 설정</button>
            </div>
          </>
        );
      case 2:
        return (
          <>
            <p className="text-white/90">
              경험치 문자열 전체가 들어오도록 선택하세요. <span className="font-semibold">&quot;EXP.&quot;</span> 텍스트는 제외하고, 맨 왼쪽 숫자부터 맨 오른쪽 닫는 괄호 <span className="font-mono">]</span>까지 포함되게 하세요.
              위아래로 약간의 여백을 두면 인식이 더 정확합니다. 게임 창 크기를 바꾸면 ROI를 다시 설정해야 합니다.
            </p>
            <div className="mt-3 p-3 rounded border border-white/15 bg-white/5">
              <div className="text-sm text-white/80 mb-2">올바른 선택 예시</div>
              <Image
                src={assetPath("/examples/exp-roi.png")}
                alt="경험치 ROI 올바른 선택 예시"
                width={640}
                height={200}
                className="max-h-36 w-auto rounded border border-white/10 bg-black/40"
              />
            </div>
            {props.hasExpRoi ? (
              <div className="mt-3 p-3 rounded border border-white/15 bg-white/5">
                <div className="text-sm text-white/80 mb-2">이미 선택한 ROI가 있습니다. 확인하고 이상이 없으면 건너뛰셔도 됩니다.</div>
                {props.expRoiPreview ? (
                  // 왜: dataURL 미리보기는 next/image 최적화 이점이 거의 없어 <img>를 사용합니다.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={props.expRoiPreview}
                    alt="선택된 경험치 ROI 미리보기"
                    className="max-h-32 rounded border border-white/10"
                  />
                ) : null}
                {typeof props.ocrExpText === "string" ? (
                  <div className="mt-2">
                    <div className="text-xs text-white/70 mb-1">인식된 텍스트 (1초마다 갱신)</div>
                    <pre className="text-xs bg-black/40 border border-white/10 rounded p-2 whitespace-pre-wrap break-all">
                      {props.ocrExpText || "-"}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4">
              <button className="btn" onClick={props.onActivateExp}>경험치 ROI 설정</button>
            </div>
          </>
        );
      case 3:
        const cur = props.currentIntervalSec ?? 1;
        const options = [1, 5, 10] as const;
        return (
          <>
            <p className="text-white/90">
              측정으로 인해 렉이 느껴진다면 샘플링 간격을 늘려보세요. 기본은 <span className="font-semibold">1초</span>입니다.
            </p>
            <div className="mt-4 flex items-center gap-2">
              {options.map((s) => {
                const isCurrent = s === cur;
                const label = isCurrent ? `${s}초 (선택됨)` : `${s}초로 변경`;
                return (
                  <button
                    key={s}
                    className={isCurrent ? "btn btn-primary" : "btn"}
                    onClick={() => props.onSetIntervalSec(s)}
                    disabled={isCurrent}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </>
        );
      case 4:
        return (
          <>
            <p className="text-white/90">
              PIP(Document Picture‑in‑Picture) 모드를 사용하면 작은 항상-위 창으로 진행 상황을 볼 수 있어요.
              타이머 시작/일시정지, 초기화를 PIP 창에서도 바로 할 수 있습니다.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <div className="relative inline-block group">
                <button
                  className={`btn btn-primary ${props.pipSupported === false ? "cursor-not-allowed opacity-70" : ""}`}
                  onClick={() => props.onOpenPip && props.onOpenPip()}
                  disabled={props.pipSupported === false}
                  aria-disabled={props.pipSupported === false}
                  aria-label="PIP 열기"
                >
                  PIP 열기
                </button>
                {props.pipSupported === false && (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-pre rounded border border-white/10 bg-black/90 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
                  >
                    이 브라우저에서는 문서 PIP(Document Picture-in-Picture) 기능을 지원하지 않습니다. 이 기능을 사용하려면 최신 버전의 Chrome 또는 Edge 브라우저를 이용해 주세요.
                  </div>
                )}
              </div>
              <span className="text-xs text-white/70">PIP 지원을 위해 최신 Chrome·Edge 사용을 권장합니다.</span>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 text-white flex items-center justify-center p-4"
      style={{ pointerEvents: "none" }}
      aria-live="polite"
    >
      <div
        className="max-w-2xl w-full rounded-lg border border-white/10 bg-black/60 backdrop-blur p-6 shadow-xl"
        style={{ pointerEvents: "auto" }}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h3 className="text-xl font-semibold mb-2">{stepTitles[step] || ""}</h3>
            {renderBody()}
          </div>
          <button
            className="btn"
            onClick={props.onClose}
            aria-label="튜토리얼 닫기"
            title="닫기"
          >
            닫기
          </button>
        </div>
        <div className="mt-6 flex items-center justify-between">
          <button className="btn text-white/80" onClick={props.onSkip}>건너뛰기</button>
          <div className="flex items-center gap-2">
            <div className="text-sm opacity-70">{step + 1}/5</div>
            <button className="btn btn-primary" onClick={props.onNext}>
              {step >= 4 ? "완료" : "다음"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

