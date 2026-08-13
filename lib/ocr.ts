import { parsePixelExpText, recognizePixelFontLine } from "./pixelOcr";
import { recognizeLevelPixelFont } from "./levelPixelOcr";

/**
 * OCR 진입점
 *
 * 경험치(EXP)와 레벨(LEVEL) **둘 다** 픽셀 글꼴 템플릿 매칭으로 읽습니다. Tesseract는 쓰지 않습니다.
 *
 * 왜 Tesseract를 걷어냈나:
 * - 두 텍스트 모두 안티에일리어싱이 없는 고정 픽셀 패턴이라, 픽셀 단위로 맞춰보는 쪽이 훨씬 정확합니다.
 * - LSTM OCR은 애매할 때도 **확신에 찬 틀린 값**을 돌려줍니다. 레벨 193을 183으로 읽는 식인데,
 *   틀린 레벨은 누적 EXP 계산을 통째로 오염시킵니다. 템플릿 매칭은 애매하면 `null`을 돌려주고,
 *   그러면 그 샘플을 건너뛸 뿐입니다.
 * - 런타임에 jsdelivr에서 wasm 코어와 언어 모델을 받아오던 것도 함께 사라졌습니다.
 *   (경로에 따라 약 5.8MB ~ 14.4MB) 이 앱은 서버가 없는 정적 배포라 외부 CDN 의존이 하나 줄었습니다.
 * - 워커 큐, 주기적 워커 재시작, 2패스 폴백, 문자 혼동 보정(O→0, l/I/|→1) 같은 부속 코드도 전부
 *   필요 없어졌습니다.
 *
 * 두 인식기 모두 **원본 배율(scale: 1) ROI**를 받아야 합니다. 확대하거나 이진화하면 글리프가
 * 뭉개져서 인식이 망가집니다. 그리고 둘 다 동기 함수입니다.
 */

export type ExpReadResult = {
	/** 인식된 원본 문자열. 미인식 글리프는 `?`(숫자 자리) / `_`(그 외)로 표시됩니다. */
	text: string;
	value: number | null;
	percent: number | null;
};

/**
 * EXP 영역 인식.
 *
 * `nativeRoiCanvas`는 **확대/이진화하지 않은 원본 배율 ROI**여야 합니다.
 * 값/퍼센트를 확신할 수 없으면 둘 다 null로 돌려줍니다. (틀린 값을 흘리는 것보다 낫습니다)
 */
export function recognizeExp(nativeRoiCanvas: HTMLCanvasElement): ExpReadResult {
	const line = recognizePixelFontLine(nativeRoiCanvas);
	if (!line) return { text: "", value: null, percent: null };
	const parsed = parsePixelExpText(line.text);
	return { text: line.text, value: parsed?.value ?? null, percent: parsed?.percent ?? null };
}

export type LevelReadResult = {
	/** 인식된 문자열. 미인식 글리프는 `?` 입니다. */
	text: string;
	value: number | null;
};

/**
 * 레벨(LEVEL) 영역 인식.
 *
 * `nativeRoiCanvas`는 **확대/이진화하지 않은 원본 배율 ROI**여야 합니다.
 * 한 자리라도 확신할 수 없으면 값은 null입니다. (자릿수가 빠진 레벨을 채택하면 안 됩니다)
 */
export function recognizeLevel(nativeRoiCanvas: HTMLCanvasElement): LevelReadResult {
	const res = recognizeLevelPixelFont(nativeRoiCanvas);
	if (!res) return { text: "", value: null };
	return { text: res.text, value: res.value };
}
