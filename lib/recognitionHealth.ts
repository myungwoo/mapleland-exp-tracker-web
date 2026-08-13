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
 * 있어야 합니다. (`tools/recognition-health/selftest.mjs`)
 */

/**
 * 한 샘플의 판독 결과 분류.
 *
 * `ok`가 아닌 것은 모두 "이 샘플은 기록되지 않았다"는 뜻입니다.
 */
export type ReadOutcomeKind =
	/** 누적·차트에 기록됨 */
	| "ok"
	/** 레벨도 경험치도 못 읽음 — 화면 전환/검은 화면/캡처 중단 */
	| "no_signal"
	/** 경험치를 못 읽음 (레벨은 읽힘) */
	| "exp_missing"
	/** 경험치 숫자 일부가 가려져 값이 잘렸음 (정합성 불일치 + 값 앞에 미인식 조각) */
	| "exp_truncated"
	/** 레벨을 못 읽음 (경험치는 읽혔고, 직전 레벨로 대체하는 것도 불가능했음) */
	| "level_missing"
	/** 이상치: 경험치 값과 퍼센트가 테이블 기준으로 맞지 않음 */
	| "pct_value_mismatch"
	/** 이상치: 같은 레벨에서 한 틱에 과도하게 급락 */
	| "implausible_drop"
	/** 위 어디에도 해당하지 않는 실패 (분류 누락 방어) */
	| "unknown";

export type ReadFailureKind = Exclude<ReadOutcomeKind, "ok">;

/**
 * 알림에 쓰이는 원인.
 *
 * 샘플 분류(`ReadFailureKind`)에 **"샘플 자체가 안 들어옴"**(`loop_stalled`)을 더한 것입니다.
 * 후자는 판독 결과가 아니라 시간으로만 알 수 있어서 `classifyReadOutcome`이 만들지 않습니다.
 */
export type RecognitionNoticeKind = ReadFailureKind | "loop_stalled";

export type RecognitionHealthState = {
	/** 마지막으로 기록에 성공한 시각. 한 번도 없으면 null */
	lastOkAt: number | null;
	/**
	 * 마지막으로 샘플이 **처리된** 시각. 성공/실패를 가리지 않습니다. (측정 시작 시각으로 초기화)
	 *
	 * 왜 성공과 따로 재는가: 이 값이 있어야 "인식이 실패하고 있다"와 "루프가 아예 안 돈다"를
	 * 구분할 수 있습니다. 아래 워치독(`describeRecognitionHealth`의 `silenceLimitMs`)이 씁니다.
	 */
	lastSampleAt: number | null;
	/**
	 * 감시자(매초 인터벌)가 마지막으로 돈 시각.
	 *
	 * 왜 필요한가: 감시자는 감시 대상과 같은 시계를 씁니다. 자기 주기가 밀렸다면 브라우저/기기가
	 * 페이지 전체를 재웠다는 뜻이고, 그때의 "샘플이 안 들어왔다"는 근거가 되지 못합니다.
	 * (`applyWatchdogTick`)
	 */
	lastWatchdogTickAt: number | null;
	/** 지금 이어지고 있는 연속 실패가 시작된 시각. 실패 중이 아니면 null */
	failingSince: number | null;
	/** 연속 실패 횟수 (성공하면 0으로 돌아갑니다) */
	consecutiveFailures: number;
	/** 가장 최근 실패의 원인 */
	lastFailureKind: ReadFailureKind | null;
};

/**
 * 이만큼 연속으로 기록이 안 되면 사용자에게 알립니다. **0 = 첫 실패 샘플부터 곧바로 알립니다.**
 *
 * 왜 0인가: 예전에는 5초였습니다. "포탈 이동 중 검은 화면"(1~2초)에 경고가 뜨는 오탐을 막으려던
 * 것인데, 유예가 있으면 표시가 화면 상태를 따라가지 않아서 원인을 찾는 실험 자체가 어려워집니다 —
 * 마우스를 경험치 위에 올려도 몇 초간 아무 반응이 없으니 "이게 원인인가?"를 확인할 수 없습니다.
 * 즉 유예는 오탐을 줄이는 대신 **표시와 원인의 인과관계를 끊습니다.**
 *
 * 대가는 짧은 실패에도 표시가 잠깐 깜빡이는 것입니다. 이게 거슬려서 유예를 되살리더라도
 * **복귀는 반드시 즉시여야 합니다.** 알림이 늦게 뜨는 것보다 늦게 사라지는 쪽이 훨씬 혼란스럽습니다.
 * (사용자는 원인을 없앤 직후 화면을 보는데, 그때 경고가 남아 있으면 조치가 틀린 줄 압니다)
 *
 * 개별 호출에서 유예를 다시 두려면 `describeRecognitionHealth`의 `graceMs`를 넘기세요.
 */
