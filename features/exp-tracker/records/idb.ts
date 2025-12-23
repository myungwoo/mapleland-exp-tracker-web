import type { RecordItem } from "@/features/exp-tracker/records/types";

const DB_NAME = "mlExpTracker";
const DB_VERSION = 2;
const STORE_RECORDS = "records";
const STORE_META = "meta";
const INDEX_CREATED_AT = "byCreatedAt";

type MetaRow = { key: string; value: any };

function openDb(): Promise<IDBDatabase> {
	if (typeof window === "undefined") {
		return Promise.reject(new Error("IndexedDB는 브라우저에서만 사용할 수 있습니다."));
	}
	return new Promise((resolve, reject) => {
		const req = window.indexedDB.open(DB_NAME, DB_VERSION);
		req.onerror = () => reject(req.error ?? new Error("IndexedDB 열기에 실패했습니다."));
		req.onupgradeneeded = () => {
			const db = req.result;
			// NOTE: onupgradeneeded runs inside a versionchange transaction.
			// We can safely create stores / indexes here.
			if (!db.objectStoreNames.contains(STORE_RECORDS)) {
				const store = db.createObjectStore(STORE_RECORDS, { keyPath: "id" });
				// createdAt 내림차순 정렬 조회를 위해 인덱스를 둡니다.
				store.createIndex(INDEX_CREATED_AT, "createdAt", { unique: false });
			} else {
				// 기존 스토어가 있다면 인덱스만 보강합니다.
				const tx = req.transaction;
				try {
					const store = tx?.objectStore(STORE_RECORDS);
					if (store && !store.indexNames.contains(INDEX_CREATED_AT)) {
						store.createIndex(INDEX_CREATED_AT, "createdAt", { unique: false });
					}
				} catch {
					// 인덱스 생성 실패는 치명적이지 않으므로 무시합니다.
				}
			}
			if (!db.objectStoreNames.contains(STORE_META)) {
				db.createObjectStore(STORE_META, { keyPath: "key" });
			}
		};
		req.onsuccess = () => resolve(req.result);
	});
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error("IndexedDB 요청에 실패했습니다."));
	});
}

function txDone(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(tx.error ?? new Error("IndexedDB 트랜잭션이 중단되었습니다."));
		tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 트랜잭션에 실패했습니다."));
	});
}

export async function idbListRecords(): Promise<RecordItem[]> {
	const db = await openDb();
	try {
		const tx = db.transaction(STORE_RECORDS, "readonly");
		const store = tx.objectStore(STORE_RECORDS);
		// createdAt 인덱스를 사용해 내림차순으로 바로 읽습니다. (getAll + sort 방지)
		const hasIndex = store.indexNames.contains(INDEX_CREATED_AT);
		if (!hasIndex) {
			// 구버전/예외 상황 안전장치: 인덱스가 없으면 fallback.
			const records = await requestToPromise(store.getAll() as IDBRequest<RecordItem[]>);
			await txDone(tx);
			const list = Array.isArray(records) ? records : [];
			return list.sort((a, b) => b.createdAt - a.createdAt);
		}
		const index = store.index(INDEX_CREATED_AT);
		const records: RecordItem[] = [];
		await new Promise<void>((resolve, reject) => {
			const req = index.openCursor(null, "prev");
			req.onerror = () => reject(req.error ?? new Error("IndexedDB 커서 열기에 실패했습니다."));
			req.onsuccess = () => {
				const cursor = req.result as IDBCursorWithValue | null;
				if (!cursor) return resolve();
				records.push(cursor.value as RecordItem);
				cursor.continue();
			};
		});
		await txDone(tx);
		return records;
	} finally {
		db.close();
	}
}

export async function idbPutRecord(record: RecordItem): Promise<void> {
	const db = await openDb();
	try {
		const tx = db.transaction(STORE_RECORDS, "readwrite");
		const store = tx.objectStore(STORE_RECORDS);
		store.put(record);
		await txDone(tx);
	} finally {
		db.close();
	}
}

export async function idbPutRecords(records: RecordItem[]): Promise<void> {
	const db = await openDb();
	try {
		const tx = db.transaction(STORE_RECORDS, "readwrite");
		const store = tx.objectStore(STORE_RECORDS);
		for (const r of records) store.put(r);
		await txDone(tx);
	} finally {
		db.close();
	}
}

export async function idbDeleteRecord(id: string): Promise<void> {
	const db = await openDb();
	try {
		const tx = db.transaction(STORE_RECORDS, "readwrite");
		tx.objectStore(STORE_RECORDS).delete(id);
		await txDone(tx);
	} finally {
		db.close();
	}
}

export async function idbDeleteRecords(ids: string[]): Promise<void> {
	const db = await openDb();
	try {
		const tx = db.transaction(STORE_RECORDS, "readwrite");
		const store = tx.objectStore(STORE_RECORDS);
		for (const id of ids) store.delete(id);
		await txDone(tx);
	} finally {
		db.close();
	}
}

export async function idbGetAllRecordIds(): Promise<string[]> {
	const db = await openDb();
	try {
		const tx = db.transaction(STORE_RECORDS, "readonly");
		const store = tx.objectStore(STORE_RECORDS);
		const keys = await requestToPromise(store.getAllKeys() as IDBRequest<IDBValidKey[]>);
		await txDone(tx);
		return (keys ?? []).map((k) => String(k));
	} finally {
		db.close();
	}
}

export async function idbGetMeta(key: string): Promise<any> {
	const db = await openDb();
	try {
		const tx = db.transaction(STORE_META, "readonly");
		const store = tx.objectStore(STORE_META);
		const row = await requestToPromise(store.get(key) as IDBRequest<MetaRow | undefined>);
		await txDone(tx);
		return row?.value;
	} finally {
		db.close();
	}
}

export async function idbSetMeta(key: string, value: any): Promise<void> {
	const db = await openDb();
	try {
		const tx = db.transaction(STORE_META, "readwrite");
		const store = tx.objectStore(STORE_META);
		store.put({ key, value } satisfies MetaRow);
		await txDone(tx);
	} finally {
		db.close();
	}
}


