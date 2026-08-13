export function formatElapsed(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

/**
 * 시각을 24시간제 `HH:MM:SS`로 표시합니다.
 *
 * 왜 `toLocaleTimeString()`을 쓰지 않나:
 * - 기본 로캘(ko-KR)은 "오후 3:04:05"처럼 한글을 섞는데, 이 값은 모노 글꼴(D2Coding) 영역에 표시됩니다.
 *   D2Coding 서브셋은 라틴만 담고 있어서(`lib/fonts.ts`의 `unicode-range`) "오전/오후"만 Pretendard로
 *   폴백해 한 줄 안에서 글꼴이 뒤섞입니다.
 * - 시(hour) 자릿수도 흔들려서(3시 vs 13시) 값이 갱신될 때마다 폭이 변합니다.
 *
 * 왜 `Intl`에 `hour12: false`를 주지 않나: 일부 엔진에서 ko-KR + `hour12: false`가 자정을
 * "24:00:00"으로 냅니다. 직접 조립하면 로캘/엔진과 무관하게 결과가 같습니다.
 */
export function formatClockTime(d: Date): string {
	if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "-";
	return [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, "0")).join(":");
}

export function formatNumber(n: number): string {
	// 천 단위 구분기호를 붙여 포맷합니다. (아주 작은 음수는 0으로 취급)
	const v = Number.isFinite(n) ? n : 0;
	return Math.floor(v).toLocaleString();
}

export function formatNumberCompact(n: number): string {
	// 축 라벨용 "한글 친화" 축약 포맷입니다.
	// 예시:
	// - 1234 -> "1,234"
	// - 12345 -> "1.2만"
	// - 1234567 -> "123.5만"
	// - 12345678 -> "1235만" (축약된 부분의 자릿수는 4 이하로 유지)
	// - 123456789 -> "1.2억"
	const v = Number.isFinite(n) ? n : 0;
	const abs = Math.abs(v);
	const sign = v < 0 ? "-" : "";

	const formatCompactUnit = (scaled: number, suffix: string) => {
		// 규칙: 축약 형태에서는 자릿수를 4 이하로 유지합니다.
		// 정수부 길이가 3 이하일 때만 소수점 1자리까지 허용합니다.
		const intLen = Math.floor(scaled).toString().length;
		if (intLen >= 4) {
			// 소수점을 표시하면 자릿수가 많아지므로 정수로 반올림합니다.
			return `${sign}${Math.round(scaled)}${suffix}`;
		}
		const s = scaled.toFixed(1);
		const trimmed = s.endsWith(".0") ? s.slice(0, -2) : s;
		return `${sign}${trimmed}${suffix}`;
	};

	if (abs >= 1e8) return formatCompactUnit(abs / 1e8, "억");
	if (abs >= 1e4) return formatCompactUnit(abs / 1e4, "만");
	return formatNumber(abs);
}
