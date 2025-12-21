/** @type {import("eslint").Linter.Config} */
module.exports = {
	root: true,
	extends: ["next/core-web-vitals"],
	// 왜: 이 프로젝트는 빠르게 반복 개발되며 리팩터링 중이라,
	// 과도한 규칙 추가보다는 Next 기본 권장 규칙부터 적용합니다.
};


