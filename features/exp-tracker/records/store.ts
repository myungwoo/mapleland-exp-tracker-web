import type {
	RecordItem,
	RecordsDbV1,
	RecordsExportArchiveV1,
	RecordsExportRecordV1
} from "@/features/exp-tracker/records/types";
import { normalizeSnapshot } from "@/features/exp-tracker/records/snapshot";

const STORAGE_KEY = "mlExpTracker.records.v1";
const MAX_BYTES_SOFT = 4.5 * 1024 * 1024; // localStorage is usually ~5MB; keep margin

function now() {
	return Date.now();
}

function safeParseJson<T>(raw: string): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

function getRandomId(): string {
	try {
		return crypto.randomUUID();
	} catch {
		return `rec_${Math.random().toString(36).slice(2)}_${Date.now()}`;
	}
}

function loadDb(): RecordsDbV1 {
	if (typeof window === "undefined") return { version: 1, records: [] };
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return { version: 1, records: [] };
		const parsed = safeParseJson<RecordsDbV1>(raw);
		if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) return { version: 1, records: [] };
		// Normalize snapshots (also migrates legacy versions) so app code only deals with v2.
		return {
			version: 1,
			records: parsed.records.map((r: any) => ({ ...r, snapshot: normalizeSnapshot(r.snapshot) }))
		};
	} catch {
		return { version: 1, records: [] };
	}
}

function saveDb(db: RecordsDbV1) {
	if (typeof window === "undefined") return;
	const raw = JSON.stringify(db);
	// crude size guard (UTF-16 vs UTF-8 differs, but this is a useful approximation)
	if (raw.length > MAX_BYTES_SOFT) {
		throw new Error("기록 저장 용량이 너무 큽니다. (localStorage 한도 초과 가능)");
	}
	window.localStorage.setItem(STORAGE_KEY, raw);
}

export function listRecords(): RecordItem[] {
	const db = loadDb();
	return [...db.records].sort((a, b) => b.createdAt - a.createdAt);
}

export function saveNewRecord(name: string, snapshot: RecordItem["snapshot"]): RecordItem {
	const db = loadDb();
	const t = now();
	const rec: RecordItem = {
		id: getRandomId(),
		name: (name || "기록").trim(),
		createdAt: t,
		updatedAt: t,
		snapshot
	};
	db.records.push(rec);
	saveDb(db);
	return rec;
}

export function deleteRecord(id: string) {
	const db = loadDb();
	db.records = db.records.filter(r => r.id !== id);
	saveDb(db);
}

export function deleteRecords(ids: string[]) {
	const idSet = new Set(ids);
	const db = loadDb();
	db.records = db.records.filter(r => !idSet.has(r.id));
	saveDb(db);
}

export function exportRecordJson(record: RecordItem): string {
	const payload: RecordsExportRecordV1 = {
		kind: "mapleland-exp-tracker-record",
		version: 1,
		exportedAt: now(),
		record
	};
	return JSON.stringify(payload, null, 2);
}

export function exportArchiveJson(records: RecordItem[]): string {
	const payload: RecordsExportArchiveV1 = {
		kind: "mapleland-exp-tracker-archive",
		version: 1,
		exportedAt: now(),
		records
	};
	return JSON.stringify(payload, null, 2);
}

function isRecordPayload(x: unknown): x is RecordsExportRecordV1 {
	if (!x || typeof x !== "object") return false;
	const o = x as any;
	return o.kind === "mapleland-exp-tracker-record" && o.version === 1 && !!o.record && typeof o.record === "object";
}

function isArchivePayload(x: unknown): x is RecordsExportArchiveV1 {
	if (!x || typeof x !== "object") return false;
	const o = x as any;
	return o.kind === "mapleland-exp-tracker-archive" && o.version === 1 && Array.isArray(o.records);
}

function normalizeImportedRecord(rec: any): RecordItem | null {
	if (!rec || typeof rec !== "object") return null;
	if (typeof rec.name !== "string") return null;
	if (!rec.snapshot || typeof rec.snapshot !== "object") return null;
	const t = now();
	return {
		id: typeof rec.id === "string" ? rec.id : getRandomId(),
		name: rec.name,
		createdAt: typeof rec.createdAt === "number" ? rec.createdAt : t,
		updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : t,
		snapshot: normalizeSnapshot(rec.snapshot)
	};
}

export function importFromJsonText(rawJson: string): { imported: number } {
	const parsed = safeParseJson<any>(rawJson);
	if (!parsed) throw new Error("JSON 파싱에 실패했습니다.");

	const db = loadDb();
	const existingIds = new Set(db.records.map(r => r.id));

	const addOne = (r: RecordItem) => {
		let id = r.id;
		while (existingIds.has(id)) id = getRandomId();
		existingIds.add(id);
		db.records.push({ ...r, id });
	};

	if (isRecordPayload(parsed)) {
		const rec = normalizeImportedRecord(parsed.record);
		if (!rec) throw new Error("기록 포맷이 올바르지 않습니다.");
		addOne(rec);
		saveDb(db);
		return { imported: 1 };
	}

	if (isArchivePayload(parsed)) {
		let count = 0;
		for (const item of parsed.records) {
			const rec = normalizeImportedRecord(item);
			if (!rec) continue;
			addOne(rec);
			count++;
		}
		saveDb(db);
		return { imported: count };
	}

	// Allow importing a raw RecordItem (no wrapper) as a convenience.
	const maybeRec = normalizeImportedRecord(parsed);
	if (maybeRec) {
		addOne(maybeRec);
		saveDb(db);
		return { imported: 1 };
	}

	throw new Error("지원하지 않는 파일 형식입니다.");
}


