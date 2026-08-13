#!/usr/bin/env node
/**
 * 인식 상태(기록이 멈췄는지) 추적 자체 검증
 *
 *   node tools/recognition-health/selftest.mjs
 *
 * 이 로직이 지켜야 하는 성질을 검증합니다.
 * - 첫 실패 샘플부터 곧바로 경고함 (기본 유예 0 — 표시가 화면 상태를 즉시 따라가야 합니다)
 * - 원인을 정확히 지목하고, 알 수 없는 것은 단정하지 않음
 * - 성공 한 번으로 즉시 정상 복귀 (실패 이력이 남아 경고가 끈적하게 붙어 있으면 안 됩니다)
 * - 측정 중이 아니면 절대 경고하지 않음
 * - **샘플이 아예 안 들어오는 경우(측정 루프가 죽은 경우)도 잡음** — 인식 실패와 달리 판독 결과가
 *   생기지 않아서, 워치독이 없으면 화면이 정상으로 보인 채 기록만 멈춥니다
 * - 유예를 다시 두고 싶으면 `graceMs`로 가능함 (되살릴 때의 탈출구)
 *
 * 왜 이 테스트가 중요한가:
 * 원래 문제는 "마우스로 ROI를 가린 채 30분을 날리는 것"입니다. 표시가 늦거나(유예가 크거나)
 * 복귀가 늦으면 사용자가 원인과 표시를 연결할 수 없어 이 알림이 무의미해집니다.
 */
import { loadLibModules } from "../pixel-font/loadLib.mjs";

const {
	emptyRecognitionHealth,
	classifyReadOutcome,
	applyReadOutcome,
	describeRecognitionHealth,
	recognitionSilenceLimitMs,
	applyWatchdogTick,
	formatRecognitionHealthOneLine,
	recognitionHealthNoticeEquals,
	RECOGNITION_STALL_GRACE_MS
} = await loadLibModules(["recognitionHealth"], "recognitionHealth");

let failures = 0;
const check = (name, ok, extra = "") => {
	if (!ok) {
		failures++;
		console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
	}
};

/** 샘플 하나를 상태에 밀어넣는 헬퍼 */
function feed(state, args, now) {
	return applyReadOutcome(state, classifyReadOutcome(args), now);
}

const OK = { isRecorded: true, levelRead: true, expRead: true };
const BLACK = { isRecorded: false, levelRead: false, expRead: false };
const EXP_GONE = { isRecorded: false, levelRead: true, expRead: false };
const LEVEL_GONE = { isRecorded: false, levelRead: false, expRead: true };
const MISMATCH = { isRecorded: false, levelRead: true, expRead: true, outlierReason: "pct_value_mismatch" };
const DROP = { isRecorded: false, levelRead: true, expRead: true, outlierReason: "implausible_drop" };

// ---- 원인 분류 ----
check("정상 샘플은 ok", classifyReadOutcome(OK) === "ok");
check("둘 다 못 읽으면 no_signal", classifyReadOutcome(BLACK) === "no_signal");
check("경험치만 못 읽으면 exp_missing", classifyReadOutcome(EXP_GONE) === "exp_missing");
check("레벨만 못 읽으면 level_missing", classifyReadOutcome(LEVEL_GONE) === "level_missing");
check("이상치 사유가 그대로 원인", classifyReadOutcome(MISMATCH) === "pct_value_mismatch");
check("급락 사유가 그대로 원인", classifyReadOutcome(DROP) === "implausible_drop");
check(
	"기록됐다면 사유가 있어도 ok",
	classifyReadOutcome({ ...OK, outlierReason: "implausible_drop" }) === "ok",
	"기록된 샘플을 실패로 세면 경고가 오작동합니다"
);
check(
	"모르는 이상치 사유는 unknown으로 드러남",
	classifyReadOutcome({ isRecorded: false, levelRead: true, expRead: true, outlierReason: "새로운_사유" }) ===
		"unknown",
	"사유가 새로 생겼는데 조용히 삼키면 안 됩니다"
);

