/** @type {import('next').NextConfig} */
const isGhPages = process.env.GITHUB_PAGES === "true";
const repo = (process.env.GITHUB_REPOSITORY || "").split("/")[1] || "";
const basePath = isGhPages && repo ? `/${repo}` : "";

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

