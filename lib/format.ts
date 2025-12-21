export function formatElapsed(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
}

export function formatNumber(n: number): string {
	// Format with thousands separators; clamp tiny negatives to 0
	const v = Number.isFinite(n) ? n : 0;
	return Math.floor(v).toLocaleString();
}

export function formatNumberCompact(n: number): string {
	// Korean-friendly compact formatting for axis labels.
	// Examples:
	// - 1234 -> "1,234"
	// - 12345 -> "1.2만"
	// - 1234567 -> "123.5만"
	// - 12345678 -> "1235만" (keep digit count <= 4 in compact part)
	// - 123456789 -> "1.2억"
	const v = Number.isFinite(n) ? n : 0;
	const abs = Math.abs(v);
	const sign = v < 0 ? "-" : "";

	const formatCompactUnit = (scaled: number, suffix: string) => {
		// Rule: In compact form, keep the number of digits <= 4.
		// We allow at most 1 decimal place when integer-part length <= 3.
		const intLen = Math.floor(scaled).toString().length;
		if (intLen >= 4) {
			// Too many digits if we show any decimal; round to an integer.
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


