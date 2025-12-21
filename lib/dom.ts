/**
 * 전역 키보드 단축키를 쓸 때, 입력 중인 폼을 방해하지 않기 위한 판별 함수입니다.
 * - 왜: input/textarea/select/contentEditable에서 Space/R 같은 단축키가 먹으면 UX가 나빠집니다.
 */
export function isEditableElement(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;

	const tag = target.tagName.toLowerCase();
	if (target.isContentEditable) return true;
	if (tag === "input") return true;
	if (tag === "textarea") return true;
	if (tag === "select") return true;

	return false;
}


