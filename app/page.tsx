import ExpTracker from "@/components/ExpTracker";
import TopRightMeta from "@/components/TopRightMeta";
import MushroomIcon from "@/components/MushroomIcon";

export default function Page() {
	return (
		<main className="mx-auto max-w-6xl p-6 space-y-6">
			<header className="flex items-center justify-between">
				<h1 className="flex items-center gap-2 text-2xl font-semibold">
					<MushroomIcon size={22} className="text-white/90" />
					<span>메이플랜드 경험치 측정기</span>
				</h1>
				<TopRightMeta />
			</header>
			<ExpTracker />
		</main>
	);
}

