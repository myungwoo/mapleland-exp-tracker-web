import type {
	RecordItem,
	RecordsExportArchiveV1,
	RecordsExportRecordV1
} from "@/features/exp-tracker/records/types";
import { normalizeSnapshot } from "@/features/exp-tracker/records/snapshot";
import { idbDeleteRecord, idbDeleteRecords, idbGetAllRecordIds, idbListRecords, idbPutRecord, idbPutRecords, idbGetMeta, idbSetMeta } from "@/features/exp-tracker/records/idb";

const STORAGE_KEY = "mlExpTracker.records.v1";
const META_MIGRATED_KEY = "migratedFromLocalStorageV1";

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

let migrationPromise: Promise<void> | null = null;

async function migrateFromLocalStorageIfNeeded(): Promise<void> {
	if (typeof window === "undefined") return;
	if (migrationPromise) return migrationPromise;
	migrationPromise = (async () => {
		try {
			const already = await idbGetMeta(META_MIGRATED_KEY);
			if (already) return;
		} catch {
			// ignore and proceed
		}

		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			// 마이그레이션할 게 없으면 플래그만 세팅해서 이후 체크 비용을 줄입니다.
			try { await idbSetMeta(META_MIGRATED_KEY, true); } catch {}
			return;
		}
		const parsed = safeParseJson<any>(raw);
		const recordsRaw = parsed && parsed.version === 1 && Array.isArray(parsed.records) ? parsed.records : [];
		const migrated: RecordItem[] = [];
		for (const r of recordsRaw) {
			if (!r || typeof r !== "object") continue;
			if (typeof r.id !== "string") continue;
			if (typeof r.name !== "string") continue;
			if (typeof r.createdAt !== "number" || typeof r.updatedAt !== "number") continue;
			if (!r.snapshot || typeof r.snapshot !== "object") continue;
			migrated.push({
				id: r.id,
				name: r.name,
				createdAt: r.createdAt,
				updatedAt: r.updatedAt,
				snapshot: normalizeSnapshot(r.snapshot)
			});
		}

		if (migrated.length > 0) {
			await idbPutRecords(migrated);
		}
		// localStorage는 더 이상 기록 저장소로 사용하지 않습니다.
		try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
		try { await idbSetMeta(META_MIGRATED_KEY, true); } catch {}
	})();
	return migrationPromise;
}

export async function listRecords(): Promise<RecordItem[]> {
	await migrateFromLocalStorageIfNeeded();
	// IndexedDB에서 createdAt 내림차순으로 바로 읽어옵니다.
	return await idbListRecords();
}

export async function saveNewRecord(name: string, snapshot: RecordItem["snapshot"]): Promise<RecordItem> {
	await migrateFromLocalStorageIfNeeded();
	const t = now();
	const rec: RecordItem = {
		id: getRandomId(),
		name: (name || "기록").trim(),
		createdAt: t,
		updatedAt: t,
		snapshot
	};
	await idbPutRecord(rec);
	return rec;
}

export async function deleteRecord(id: string): Promise<void> {
	await migrateFromLocalStorageIfNeeded();
	await idbDeleteRecord(id);
}

export async function deleteRecords(ids: string[]): Promise<void> {
	await migrateFromLocalStorageIfNeeded();
	await idbDeleteRecords(ids);
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

export async function importFromJsonText(rawJson: string): Promise<{ imported: number }> {
	const parsed = safeParseJson<any>(rawJson);
	if (!parsed) throw new Error("JSON 파싱에 실패했습니다.");

	await migrateFromLocalStorageIfNeeded();
	const existingIds = new Set(await idbGetAllRecordIds());
	const toPut: RecordItem[] = [];

	const addOne = (r: RecordItem) => {
		let id = r.id;
		while (existingIds.has(id)) id = getRandomId();
		existingIds.add(id);
		toPut.push({ ...r, id });
	};

	if (isRecordPayload(parsed)) {
		const rec = normalizeImportedRecord(parsed.record);
		if (!rec) throw new Error("기록 포맷이 올바르지 않습니다.");
		addOne(rec);
		await idbPutRecords(toPut);
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
		if (toPut.length > 0) await idbPutRecords(toPut);
		return { imported: count };
	}

	// Allow importing a raw RecordItem (no wrapper) as a convenience.
	const maybeRec = normalizeImportedRecord(parsed);
	if (maybeRec) {
		addOne(maybeRec);
		await idbPutRecords(toPut);
		return { imported: 1 };
	}

	throw new Error("지원하지 않는 파일 형식입니다.");
}


