import ExpTracker from "@/components/ExpTracker";
import TopRightMeta from "@/components/TopRightMeta";

export default function Page() {
	return (
		<main className="mx-auto max-w-6xl p-6 space-y-6">
			<header className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">메이플랜드 경험치 측정기</h1>
				<TopRightMeta />
			</header>
			<ExpTracker />
		</main>
	);
}