export const RECOGNITION_STALL_GRACE_MS = 0;

/**
 * 이만큼 샘플이 아예 안 들어오면 "루프가 멈췄다"고 봅니다. (주기의 3배)
 *
 * 왜 3배인가: 인식이 측정 주기보다 오래 걸려 한두 틱 밀리는 것은 정상입니다. (단일 in-flight 가드)
 * 3배를 넘겼다면 밀린 게 아니라 돌지 않는 것입니다.
 */
export const RECOGNITION_SILENCE_INTERVAL_FACTOR = 3;

/**
 * 하한. 주기가 1초면 3초인데, 브라우저가 잠깐 버벅인 것만으로 경고가 뜨면 노이즈입니다.
 */
export const RECOGNITION_SILENCE_MIN_MS = 5_000;

/**
 * "이만큼 조용하면 루프가 멈춘 것"의 기준을 정합니다.
 *
 * React에 의존하지 않는 순수 함수로 둔 이유는 이 파일의 나머지와 같습니다. (규칙을 그대로 테스트)
 */
export function recognitionSilenceLimitMs(sampleIntervalMs: number): number {
	const interval = Number.isFinite(sampleIntervalMs) ? Math.max(1, sampleIntervalMs) : 1000;
	return Math.max(interval * RECOGNITION_SILENCE_INTERVAL_FACTOR, RECOGNITION_SILENCE_MIN_MS);
}

/**
 * 감시자 자신의 주기가 이 배수를 넘게 밀렸다면 "우리도 자고 있었다"고 봅니다.
 */
export const RECOGNITION_WATCHDOG_OVERSLEEP_FACTOR = 3;

/**
 * 감시자(매초 도는 인터벌)가 한 번 돌 때마다 호출합니다. **샘플 처리 직후의 재판단에서는 부르지 마세요.**
 * (그건 주기적인 tick이 아니라서, 부르면 자기 주기 측정이 망가집니다)
 *
 * 왜 필요한가 — 감시자는 감시 대상과 **같은 시계를 씁니다.** 브라우저가 백그라운드 탭의 타이머를
 * 늦추거나(1분 단위 정렬) 기기가 절전에 들어가면 측정 루프만 멈추는 게 아니라 이 감시자도 함께
 * 멈춥니다. 그렇게 한참 만에 깨어난 시점에서 "샘플이 오래 안 들어왔다"는 사실은 아무것도
 * 증명하지 못합니다. 우리가 자고 있었으니까요.
 *
 * 그래서 자기 주기가 밀린 것을 감지하면 **침묵 시계를 지금부터 다시 셉니다.** 판단은 "감시자가
 * 정상 주기로 돌고 있는데도 샘플이 안 들어오는" 구간에서만 내려집니다.
 *
 * 이 자가 점검이 탭 가시성(`visibilityState`)으로 기준을 늘리는 것보다 나은 이유:
 * - 가시성은 스로틀링의 **간접 신호**일 뿐입니다. 숨겨져도 안 늦춰질 수 있고(캡처 중, 소리 재생 중
 *   등 예외), 보이는 상태에서도 기기 절전으로 멈출 수 있습니다. 자기 주기는 **실제로 일어난 일**입니다.
 * - 노트북 덮개를 닫았다 여는 경우처럼 가시성으로는 잡히지 않는 공백도 같은 규칙으로 덮입니다.
 * - 감시자가 정상 주기로 도는 한, 경고는 늦춰지지 않습니다. (가시성으로 기준을 늘리면 그만큼 늦어집니다)
 */
export function applyWatchdogTick(
	state: RecognitionHealthState,
	now: number,
	expectedTickMs: number
): RecognitionHealthState {
	const last = state.lastWatchdogTickAt;
	const next: RecognitionHealthState = { ...state, lastWatchdogTickAt: now };
	if (last == null) return next;
	const overslept = now - last > Math.max(1, expectedTickMs) * RECOGNITION_WATCHDOG_OVERSLEEP_FACTOR;
	if (!overslept) return next;
	// 우리도 자고 있었으면 남을 탓할 수 없습니다. 침묵은 지금부터 다시 셉니다.
	return { ...next, lastSampleAt: now };
}

/**
 * 상태를 비웁니다.
 *
 * `startedAt`을 주면 "조용한 시간"을 그 시각부터 셉니다. 측정을 시작/재개할 때 넘기세요.
 * (넘기지 않으면 첫 샘플이 처리될 때까지 워치독이 판단을 보류합니다)
 */
