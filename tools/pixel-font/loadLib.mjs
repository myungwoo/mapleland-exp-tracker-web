import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, "..", "..", "lib");

/**
 * `lib/pixelFont.ts` / `lib/pixelOcr.ts` 를 Node에서 그대로 돌리기 위한 로더입니다.
 *
 * 별도 빌드 스텝 없이 TypeScript 컴파일러로 타입만 제거해서 임시 폴더에 .mjs 로 떨어뜨립니다.
 * (도구가 앱 코드와 항상 같은 구현을 쓰도록 하려는 목적입니다. 로직을 도구에 복사해두면 반드시 어긋납니다)
 */
function transpileToTemp(names) {
	const out = mkdtempSync(join(tmpdir(), "pixelfont-"));
	for (const name of names) {
		const src = readFileSync(join(libDir, `${name}.ts`), "utf8");
		let js = ts.transpileModule(src, {
			compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
		}).outputText;
		// 같이 옮겨온 모듈끼리의 상대 import에 확장자를 붙여줍니다. (Node ESM은 확장자를 요구합니다)
		for (const other of names) {
			js = js
				.replaceAll(`from "./${other}"`, `from "./${other}.mjs"`)
				.replaceAll(`from './${other}'`, `from "./${other}.mjs"`);
		}
		writeFileSync(join(out, `${name}.mjs`), js);
	}
	return out;
}

/**
 * `lib/` 의 모듈들을 Node에서 그대로 import합니다.
 *
 * @param names 함께 옮길 모듈 이름들 (상대 import로 서로 참조해도 됩니다)
 * @param entry import해서 돌려줄 모듈 이름
 */
export async function loadLibModules(names, entry) {
	const out = transpileToTemp(names);
	return import(pathToFileURL(join(out, `${entry}.mjs`)).href);
}

export async function loadPixelOcr() {
	const out = transpileToTemp(["pixelFont", "pixelOcr"]);
	return import(pathToFileURL(join(out, "pixelOcr.mjs")).href);
}

/** 템플릿 자체(`lib/pixelFont.ts`)를 Node에서 읽습니다. */
export async function loadPixelFont() {
	const out = transpileToTemp(["pixelFont"]);
	return import(pathToFileURL(join(out, "pixelFont.mjs")).href);
}
