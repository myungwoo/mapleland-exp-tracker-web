#!/usr/bin/env node
/**
 * localStorage 키 접두어 / 예전 키 마이그레이션 자체 검증
 *
 *   node tools/storage-keys/selftest.mjs
 *
 * 왜 이 테스트가 중요한가:
 * 이 앱은 mapleland.myungwoo.kr 에서 다른 유틸들과 **한 오리진을 공유합니다.**
 * 그래서 `roiLevel`, `onboardingDone` 같은 이름을 그냥 쓰면 다른 유틸이 같은 이름을
 * 쓰는 순간 서로의 설정을 덮어씁니다. 접두어를 붙인 이유가 그것입니다.
 *
 * 그런데 접두어를 붙이면 **이미 저장돼 있던 사용자 설정(ROI 등)이 안 보이게 됩니다.**
 * 마이그레이션이 조용히 깨지면 에러가 나는 게 아니라, 사용자가 다시 ROI를 잡아야 합니다.
 * 그리고 예전 키를 지우지 않는 것도 의도입니다 — 배포를 되돌려도 설정이 남아야 합니다.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/** `lib/storage-keys.ts` 를 Node에서 그대로 돌립니다. (의존성이 없어 파일 하나면 됩니다) */
async function loadStorageKeysModule() {
	const out = mkdtempSync(join(tmpdir(), "storage-keys-"));
	const src = readFileSync(join(repoRoot, "lib/storage-keys.ts"), "utf8");
	const js = ts.transpileModule(src, {
		compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
	}).outputText;
	writeFileSync(join(out, "storage-keys.mjs"), js);
	return import(pathToFileURL(join(out, "storage-keys.mjs")).href);
}

const { APP_STORAGE_PREFIX, storageKey, readPersistedRaw, migrateLegacyKey } = await loadStorageKeysModule();

let failures = 0;
const check = (name, ok, extra = "") => {
	if (!ok) {
		failures++;
		console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
	}
};

/** 브라우저 없이 돌리므로 localStorage 를 최소한으로 흉내냅니다. */
function installStorage(initial = {}) {
	const store = new Map(Object.entries(initial));
	globalThis.window = {
		localStorage: {
			getItem: (key) => (store.has(key) ? store.get(key) : null),
			setItem: (key, value) => void store.set(key, String(value)),
			removeItem: (key) => void store.delete(key)
		}
	};
	return store;
}

// 1) 접두어
check("접두어가 붙는다", storageKey("roiLevel") === `${APP_STORAGE_PREFIX}roiLevel`, storageKey("roiLevel"));

// 2) 예전 키에 있던 값을 새 키로 옮긴다
{
	const store = installStorage({ roiLevel: '{"x":1}' });
	const raw = migrateLegacyKey("roiLevel");
	check("예전 값을 읽어 온다", raw === '{"x":1}', String(raw));
	check("새 키로 옮긴다", store.get("ml:exp:roiLevel") === '{"x":1}', String(store.get("ml:exp:roiLevel")));
	check("예전 키는 지우지 않는다", store.get("roiLevel") === '{"x":1}');
}

// 3) 새 키에 값이 있으면 예전 값이 이기지 못한다
{
	const store = installStorage({ roiLevel: '{"old":true}', "ml:exp:roiLevel": '{"new":true}' });
	const raw = migrateLegacyKey("roiLevel");
	check("새 키가 우선", raw === '{"new":true}', String(raw));
	check("새 키를 덮어쓰지 않는다", store.get("ml:exp:roiLevel") === '{"new":true}');
}

// 4) 여러 번 불러도 결과가 같다 (사용자가 값을 바꾼 뒤에도 예전 값이 되살아나지 않는다)
{
	const store = installStorage({ roiExp: '{"old":true}' });
	migrateLegacyKey("roiExp");
	store.set("ml:exp:roiExp", '{"edited":true}');
	const raw = migrateLegacyKey("roiExp");
	check("멱등", raw === '{"edited":true}', String(raw));
}

// 5) 아무 값도 없으면 null
{
	installStorage();
	check("빈 저장소에서는 null", migrateLegacyKey("onboardingDone") === null);
	check("읽기 전용 조회도 null", readPersistedRaw("onboardingDone") === null);
}

// 6) 읽기 전용 조회는 저장하지 않는다 (WebSocket 디버그 스위치가 이걸 씁니다)
{
	const store = installStorage({ externalWsEnabled: "true" });
	check("예전 키를 읽어 준다", readPersistedRaw("externalWsEnabled") === "true");
	check("읽기만 하고 쓰지 않는다", store.has("ml:exp:externalWsEnabled") === false);
}

// 7) localStorage 가 막힌 환경(시크릿 모드 등)에서 던지지 않는다
{
	globalThis.window = {
		localStorage: {
			getItem() {
				throw new Error("보안 정책으로 접근 불가");
			},
			setItem() {
				throw new Error("보안 정책으로 접근 불가");
			}
		}
	};
	let threw = false;
	try {
		migrateLegacyKey("roiLevel");
		readPersistedRaw("roiLevel");
	} catch {
		threw = true;
	}
	check("접근이 막혀도 던지지 않는다", threw === false);
}

if (failures > 0) {
	console.log(`\n${failures}건 실패`);
	process.exit(1);
}
console.log("모든 자체 검증 통과");