// ---- 정합성 불일치의 원인이 "경험치 가림"인지 가려냅니다 ----
// 마우스 포인터가 경험치 앞자리를 통째로 가리면 값이 조용히 잘리고, 잘린 값은 퍼센트와 맞지
// 않아 불일치로 걸립니다. 이때 "레벨을 잘못 읽고 있다"고 안내하면 사용자가 엉뚱한 곳을 봅니다.
check(
	"불일치 + 값 앞 미인식 조각 → 경험치 잘림으로 분류",
	classifyReadOutcome({ ...MISMATCH, expValueHasUnknownPrefix: true }) === "exp_truncated",
	"원인이 경험치인데 레벨 문제로 안내하면 안 됩니다"
);
check(
	"불일치 + 미인식 조각 없음 → 원인 단정하지 않음",
	classifyReadOutcome({ ...MISMATCH, expValueHasUnknownPrefix: false }) === "pct_value_mismatch"
);
check(
	"급락 + 값 앞 미인식 조각 → 경험치 잘림으로 분류",
	classifyReadOutcome({ ...DROP, expValueHasUnknownPrefix: true }) === "exp_truncated",
	"값이 잘리면 갑자기 작아져서 급락으로 먼저 걸립니다"
);
check(
	"급락 + 미인식 조각 없음 → 급락 그대로",
	classifyReadOutcome({ ...DROP, expValueHasUnknownPrefix: false }) === "implausible_drop"
);
check(
	"기록에 성공했다면 미인식 조각이 있어도 ok",
	classifyReadOutcome({ ...OK, expValueHasUnknownPrefix: true }) === "ok",
	'"EXP." 라벨이 앞에 있는 정상 판독이 여기에 해당합니다'
);

// ---- 첫 실패 샘플에서 곧바로 경고하고, 성공 한 번으로 즉시 복귀합니다 ----
{
	// 왜 이 성질인가: 유예를 두면 마우스를 ROI에 올려도 몇 초간 아무 반응이 없어서
	// "이게 원인인가"를 확인할 수 없습니다. 표시가 화면 상태를 즉시 따라가야 합니다.
	let st = feed(emptyRecognitionHealth(), OK, 0);
	st = feed(st, BLACK, 1000);
	const first = describeRecognitionHealth(st, 1000, { active: true });
	check("첫 실패 샘플에서 바로 경고", first != null, `기본 유예=${RECOGNITION_STALL_GRACE_MS}ms`);
	check("첫 경고의 지속 시간은 0", first?.stalledMs === 0, `stalledMs=${first?.stalledMs}`);
	check("원인은 검은 화면", first?.kind === "no_signal", `kind=${first?.kind}`);

	// 화면이 돌아오면 즉시 정상입니다. (같은 샘플 안에서 사라져야 합니다)
	st = feed(st, OK, 2000);
	check("복귀하면 경고 없음", describeRecognitionHealth(st, 2000, { active: true }) === null);
	check("복귀하면 연속 실패 0", st.consecutiveFailures === 0);
	check("복귀하면 failingSince 초기화", st.failingSince === null);
	check("복귀 시각이 lastOkAt", st.lastOkAt === 2000);
}

// ---- 실패가 이어지면 지속 시간이 늘고, 원인을 정확히 지목합니다 ----
{
	let st = feed(emptyRecognitionHealth(), OK, 0);
	for (let t = 1000; t <= 5000; t += 1000) st = feed(st, EXP_GONE, t);
	const notice = describeRecognitionHealth(st, 5000, { active: true });
	check("실패가 이어지면 경고", notice != null);
	check("원인이 경험치 인식 실패", notice?.kind === "exp_missing", `kind=${notice?.kind}`);
	check("경험치를 지목하는 문구", !!notice?.title.includes("경험치"), notice?.title);
	check("조치 안내가 비어 있지 않음", !!notice?.detail && notice.detail.length > 0);
	check("지속 시간은 첫 실패 기준", notice?.stalledMs === 4000, `stalledMs=${notice?.stalledMs}`);
}

