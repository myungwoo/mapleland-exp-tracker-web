export function formatElapsed(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
}

export function predictGains(ratePerSec: number, minutes: number): number {
	return ratePerSec * minutes * 60;
}

export function oneHourAt(startAt: number): Date {
	return new Date(startAt + 3600_000);
}

export function formatNumber(n: number): string {
	// Format with thousands separators; clamp tiny negatives to 0
	const v = Number.isFinite(n) ? n : 0;
	return Math.floor(v).toLocaleString();
}


