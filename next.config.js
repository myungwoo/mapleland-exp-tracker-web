/** @type {import('next').NextConfig} */
// 하위 경로를 어디서 정하는가:
// 1) NEXT_PUBLIC_BASE_PATH 가 있으면 그대로 씁니다. 통합 사이트
//    (mapleland.myungwoo.kr/<경로>)처럼 리포 이름과 하위 경로가 다를 수 있는 배포는
//    이걸로 직접 지정합니다.
// 2) 없으면 GitHub Pages 프로젝트 페이지 규칙(/<repo>)을 따릅니다.
// 3) 로컬 개발에서는 둘 다 없으므로 빈 문자열이 되어 http://localhost:3000 그대로 뜹니다.
const explicitBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
const isGhPages = process.env.GITHUB_PAGES === "true";
const repo = (process.env.GITHUB_REPOSITORY || "").split("/")[1] || "";
const basePath = explicitBasePath ?? (isGhPages && repo ? `/${repo}` : "");

const nextConfig = {
	output: "export",
	images: {
		// 정적 export(output: "export")에서는 Next의 내장 이미지 최적화 API를 사용할 수 없습니다.
		// next/image가 최적화 없이 렌더링되도록 해서 GitHub Pages / 정적 호스팅에서도 동작하게 합니다.
		unoptimized: true
	},
	...(basePath ? { basePath, assetPrefix: basePath } : {}),
	// 일반 <img> 태그에서 asset URL을 만들 수 있도록 basePath를 클라이언트에 노출합니다.
	env: {
		NEXT_PUBLIC_BASE_PATH: basePath
	},
	experimental: {
		esmExternals: true
	}
};

export default nextConfig;