// ---- 지속 시간은 "연속 실패의 시작"부터 셉니다 ----
{
	let st = feed(emptyRecognitionHealth(), OK, 0);
	st = feed(st, BLACK, 1000);
	// 도중에 원인이 바뀌어도(검은 화면 → 커서로 가림) 지속 시간은 이어져야 합니다.
	st = feed(st, EXP_GONE, 2000);
	st = feed(st, EXP_GONE, 3000);
	const notice = describeRecognitionHealth(st, 30_000, { active: true });
	check("원인이 바뀌어도 지속 시간은 이어짐", notice?.stalledMs === 29_000, `stalledMs=${notice?.stalledMs}`);
	check("원인은 가장 최근 것", notice?.kind === "exp_missing", `kind=${notice?.kind}`);
	check("연속 실패 횟수 누적", st.consecutiveFailures === 3, `count=${st.consecutiveFailures}`);
}

// ---- 측정 중이 아니면 경고하지 않습니다 ----
{
	let st = feed(emptyRecognitionHealth(), OK, 0);
	for (let t = 1000; t <= 60_000; t += 1000) st = feed(st, BLACK, t);
	check("측정 중이면 경고", describeRecognitionHealth(st, 60_000, { active: true }) != null);
	check(
		"측정 중이 아니면 경고 없음",
		describeRecognitionHealth(st, 60_000, { active: false }) === null,
		"멈춰둔 측정에 대고 '기록이 안 된다'고 알리는 것은 의미가 없습니다"
	);
}

// ---- 한 번도 성공하지 못한 채 시작한 경우 ----
{
	// 시작부터 ROI가 가려져 있으면 lastOkAt이 없어도 경고해야 합니다.
	let st = emptyRecognitionHealth();
	for (let t = 0; t <= 10_000; t += 1000) st = feed(st, LEVEL_GONE, t);
	const notice = describeRecognitionHealth(st, 10_000, { active: true });
	check("한 번도 성공 못 해도 경고", notice != null);
	check("원인이 레벨 인식 실패", notice?.kind === "level_missing", `kind=${notice?.kind}`);
	check("성공 이력 없음", st.lastOkAt === null);
}

// ---- 오래 이어지는 이상치도 경고합니다 ----
{
	// 급락 이상치가 계속 걸리는 상황(예: 레벨을 낡은 값으로 붙들고 있는 경우)도 사용자에게 보여야 합니다.
	let st = feed(emptyRecognitionHealth(), OK, 0);
	for (let t = 1000; t <= 20_000; t += 1000) st = feed(st, DROP, t);
	const notice = describeRecognitionHealth(st, 20_000, { active: true });
	check("이어지는 이상치도 경고", notice != null);
	check("원인이 급락", notice?.kind === "implausible_drop", `kind=${notice?.kind}`);
}

// ---- 경험치가 가려진 경우의 안내 문구 ----
{
	let st = feed(emptyRecognitionHealth(), OK, 0);
	for (let t = 1000; t <= 20_000; t += 1000) st = feed(st, { ...MISMATCH, expValueHasUnknownPrefix: true }, t);
	const notice = describeRecognitionHealth(st, 20_000, { active: true });
	check("경험치 잘림으로 경고", notice?.kind === "exp_truncated", `kind=${notice?.kind}`);
	check("문구가 경험치를 지목함", !!notice?.title.includes("경험치"), notice?.title);
	check(
		"문구가 레벨을 지목하지 않음",
		!notice?.title.includes("레벨") && !notice?.detail.includes("레벨"),
		`${notice?.title} / ${notice?.detail}`
	);
	check("마우스 포인터를 확인하라고 안내함", !!notice?.detail.includes("마우스"), notice?.detail);
}

// ---- 원인을 알 수 없는 불일치는 레벨을 단정하지 않습니다 ----
{
	let st = feed(emptyRecognitionHealth(), OK, 0);
	for (let t = 1000; t <= 20_000; t += 1000) st = feed(st, MISMATCH, t);
	const notice = describeRecognitionHealth(st, 20_000, { active: true });
	check("불일치로 경고", notice?.kind === "pct_value_mismatch", `kind=${notice?.kind}`);
	check(
		"레벨이 원인이라고 단정하지 않음",
		!notice?.detail.includes("레벨 영역"),
		`불일치만으로는 레벨/경험치 중 무엇이 문제인지 알 수 없습니다: ${notice?.detail}`
	);
}

