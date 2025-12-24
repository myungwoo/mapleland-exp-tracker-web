export function formatElapsed(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
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


