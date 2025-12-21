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
	// - 123456789 -> "1.2억"
	const v = Number.isFinite(n) ? n : 0;
	const abs = Math.abs(v);
	const sign = v < 0 ? "-" : "";
	const trim1 = (x: number) => {
		const s = x.toFixed(1);
		return s.endsWith(".0") ? s.slice(0, -2) : s;
	};
	if (abs >= 1e8) return `${sign}${trim1(abs / 1e8)}억`;
	if (abs >= 1e4) return `${sign}${trim1(abs / 1e4)}만`;
	return formatNumber(abs);
}