export function emptyRecognitionHealth(startedAt: number | null = null): RecognitionHealthState {
	return {
		lastOkAt: null,
		lastSampleAt: startedAt,
		lastWatchdogTickAt: null,
		failingSince: null,
		consecutiveFailures: 0,
		lastFailureKind: null
	};
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
export function classifyReadOutcome(args: {
	/** 누적·차트에 반영되었는지 */
	isRecorded: boolean;
	/** 레벨을 실제로 읽었는지 (직전 레벨 대체 이전) */
	levelRead: boolean;
	/** 경험치 값과 퍼센트를 모두 읽었는지 */
	expRead: boolean;
	/** 이상치로 걸러졌다면 그 사유 */
	outlierReason?: string | null;
	/**
	 * 경험치 값 바로 앞에 미인식 조각이 붙어 있었는지. (`lib/recognize.ts`의 `hasUnknownBeforeValue`)
	 *
	 * 정합성 불일치의 원인을 가리는 데 씁니다. 불일치만 보면 레벨을 잘못 읽은 것인지 경험치를
	 * 잘못 읽은 것인지 알 수 없는데, 값 앞에 미인식 조각이 붙어 있었다면 원인은 사실상
	 * "경험치 숫자가 가려져 값이 잘린 것"입니다. 정상 판독에서는 값이 맞으므로 이 조합이 나오지 않습니다.
	 */
	expValueHasUnknownPrefix?: boolean;
}): ReadOutcomeKind {
	if (args.isRecorded) return "ok";
	if (args.outlierReason === "pct_value_mismatch") {
		return args.expValueHasUnknownPrefix ? "exp_truncated" : "pct_value_mismatch";
	}
	if (args.outlierReason === "implausible_drop") {
		// 급락도 같은 원인일 수 있습니다. (값이 잘리면 갑자기 작아지므로 급락으로 먼저 걸립니다)
		return args.expValueHasUnknownPrefix ? "exp_truncated" : "implausible_drop";
	}
	// 이상치 사유가 새로 생겼는데 여기에 반영되지 않은 경우를 조용히 삼키지 않습니다.
	if (args.outlierReason) return "unknown";
	if (!args.expRead && !args.levelRead) return "no_signal";
	if (!args.expRead) return "exp_missing";
	if (!args.levelRead) return "level_missing";
	// 둘 다 읽혔는데 기록되지 않았다면 위 분류가 놓친 경로입니다.
	return "unknown";
}

/** 분류 결과를 반영한 새 상태를 돌려줍니다. */
export function applyReadOutcome(
	state: RecognitionHealthState,
	kind: ReadOutcomeKind,
	now: number
): RecognitionHealthState {
	if (kind === "ok") {
		return {
			lastOkAt: now,
			lastSampleAt: now,
			lastWatchdogTickAt: state.lastWatchdogTickAt,
			failingSince: null,
			consecutiveFailures: 0,
			lastFailureKind: null
		};
	}
	return {
		lastOkAt: state.lastOkAt,
		lastWatchdogTickAt: state.lastWatchdogTickAt,
		// 실패한 샘플도 "샘플이 들어온 것"입니다. 워치독은 판독 성공 여부와 무관하게 루프의 생사만 봅니다.
		lastSampleAt: now,
		// 연속 실패의 "시작" 시각은 유지해야 지속 시간을 셀 수 있습니다.
		failingSince: state.failingSince ?? now,
		consecutiveFailures: state.consecutiveFailures + 1,
		lastFailureKind: kind
	};
}

export type RecognitionHealthNotice = {
	kind: RecognitionNoticeKind;
	/** 한 줄 요약 (PiP처럼 좁은 곳에서도 이것만 씁니다) */
	title: string;
	/** 무엇을 확인해야 하는지 */
	detail: string;
	/** 기록이 멈춘 지 얼마나 됐는지 */
	stalledMs: number;
};

const MESSAGES: Record<RecognitionNoticeKind, { title: string; detail: string }> = {
	loop_stalled: {
		// 원인을 단정하지 않습니다. 여기서 알 수 있는 것은 "샘플이 안 들어온다"뿐이고,
		// 브라우저 절전과 앱 문제를 구분할 신호가 없습니다.
		title: "측정이 갱신되지 않고 있습니다",
		detail:
			"브라우저 탭이 절전 상태이거나 앱에 문제가 생겼을 수 있습니다. 이 창을 화면에 띄워 두고, 계속되면 새로고침 후 다시 시작해 주세요."
	},
	no_signal: {
		title: "화면을 읽을 수 없습니다",
		detail: "화면 전환 중이거나 게임 창이 가려졌을 수 있습니다. 계속되면 캡처 중인 창이 맞는지 확인해 주세요."
	},
	exp_missing: {
		title: "경험치를 읽을 수 없습니다",
		detail: "경험치 영역이 마우스 포인터나 다른 창에 가려졌는지 확인해 주세요."
	},
	exp_truncated: {
		title: "경험치 숫자 일부가 가려졌습니다",
		detail: "마우스 포인터가 경험치 숫자 위에 올라가 있는지 확인해 주세요."
	},
	level_missing: {
		title: "레벨을 읽을 수 없습니다",
		detail: "레벨 영역이 마우스 포인터나 다른 창에 가려졌는지 확인해 주세요."
	},
	pct_value_mismatch: {
		// 원인을 단정하지 않습니다. 불일치만으로는 레벨·경험치 중 무엇을 잘못 읽었는지 알 수 없고,
		// 원인이 경험치 가림인 경우는 위 `exp_truncated`가 따로 집어냅니다.
		title: "레벨과 경험치가 서로 맞지 않습니다",
		detail: "설정의 디버그 미리보기로 레벨/경험치가 어떻게 읽히는지 확인해 주세요."
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
 *
 * 기본 유예는 0이므로 첫 실패 샘플에서 이미 알림이 나오고, 그때 `stalledMs`는 0입니다.
 * 표시하는 쪽에서 "0초째"라고 쓰지 않도록 주의하세요.
 *
 * `silenceLimitMs`를 주면 **샘플이 아예 안 들어오는 경우**(측정 루프가 죽은 경우)도 잡습니다.
 * 기준값은 `recognitionSilenceLimitMs`로 만드세요.
 */
export function describeRecognitionHealth(
	state: RecognitionHealthState,
	now: number,
	options: { active: boolean; graceMs?: number; silenceLimitMs?: number }
): RecognitionHealthNotice | null {
	if (!options.active) return null;
	const { failingSince, lastFailureKind } = state;

	// 워치독: 판독 실패보다 **먼저** 봅니다.
	//
	// 왜 우선인가: 샘플이 아예 안 들어오면 `lastFailureKind`는 낡은 정보입니다. 그걸 그대로 띄우면
	// 사용자가 엉뚱한 원인(마우스 가림 등)을 찾게 됩니다. 실제로 있었던 사고입니다 — 측정 루프가
	// 렌더마다 리셋되어 샘플이 한 번도 실행되지 않았는데, 인식이 "실패"한 게 아니라 돌지 않은 것이라
	// 아무 경고도 뜨지 않았습니다. 화면에는 경과 시간만 흐르고 경험치·페이스가 멈춰 있었습니다.
	if (options.silenceLimitMs != null && state.lastSampleAt != null) {
		const silentMs = now - state.lastSampleAt;
		if (silentMs >= options.silenceLimitMs) {
			const msg = MESSAGES.loop_stalled;
			return {
				kind: "loop_stalled",
				title: msg.title,
				detail: msg.detail,
				// "기록이 멈춘 지"이므로 마지막 성공 시점부터 셉니다. (한 번도 성공한 적 없으면 측정 시작부터)
				stalledMs: Math.max(0, now - (state.lastOkAt ?? state.lastSampleAt))
			};
		}
	}
	if (failingSince == null || lastFailureKind == null) return null;
	const stalledMs = Math.max(0, now - failingSince);
	if (stalledMs < (options.graceMs ?? RECOGNITION_STALL_GRACE_MS)) return null;
	const msg = MESSAGES[lastFailureKind];
	return { kind: lastFailureKind, title: msg.title, detail: msg.detail, stalledMs };
}

/**
 * 좁은 곳(PiP 툴팁, 요약 카드 표시등 툴팁)에 쓸 한 줄 문구를 만듭니다.
 *
 * 지속 시간은 1초 이상일 때만 붙입니다. 유예가 없으므로 첫 샘플에서는 0초인데,
 * "(0초)"는 정보가 없으면서 문구만 어수선하게 만듭니다.
 */
export function formatRecognitionHealthOneLine(notice: RecognitionHealthNotice): string {
	const seconds = Math.floor(notice.stalledMs / 1000);
	return seconds >= 1 ? `${notice.title} (${seconds}초)` : notice.title;
}

/**
 * 알림이 "사실상 같은지" 비교합니다.
 *
 * 왜: 지속 시간은 매초 늘어나므로 객체를 그대로 비교하면 매초 상태가 바뀐 것으로 보입니다.
 * 표시는 초 단위이므로 초가 바뀌지 않았다면 같은 알림으로 취급해 불필요한 렌더를 막습니다.
 */
export function recognitionHealthNoticeEquals(
	a: RecognitionHealthNotice | null,
	b: RecognitionHealthNotice | null
): boolean {
	if (a == null || b == null) return a === b;
	return a.kind === b.kind && Math.floor(a.stalledMs / 1000) === Math.floor(b.stalledMs / 1000);
}
