/**
 * 인식 상태(= 지금 측정이 기록되고 있는지) 추적
 *
 * 왜 필요한가:
 * 인식에 실패한 샘플은 누적·차트에 반영되지 않고 **조용히** 버려집니다. 짧은 실패(포탈 이동 중
 * 검은 화면)는 그래도 괜찮습니다 — EXP는 절대값이라 가림이 풀린 뒤 직전 유효 샘플과의 차분으로
 * 그동안 오른 EXP가 한 번에 회수되기 때문입니다.
 *
 * 문제는 실패가 길어질 때입니다. 마우스 포인터를 ROI 위에 올려둔 채 30분을 사냥하면 그 30분은
 * 한 점도 기록되지 않는데, 화면에는 경과 시간만 늘어나고 페이스가 서서히 떨어질 뿐이라
 * 사용자가 원인을 알 방법이 없었습니다. 그래서 "왜 기록이 안 되는지"를 화면에 띄웁니다.
 *
 * React에 의존하지 않는 순수 함수로 둔 이유: 유예 시간/원인 분류 규칙을 그대로 테스트할 수
 * 있어야 합니다. (`tools/ocr-health/selftest.mjs`)
 */

/**
 * 한 샘플의 판독 결과 분류.
 *
 * `ok`가 아닌 것은 모두 "이 샘플은 기록되지 않았다"는 뜻입니다.
 */
export type OcrOutcomeKind =
	/** 누적·차트에 기록됨 */
	| "ok"
	/** 레벨도 경험치도 못 읽음 — 화면 전환/검은 화면/캡처 중단 */
	| "no_signal"
	/** 경험치를 못 읽음 (레벨은 읽힘) */
	| "exp_missing"
	/** 레벨을 못 읽음 (경험치는 읽혔고, 직전 레벨로 대체하는 것도 불가능했음) */
	| "level_missing"
	/** 이상치: 경험치 값과 퍼센트가 테이블 기준으로 맞지 않음 */
	| "pct_value_mismatch"
	/** 이상치: 같은 레벨에서 한 틱에 과도하게 급락 */
	| "implausible_drop"
	/** 위 어디에도 해당하지 않는 실패 (분류 누락 방어) */
	| "unknown";

export type OcrFailureKind = Exclude<OcrOutcomeKind, "ok">;

export type OcrHealthState = {
	/** 마지막으로 기록에 성공한 시각. 한 번도 없으면 null */
	lastOkAt: number | null;
	/** 지금 이어지고 있는 연속 실패가 시작된 시각. 실패 중이 아니면 null */
	failingSince: number | null;
	/** 연속 실패 횟수 (성공하면 0으로 돌아갑니다) */
	consecutiveFailures: number;
	/** 가장 최근 실패의 원인 */
	lastFailureKind: OcrFailureKind | null;
};

/**
 * 이만큼 연속으로 기록이 안 되면 사용자에게 알립니다.
 *
 * 왜 5초인가: 막아야 할 오탐은 "포탈 이동 중 검은 화면"입니다. 실제로 1~2초면 끝나므로
 * 5초면 충분히 걸러집니다. 반대로 ROI가 가려진 경우는 사용자가 알아채기 전까지 계속되므로,
 * 이 값을 더 키우면 알림이 늦어지는 손해만 있습니다.
 */
export const OCR_STALL_GRACE_MS = 5_000;

export function emptyOcrHealth(): OcrHealthState {
	return { lastOkAt: null, failingSince: null, consecutiveFailures: 0, lastFailureKind: null };
}

/**
 * 샘플 하나의 판독 결과를 분류합니다.
 *
 * `isRecorded`는 실제로 누적·차트에 반영되었는지입니다. (이상치로 걸러진 것도 false)
 * `outlierReason`이 있으면 그게 곧 원인입니다. 없으면 무엇을 못 읽었는지로 갈라냅니다.
 *
 * 주의: `levelRead`에는 **원본 판독**을 넘겨야 합니다. 직전 레벨로 대체한 값을 넘기면
 * "레벨을 못 읽고 있다"는 사실 자체가 사라집니다.
 */
