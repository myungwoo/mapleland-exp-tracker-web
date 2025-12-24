// 서브패스(예: GitHub Pages)로 배포될 때 asset URL에 베이스 경로(basePath)를 붙이는 헬퍼입니다.
// - 절대 URL(http/https), 프로토콜 상대 URL(//...), 데이터 URL은 그대로 둡니다.
// - 루트 상대/상대 경로는 NEXT_PUBLIC_BASE_PATH가 있으면 앞에 붙입니다.
export function assetPath(inputPath: string): string {
  if (!inputPath) return inputPath;
  // 절대 URL 또는 프로토콜 상대 URL
  if (/^(?:[a-z]+:)?\/\//i.test(inputPath)) return inputPath;
  // 데이터 URL
  if (inputPath.startsWith("data:")) return inputPath;
  const base = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");
  if (!base) return inputPath;
  if (inputPath.startsWith("/")) {
    return `${base}${inputPath}`;
  }
  return `${base}/${inputPath}`.replace(/\/{2,}/g, "/");
}


