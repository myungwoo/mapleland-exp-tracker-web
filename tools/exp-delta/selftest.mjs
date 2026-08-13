#!/usr/bin/env node
/**
 * 두 샘플 사이의 경험치 증가량 계산 자체 검증
 *
 *   node tools/exp-delta/selftest.mjs
 *
 * 누적은 두 갈래로 셉니다. **둘은 항상 같은 사건을 세어야 합니다.**
 * - 퍼센트: `computeExpPercentDelta` (레벨 하나를 통째로 채우면 100%p)
 * - 값(EXP): `computeExpDeltaFromTable` (레벨별 필요 EXP 테이블 기준)
 *
 * 왜 이 테스트가 중요한가:
 * 퍼센트 쪽이 `100 - prev% + cur%`로만 계산해서 **한 구간에 2레벨 이상 오르면 레벨당 100%p씩
 * 조용히 덜 세는** 버그가 있었습니다. 평소에는 1초마다 샘플이 도니까 한 틱에 2레벨이 오를 수
 * 없어 드러나지 않는데, 인식이 오래 끊겼다가 복구되는 구간에서는 실제로 발생합니다.
 * (실패 샘플은 버려지고 EXP는 절대값이라 복구 시 한 번에 회수됩니다 — 그 사이가 몇 시간일 수 있습니다)
 * 값 쪽은 처음부터 다중 레벨업을 정확히 처리했기 때문에, 두 누적이 서로 어긋나 있었습니다.
 */
import { loadLibModules } from "../pixel-font/loadLib.mjs";

const { computeExpPercentDelta, computeExpDeltaFromTable, requiredExpForLevel, EXP_TABLE } = await loadLibModules(
	["expTable"],
	"expTable"
);

let failures = 0;
const check = (name, ok, extra = "") => {
	if (!ok) {
		failures++;
		console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
	}
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---- 퍼센트 누적 ----
check("같은 레벨: 단순 차이", near(computeExpPercentDelta(100, 10, 100, 35), 25));
check("같은 레벨 감소(사망 패널티)", near(computeExpPercentDelta(100, 35, 100, 25), -10));
check("한 레벨 상승", near(computeExpPercentDelta(100, 90, 101, 5), 15), "남은 10%p + 5%p");

// ⭐ 회귀: 여기서 예전 구현은 100%p를 덜 셌습니다.
check("두 레벨 상승", near(computeExpPercentDelta(100, 90, 102, 5), 115), "남은 10 + 건너뛴 100 + 5");
check("세 레벨 상승", near(computeExpPercentDelta(100, 90, 103, 5), 215));
check("열 레벨 상승", near(computeExpPercentDelta(100, 0, 110, 0), 1000), "레벨당 정확히 100%p");

// 레벨이 내려간 경우(대개 오인식)는 증가의 대칭이어야 합니다.
check("레벨 하락은 상승의 부호 반전", near(computeExpPercentDelta(102, 5, 100, 90), -115));
check(
	"상승/하락 대칭",
	near(computeExpPercentDelta(100, 90, 103, 5), -computeExpPercentDelta(103, 5, 100, 90)),
	"한쪽만 고치면 오인식 복구 때 누적이 어긋납니다"
);

// 경계: 레벨업 직후 0%, 레벨업 직전 100%
check("정확히 한 레벨만큼", near(computeExpPercentDelta(150, 0, 151, 0), 100));

// ---- 퍼센트와 값이 같은 사건을 세는지 ----
//
// 같은 구간을 두 방식으로 재서 서로 어긋나지 않는지 봅니다.
// (퍼센트는 각 레벨의 필요 EXP로 환산하면 값과 같아야 합니다)
{
	const cases = [
		{ prevLevel: 100, prevPct: 90, curLevel: 101, curPct: 5 },
		{ prevLevel: 100, prevPct: 90, curLevel: 102, curPct: 5 },
		{ prevLevel: 120, prevPct: 12.34, curLevel: 124, curPct: 56.78 },
		{ prevLevel: 150, prevPct: 0, curLevel: 153, curPct: 0 }
	];
	for (const c of cases) {
		const prevValue = (requiredExpForLevel(EXP_TABLE, c.prevLevel) * c.prevPct) / 100;
		const curValue = (requiredExpForLevel(EXP_TABLE, c.curLevel) * c.curPct) / 100;
		const dv = computeExpDeltaFromTable(EXP_TABLE, c.prevLevel, prevValue, c.curLevel, curValue);
		// 퍼센트 증가분을 레벨별 필요 EXP로 되돌려 값과 비교합니다.
		let expected = requiredExpForLevel(EXP_TABLE, c.prevLevel) - prevValue;
		for (let lv = c.prevLevel + 1; lv < c.curLevel; lv++) expected += requiredExpForLevel(EXP_TABLE, lv);
		expected += curValue;
		check(`값 누적과 어긋나지 않음 (Lv${c.prevLevel}→${c.curLevel})`, near(dv, expected, 1e-6), `${dv} vs ${expected}`);
		// 퍼센트 쪽도 "건너뛴 레벨 수"를 같은 개수로 세는지 확인합니다.
		const dp = computeExpPercentDelta(c.prevLevel, c.prevPct, c.curLevel, c.curPct);
		const expectedPct = 100 - c.prevPct + (c.curLevel - c.prevLevel - 1) * 100 + c.curPct;
		check(`퍼센트 누적 (Lv${c.prevLevel}→${c.curLevel})`, near(dp, expectedPct), `${dp} vs ${expectedPct}`);
	}
}

// ---- 값 누적(기존 구현)의 성질도 함께 고정해 둡니다 ----
{
	const req100 = requiredExpForLevel(EXP_TABLE, 100);
	check("같은 레벨: 부호 있는 차이", computeExpDeltaFromTable(EXP_TABLE, 100, 500, 100, 1500) === 1000);
	check("같은 레벨 감소", computeExpDeltaFromTable(EXP_TABLE, 100, 1500, 100, 500) === -1000);
	check("한 레벨 상승", computeExpDeltaFromTable(EXP_TABLE, 100, req100 - 10, 101, 7) === 17, "남은 10 + 새 레벨 7");
	check(
		"두 레벨 상승은 중간 레벨을 통째로 더한다",
		computeExpDeltaFromTable(EXP_TABLE, 100, req100, 102, 0) === requiredExpForLevel(EXP_TABLE, 101)
	);
	// 시작 레벨이나 중간 레벨이 테이블에 없으면 계산을 포기합니다. (도착 레벨의 필요 EXP는 필요 없습니다)
	check("시작 레벨이 테이블에 없으면 null", computeExpDeltaFromTable(EXP_TABLE, 201, 0, 202, 0) === null);
	check("중간 레벨이 테이블에 없으면 null", computeExpDeltaFromTable(EXP_TABLE, 200, 0, 203, 0) === null);
	check(
		"도착 레벨이 테이블에 없어도 계산은 가능",
		computeExpDeltaFromTable(EXP_TABLE, 200, 0, 201, 0) === requiredExpForLevel(EXP_TABLE, 200),
		"증가량 계산에 도착 레벨의 총량은 쓰이지 않습니다"
	);
}

if (failures > 0) {
	console.log(`\n${failures}건 실패`);
	process.exit(1);
}
console.log("모든 자체 검증 통과");
