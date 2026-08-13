#!/usr/bin/env node
/**
 * 기록 스냅샷 정규화 / 버전 마이그레이션 자체 검증
 *
 *   node tools/records/selftest.mjs
 *
 * 왜 이 테스트가 중요한가:
 * 사용자는 측정 기록을 JSON으로 **내보내서 파일로 들고 있습니다.** 그리고 IndexedDB에도 옛 버전
 * 스냅샷이 그대로 남아 있습니다. `normalizeSnapshot`이 옛 필드를 못 읽으면 에러가 나는 게 아니라
 * **누적 EXP가 조용히 0으로 복원됩니다.** 기록이 날아간 것처럼 보이는데 어디서 깨졌는지 알기 어렵죠.
 *
 * 특히 v3 -> v4에서 측정 스냅샷 필드 이름이 `ocr` -> `sampling`으로 바뀌었습니다.
 * 그 폴백이 살아 있는지가 이 테스트의 핵심입니다.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * `features/exp-tracker/records/snapshot.ts` 와 그 런타임 의존성을 Node에서 그대로 돌립니다.
 *
 * `tools/pixel-font/loadLib.mjs` 와 같은 방식이지만, 이쪽은 `lib/` 바깥 파일과 `@/` 별칭 import를
 * 다뤄야 해서 따로 두었습니다. (타입 전용 import는 transpile 단계에서 지워지므로 옮길 필요가 없습니다)
 */
async function loadSnapshotModule() {
	const out = mkdtempSync(join(tmpdir(), "records-"));
	const files = [
		["snapshot", "features/exp-tracker/records/snapshot.ts"],
		["expCoupon", "lib/expCoupon.ts"],
		["pace", "lib/pace.ts"]
	];
	for (const [name, rel] of files) {
		const src = readFileSync(join(repoRoot, rel), "utf8");
		let js = ts.transpileModule(src, {
			compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
		}).outputText;
		// `@/lib/foo` 별칭을 같이 옮겨온 파일의 상대 경로로 바꿉니다. (Node ESM은 확장자를 요구합니다)
		for (const [other] of files) {
			js = js.replaceAll(`from "@/lib/${other}"`, `from "./${other}.mjs"`);
		}
		writeFileSync(join(out, `${name}.mjs`), js);
	}
	return import(pathToFileURL(join(out, "snapshot.mjs")).href);
}

const { normalizeSnapshot, makeEmptySnapshot } = await loadSnapshotModule();

let failures = 0;
const check = (name, ok, extra = "") => {
	if (!ok) {
		failures++;
		console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
	}
};

/** 측정 스냅샷 본문. 어느 버전이든 이 값이 그대로 살아 나와야 합니다. */
const SAMPLING = {
	currentLevel: 193,
	currentExpPercent: 83.16,
	currentExpValue: 1214349360,
	cumExpPct: 12.5,
	cumExpValue: 987654,
	sampleTick: 42,
	lastSampleTs: 1700000000000,
	lastValidSample: { ts: 1700000000000, level: 193, expPercent: 83.16, expValue: 1214349360 }
};

const PACE = { history: [{ ts: 1700000000000, cumExp: 100, cumPct: 1.5, elapsedAtMs: 60000 }] };
const STOPWATCH = { elapsedMs: 3675000, baseElapsedMs: 3675000, isRunning: false };

const expectSamplingPreserved = (label, snap) => {
	check(`${label}: sampling 필드 존재`, !!snap.sampling, "필드가 통째로 비었습니다");
	if (!snap.sampling) return;
	check(
		`${label}: cumExpValue 보존`,
		snap.sampling.cumExpValue === SAMPLING.cumExpValue,
		`${snap.sampling.cumExpValue}`
	);
	check(`${label}: cumExpPct 보존`, snap.sampling.cumExpPct === SAMPLING.cumExpPct, `${snap.sampling.cumExpPct}`);
	check(`${label}: currentLevel 보존`, snap.sampling.currentLevel === SAMPLING.currentLevel);
	check(`${label}: sampleTick 보존`, snap.sampling.sampleTick === SAMPLING.sampleTick);
	check(`${label}: lastValidSample 보존`, snap.sampling.lastValidSample?.level === 193);
	check(`${label}: 버전은 항상 최신(4)`, snap.version === 4, `${snap.version}`);
	// 옛 이름이 결과에 남아 있으면 소비하는 쪽이 두 이름을 다 알아야 합니다.
	check(`${label}: 옛 이름(ocr)은 결과에 없음`, !("ocr" in snap));
};

