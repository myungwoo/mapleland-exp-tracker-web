/** @type {import('next').NextConfig} */
const isGhPages = process.env.GITHUB_PAGES === "true";
const repo = (process.env.GITHUB_REPOSITORY || "").split("/")[1] || "";
const basePath = isGhPages && repo ? `/${repo}` : "";

const nextConfig = {
	output: "export",
	images: {
		// Static export (output: "export") can't use the built-in Image Optimization API.
		// This makes next/image render without optimization so it works on GitHub Pages / static hosting.
		unoptimized: true
	},
	...(basePath ? { basePath, assetPrefix: basePath } : {}),
	// Expose basePath to the client for building asset URLs in plain <img> tags
	env: {
		NEXT_PUBLIC_BASE_PATH: basePath
	},
	experimental: {
		esmExternals: true
	}
};

export default nextConfig;