export function classifyOcrOutcome(args: {
	/** 누적·차트에 반영되었는지 */
	isRecorded: boolean;
	/** 레벨을 실제로 읽었는지 (직전 레벨 대체 이전) */
	levelRead: boolean;
	/** 경험치 값과 퍼센트를 모두 읽었는지 */
	expRead: boolean;
	/** 이상치로 걸러졌다면 그 사유 */
	outlierReason?: string | null;
}): OcrOutcomeKind {
	if (args.isRecorded) return "ok";
	if (args.outlierReason === "pct_value_mismatch") return "pct_value_mismatch";
	if (args.outlierReason === "implausible_drop") return "implausible_drop";
	// 이상치 사유가 새로 생겼는데 여기에 반영되지 않은 경우를 조용히 삼키지 않습니다.
	if (args.outlierReason) return "unknown";
	if (!args.expRead && !args.levelRead) return "no_signal";
	if (!args.expRead) return "exp_missing";
	if (!args.levelRead) return "level_missing";
	// 둘 다 읽혔는데 기록되지 않았다면 위 분류가 놓친 경로입니다.
	return "unknown";
}

/** 분류 결과를 반영한 새 상태를 돌려줍니다. */
export function applyOcrOutcome(state: OcrHealthState, kind: OcrOutcomeKind, now: number): OcrHealthState {
	if (kind === "ok") {
		return { lastOkAt: now, failingSince: null, consecutiveFailures: 0, lastFailureKind: null };
	}
	return {
		lastOkAt: state.lastOkAt,
		// 연속 실패의 "시작" 시각은 유지해야 지속 시간을 셀 수 있습니다.
		failingSince: state.failingSince ?? now,
		consecutiveFailures: state.consecutiveFailures + 1,
		lastFailureKind: kind
	};
}

export type OcrHealthNotice = {
	kind: OcrFailureKind;
	/** 한 줄 요약 (PiP처럼 좁은 곳에서도 이것만 씁니다) */
	title: string;
	/** 무엇을 확인해야 하는지 */
	detail: string;
	/** 기록이 멈춘 지 얼마나 됐는지 */
	stalledMs: number;
};

const MESSAGES: Record<OcrFailureKind, { title: string; detail: string }> = {
	no_signal: {
		title: "화면을 읽을 수 없습니다",
		detail: "화면 전환 중이거나 게임 창이 가려졌을 수 있습니다. 계속되면 캡처 중인 창이 맞는지 확인해 주세요."
	},
	exp_missing: {
		title: "경험치를 읽을 수 없습니다",
		detail: "경험치 영역이 마우스 포인터나 다른 창에 가려졌는지 확인해 주세요."
	},
	level_missing: {
		title: "레벨을 읽을 수 없습니다",
		detail: "레벨 영역이 마우스 포인터나 다른 창에 가려졌는지 확인해 주세요."
	},
	pct_value_mismatch: {
		title: "경험치 값과 퍼센트가 맞지 않습니다",
		detail: "레벨을 잘못 읽고 있을 수 있습니다. 설정에서 레벨 영역을 다시 확인해 주세요."
	},
	implausible_drop: {
		title: "경험치가 갑자기 크게 줄었습니다",
		detail: "일시적인 오인식이면 곧 회복됩니다. 계속되면 초기화 후 다시 시작해 주세요."
	},
	unknown: {
		title: "측정이 기록되지 않고 있습니다",
		detail: "설정의 디버그 미리보기로 레벨/경험치가 어떻게 읽히는지 확인해 주세요."
	}
};

/**
 * 사용자에게 띄울 알림을 만듭니다. 알릴 것이 없으면 null입니다.
 *
 * `active`가 false면(측정 중이 아니면) 항상 null입니다. 측정을 멈춰 둔 상태에서
 * "기록이 안 되고 있다"고 알리는 것은 의미가 없습니다.
 */
export function describeOcrHealth(
	state: OcrHealthState,
	now: number,
	options: { active: boolean; graceMs?: number }
): OcrHealthNotice | null {
	if (!options.active) return null;
	const { failingSince, lastFailureKind } = state;
	if (failingSince == null || lastFailureKind == null) return null;
	const stalledMs = Math.max(0, now - failingSince);
	if (stalledMs < (options.graceMs ?? OCR_STALL_GRACE_MS)) return null;
	const msg = MESSAGES[lastFailureKind];
	return { kind: lastFailureKind, title: msg.title, detail: msg.detail, stalledMs };
}

/**
 * 알림이 "사실상 같은지" 비교합니다.
 *
 * 왜: 지속 시간은 매초 늘어나므로 객체를 그대로 비교하면 매초 상태가 바뀐 것으로 보입니다.
 * 표시는 초 단위이므로 초가 바뀌지 않았다면 같은 알림으로 취급해 불필요한 렌더를 막습니다.
 */
export function ocrHealthNoticeEquals(a: OcrHealthNotice | null, b: OcrHealthNotice | null): boolean {
	if (a == null || b == null) return a === b;
	return a.kind === b.kind && Math.floor(a.stalledMs / 1000) === Math.floor(b.stalledMs / 1000);
}
