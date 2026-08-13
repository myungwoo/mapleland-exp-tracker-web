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

if (failures > 0) {
	console.log(`\n${failures}건 실패`);
	process.exit(1);
}
console.log("모든 자체 검증 통과");