// ---- 알림 비교: 초가 바뀌지 않으면 같은 알림 ----
{
	let st = feed(emptyRecognitionHealth(), OK, 0);
	st = feed(st, BLACK, 1000);
	const a = describeRecognitionHealth(st, 11_000, { active: true });
	const b = describeRecognitionHealth(st, 11_400, { active: true });
	const c = describeRecognitionHealth(st, 12_000, { active: true });
	check("같은 초는 같은 알림", recognitionHealthNoticeEquals(a, b), "매 렌더마다 상태가 바뀐 것으로 보이면 안 됩니다");
	check("초가 바뀌면 다른 알림", !recognitionHealthNoticeEquals(a, c));
	check("null끼리는 같음", recognitionHealthNoticeEquals(null, null));
	check("null과 알림은 다름", !recognitionHealthNoticeEquals(a, null));
}

// ---- 한 줄 문구: 0초는 표기하지 않습니다 ----
{
	let st = feed(emptyRecognitionHealth(), OK, 0);
	st = feed(st, EXP_GONE, 1000);
	const first = describeRecognitionHealth(st, 1000, { active: true });
	const later = describeRecognitionHealth(st, 8000, { active: true });
	check(
		"첫 알림에는 초를 붙이지 않음",
		formatRecognitionHealthOneLine(first) === first.title,
		formatRecognitionHealthOneLine(first)
	);
	check(
		"1초 이상이면 초를 붙임",
		formatRecognitionHealthOneLine(later) === `${later.title} (7초)`,
		formatRecognitionHealthOneLine(later)
	);
}

// ---- 유예 시간을 직접 넘길 수 있습니다 (되살릴 때의 탈출구) ----
{
	let st = feed(emptyRecognitionHealth(), OK, 0);
	st = feed(st, BLACK, 1000);
	check("graceMs 0이면 즉시 경고", describeRecognitionHealth(st, 1000, { active: true, graceMs: 0 }) != null);
	check(
		"graceMs가 크면 아직 경고 없음",
		describeRecognitionHealth(st, 5000, { active: true, graceMs: 60_000 }) === null
	);
}