// --- v4 (현재 포맷) ---
expectSamplingPreserved(
	"v4",
	normalizeSnapshot({
		version: 4,
		capturedAt: 1700000000000,
		runtime: { hasStarted: true, expCouponCount: 2 },
		stopwatch: STOPWATCH,
		sampling: SAMPLING,
		pace: PACE
	})
);

// --- v3 (필드 이름이 `ocr`이던 시절) ---
// 이게 이 파일이 존재하는 이유입니다. 사용자가 내보낸 JSON이 실제로 이 모양입니다.
expectSamplingPreserved(
	"v3(ocr 키)",
	normalizeSnapshot({
		version: 3,
		capturedAt: 1700000000000,
		runtime: { hasStarted: true, expCouponCount: 2 },
		stopwatch: STOPWATCH,
		ocr: SAMPLING,
		pace: PACE
	})
);

// --- v2 (`ocr` 키 + runtime) ---
expectSamplingPreserved(
	"v2(ocr 키)",
	normalizeSnapshot({
		version: 2,
		capturedAt: 1700000000000,
		runtime: { hasStarted: true, expCouponCount: 0 },
		stopwatch: STOPWATCH,
		ocr: SAMPLING,
		pace: PACE
	})
);

// --- v1 (`state` 필드 + `ocr` 키) ---
expectSamplingPreserved(
	"v1(state + ocr 키)",
	normalizeSnapshot({
		version: 1,
		capturedAt: 1700000000000,
		state: { hasStarted: true },
		stopwatch: STOPWATCH,
		ocr: SAMPLING,
		pace: PACE
	})
);

// --- 두 이름이 같이 있으면 새 이름이 이깁니다 ---
{
	const snap = normalizeSnapshot({
		version: 4,
		capturedAt: 1700000000000,
		runtime: { hasStarted: true, expCouponCount: 0 },
		stopwatch: STOPWATCH,
		sampling: SAMPLING,
		ocr: { ...SAMPLING, cumExpValue: 111 },
		pace: PACE
	});
	check("혼재 시 sampling 우선", snap.sampling.cumExpValue === SAMPLING.cumExpValue, `${snap.sampling.cumExpValue}`);
}

// --- 나머지 필드도 함께 살아남아야 합니다 ---
{
	const snap = normalizeSnapshot({
		version: 3,
		capturedAt: 1700000000000,
		runtime: { hasStarted: true, expCouponCount: 2 },
		stopwatch: STOPWATCH,
		ocr: SAMPLING,
		pace: PACE
	});
	check("v3: 스톱워치 보존", snap.stopwatch.elapsedMs === STOPWATCH.elapsedMs);
	check("v3: 쿠폰 개수 보존", snap.runtime.expCouponCount === 2, `${snap.runtime.expCouponCount}`);
	check("v3: hasStarted 보존", snap.runtime.hasStarted === true);
	check("v3: 차트 히스토리 보존", snap.pace.history.length === 1);
	check("v3: 히스토리 값 보존", snap.pace.history[0]?.cumExp === 100);
}

// --- 쓰레기 입력에도 죽지 않고 빈 스냅샷을 돌려줘야 합니다 ---
for (const [label, input] of [
	["null", null],
	["문자열", "nope"],
	["빈 객체", {}],
	["sampling이 배열", { version: 4, sampling: [] }],
	["sampling이 null", { version: 4, sampling: null }]
]) {
	const snap = normalizeSnapshot(input);
	check(`쓰레기 입력(${label}): 버전 4`, snap.version === 4);
	check(`쓰레기 입력(${label}): 누적 0`, snap.sampling.cumExpValue === 0 && snap.sampling.cumExpPct === 0);
	check(`쓰레기 입력(${label}): 히스토리 빈 배열`, Array.isArray(snap.pace.history) && snap.pace.history.length === 0);
}

// --- 빈 스냅샷 자체도 최신 포맷이어야 합니다 ---
{
	const empty = makeEmptySnapshot(1700000000000);
	check("빈 스냅샷: 버전 4", empty.version === 4, `${empty.version}`);
	check("빈 스냅샷: sampling 키 사용", !!empty.sampling && !("ocr" in empty));
}

if (failures > 0) {
	console.log(`\n${failures}건 실패`);
	process.exit(1);
}
console.log("모든 자체 검증 통과");