// ---- 워치독: 샘플이 아예 안 들어오는 경우 ----
//
// 왜 이 검증이 중요한가: 인식 실패는 "샘플이 들어왔는데 못 읽은 것"이라 위 규칙들이 잡아냅니다.
// 그런데 측정 루프 자체가 죽으면 판독 결과가 아예 생기지 않아서, 상태가 마지막 성공에 멈춘 채
// **아무 경고도 뜨지 않습니다.** 실제로 그런 사고가 있었습니다. (렌더마다 타이머가 리셋되어
// 샘플이 한 번도 실행되지 않았는데 화면은 정상으로 보였습니다)
{
	const LIMIT = recognitionSilenceLimitMs(1000);
	check("기준값은 주기의 3배와 하한 중 큰 값", LIMIT === 5000, String(LIMIT));
	check("긴 주기는 주기의 3배", recognitionSilenceLimitMs(10_000) === 30_000);

	// 샘플이 제때 들어오는 동안에는 울리지 않습니다.
	let st = feed(emptyRecognitionHealth(0), OK, 0);
	st = feed(st, OK, 1000);
	st = feed(st, OK, 2000);
	check(
		"정상 주기에는 워치독이 울리지 않음",
		describeRecognitionHealth(st, 2500, { active: true, silenceLimitMs: LIMIT }) === null
	);
	check(
		"기준 직전까지는 조용",
		describeRecognitionHealth(st, 2000 + LIMIT - 1, { active: true, silenceLimitMs: LIMIT }) === null
	);

	const stalled = describeRecognitionHealth(st, 2000 + LIMIT, { active: true, silenceLimitMs: LIMIT });
	check("기준을 넘기면 경고", stalled?.kind === "loop_stalled", JSON.stringify(stalled));
	check("지속 시간은 마지막 성공 시점부터", stalled?.stalledMs === LIMIT, String(stalled?.stalledMs));
	check(
		"원인을 단정하지 않는다",
		!!stalled && !/새로고침해야|고장|버그입니다/.test(stalled.title),
		stalled?.title ?? ""
	);

	// 샘플이 다시 들어오면 즉시 사라져야 합니다. (늦게 사라지는 알림이 가장 혼란스럽습니다)
	const revived = feed(st, OK, 2000 + LIMIT + 10);
	check(
		"샘플이 돌아오면 즉시 해제",
		describeRecognitionHealth(revived, 2000 + LIMIT + 10, { active: true, silenceLimitMs: LIMIT }) === null
	);

	// 실패 샘플도 "루프는 살아 있다"는 증거입니다. 이때는 원인을 아는 쪽 알림이 떠야 합니다.
	let failing = feed(emptyRecognitionHealth(0), OK, 0);
	failing = feed(failing, EXP_GONE, 1000);
	failing = feed(failing, EXP_GONE, 2000);
	const cause = describeRecognitionHealth(failing, 2500, { active: true, silenceLimitMs: LIMIT });
	check("실패가 이어져도 루프가 살아 있으면 원인 알림", cause?.kind === "exp_missing", JSON.stringify(cause));

	// 그러다 샘플까지 끊기면 워치독이 우선합니다. (낡은 실패 원인을 띄우면 엉뚱한 곳을 찾게 됩니다)
	const thenDied = describeRecognitionHealth(failing, 2000 + LIMIT, { active: true, silenceLimitMs: LIMIT });
	check("샘플이 끊기면 워치독이 우선", thenDied?.kind === "loop_stalled", JSON.stringify(thenDied));

	// 측정 중이 아니면 어떤 경우에도 알리지 않습니다.
	check(
		"측정 중이 아니면 워치독도 침묵",
		describeRecognitionHealth(st, 10_000_000, { active: false, silenceLimitMs: LIMIT }) === null
	);

	// 기준을 안 넘기면(옵션 미지정) 예전과 똑같이 동작해야 합니다. (호출자가 점진적으로 붙일 수 있게)
	check("silenceLimitMs가 없으면 워치독 없음", describeRecognitionHealth(st, 10_000_000, { active: true }) === null);

	// 측정을 막 시작한 직후에는 아직 샘플이 없어도 울리면 안 됩니다.
	const justStarted = emptyRecognitionHealth(1000);
	check(
		"시작 직후에는 침묵",
		describeRecognitionHealth(justStarted, 1000 + LIMIT - 1, { active: true, silenceLimitMs: LIMIT }) === null
	);
	check(
		"시작 후에도 샘플이 안 오면 결국 알림",
		describeRecognitionHealth(justStarted, 1000 + LIMIT, { active: true, silenceLimitMs: LIMIT })?.kind ===
			"loop_stalled"
	);
	// 시작 시각을 안 주면 첫 샘플 전까지 판단을 보류합니다.
	check(
		"시작 시각이 없으면 판단 보류",
		describeRecognitionHealth(emptyRecognitionHealth(), 10_000_000, { active: true, silenceLimitMs: LIMIT }) === null
	);
}

// ---- 워치독의 자가 점검: 감시자 자신이 자고 있었으면 남을 탓하지 않습니다 ----
//
// 왜 이게 핵심인가: 감시자는 감시 대상과 **같은 시계**를 씁니다. 브라우저가 백그라운드 탭의
// 타이머를 늦추거나(1분 단위) 기기가 절전에 들어가면 측정 루프만이 아니라 이 감시자도 함께
// 멈춥니다. 그렇게 한참 만에 깨어난 시점의 "샘플이 오래 안 들어왔다"는 아무것도 증명하지
// 못합니다 — 우리가 자고 있었으니까요. 이걸 자기 주기로 감지해서 침묵 시계를 다시 셉니다.
//
// (이 자가 점검이 탭 가시성으로 기준을 늘리는 것을 대체합니다. 가시성은 스로틀링의 간접 신호일
//  뿐이고, 기기 절전처럼 가시성으로 잡히지 않는 공백도 있습니다)
{
	const TICK = 1000;
	const LIMIT = recognitionSilenceLimitMs(1000);

	// 정상 주기로 도는 동안에는 아무것도 바꾸지 않습니다.
	let st = feed(emptyRecognitionHealth(0), OK, 0);
	st = applyWatchdogTick(st, 1000, TICK);
	st = applyWatchdogTick(st, 2000, TICK);
	check("정상 tick은 침묵 시계를 건드리지 않음", st.lastSampleAt === 0, String(st.lastSampleAt));
	check("tick 시각이 기록됨", st.lastWatchdogTickAt === 2000);

	// 정상 주기인데 샘플이 안 들어오면 예정대로 경고합니다. (이 경우가 진짜 사고입니다)
	for (let t = 3000; t <= 5000; t += TICK) st = applyWatchdogTick(st, t, TICK);
	const judged = describeRecognitionHealth(st, 5000, { active: true, silenceLimitMs: LIMIT });
	check("감시자가 깨어 있으면 예정대로 경고", judged?.kind === "loop_stalled", JSON.stringify(judged));

	// 감시자 자신이 오래 자고 있었다면(브라우저 스로틀링 1분 / 기기 절전) 판단하지 않습니다.
	let slept = feed(emptyRecognitionHealth(0), OK, 0);
	slept = applyWatchdogTick(slept, 1000, TICK);
	slept = applyWatchdogTick(slept, 61_000, TICK); // 1분 만에 깨어남
	check("자고 일어나면 침묵 시계를 다시 셈", slept.lastSampleAt === 61_000, String(slept.lastSampleAt));
	check(
		"자고 일어난 직후에는 경고하지 않음",
		describeRecognitionHealth(slept, 61_000, { active: true, silenceLimitMs: LIMIT }) === null,
		"우리가 자고 있었으므로 샘플이 안 들어온 것을 루프 탓으로 볼 수 없습니다"
	);

	// 그 다음부터는 정상 규칙으로 돌아옵니다. 계속 스로틀링 중이면 계속 유예되고,
	// 감시자가 정상 주기를 되찾았는데도 샘플이 없으면 그때는 경고합니다.
	let stillThrottled = applyWatchdogTick(slept, 121_000, TICK);
	check(
		"계속 스로틀링 중이면 계속 유예",
		describeRecognitionHealth(stillThrottled, 121_000, { active: true, silenceLimitMs: LIMIT }) === null
	);
	let recovered = slept;
	for (let t = 62_000; t <= 67_000; t += TICK) recovered = applyWatchdogTick(recovered, t, TICK);
	check(
		"주기를 되찾았는데도 샘플이 없으면 경고",
		describeRecognitionHealth(recovered, 67_000, { active: true, silenceLimitMs: LIMIT })?.kind === "loop_stalled",
		"복귀 후에는 정상 기준(5초)으로 판단해야 합니다"
	);

	// 약간의 지연(주기의 3배 이하)은 정상으로 봅니다. 메인 스레드가 잠깐 바쁠 수 있습니다.
	let jittery = feed(emptyRecognitionHealth(0), OK, 0);
	jittery = applyWatchdogTick(jittery, 1000, TICK);
	jittery = applyWatchdogTick(jittery, 3800, TICK);
	check("작은 지연은 정상으로 취급", jittery.lastSampleAt === 0, String(jittery.lastSampleAt));

	// 첫 tick은 비교 대상이 없으므로 아무것도 바꾸지 않습니다.
	const firstTick = applyWatchdogTick(emptyRecognitionHealth(0), 500, TICK);
	check("첫 tick은 기준만 세움", firstTick.lastSampleAt === 0 && firstTick.lastWatchdogTickAt === 500);

	// 자가 점검이 인식 실패 알림까지 지우면 안 됩니다. (그건 샘플이 실제로 들어온 증거입니다)
	let failingThenSlept = feed(emptyRecognitionHealth(0), OK, 0);
	failingThenSlept = feed(failingThenSlept, EXP_GONE, 1000);
	failingThenSlept = applyWatchdogTick(failingThenSlept, 2000, TICK);
	failingThenSlept = applyWatchdogTick(failingThenSlept, 62_000, TICK);
	check(
		"자고 일어나도 인식 실패 원인은 유지",
		describeRecognitionHealth(failingThenSlept, 62_000, { active: true, silenceLimitMs: LIMIT })?.kind ===
			"exp_missing",
		"실패 이력은 샘플이 실제로 들어왔다는 증거라 그대로 둡니다"
	);
}

if (failures > 0) {
	console.log(`\n${failures}건 실패`);
	process.exit(1);
}
console.log("모든 자체 검증 통과");
