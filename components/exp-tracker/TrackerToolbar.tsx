"use client";

import { cn } from "@/lib/cn";

type Props = {
	isSampling: boolean;
	hasStarted: boolean;
	hasStream: boolean;
	pipSupported: boolean;
	pipUnsupportedTooltip: string;
	onOpenSettings: () => void;
	onOpenRecords: () => void;
	onStart: () => void;
	onPause: () => void;
	onReset: () => void;
	onOpenPip: () => void;
};

export default function TrackerToolbar(props: Props) {
	return (
		<div className="flex items-center gap-2">
			<button className="btn" onClick={props.onOpenSettings}>
				<svg className="w-4 h-4 mr-2 shrink-0" viewBox="0 0 300 300" fill="currentColor" aria-hidden="true">
					<g transform="translate(0.000000,300.000000) scale(0.100000,-0.100000)" fill="currentColor" stroke="none">
						<path d="M1308 2940 c-69 -11 -103 -28 -145 -72 -40 -42 -53 -75 -64 -167 -14
-126 -73 -211 -178 -259 -84 -39 -174 -37 -265 6 -84 40 -157 43 -224 11 -48
-24 -116 -107 -189 -234 -92 -158 -119 -247 -99 -325 16 -60 40 -90 118 -148
108 -81 155 -192 130 -309 -17 -80 -57 -140 -132 -196 -91 -68 -114 -103 -118
-186 -4 -58 0 -77 27 -139 71 -168 195 -348 263 -381 67 -32 140 -29 224 11
91 43 181 45 265 6 105 -48 164 -133 178 -259 11 -95 28 -135 79 -181 61 -56
99 -63 322 -63 223 1 261 8 322 63 51 46 68 86 79 181 14 126 73 211 178 259
84 39 174 37 265 -6 112 -52 205 -42 277 30 79 79 221 330 237 418 11 59 -2
126 -31 167 -13 18 -52 54 -87 80 -75 56 -115 116 -132 196 -25 117 22 228
132 310 91 68 114 103 118 186 4 58 0 77 -27 139 -71 168 -195 348 -263 381
-67 32 -140 29 -224 -11 -91 -43 -181 -45 -265 -6 -108 49 -164 133 -179 266
-5 45 -16 94 -24 110 -22 42 -89 99 -133 112 -48 15 -359 22 -435 10z m375
-1053 c93 -46 159 -112 205 -206 36 -72 37 -79 37 -181 0 -102 -1 -109 -37
-181 -48 -97 -113 -162 -208 -208 -72 -34 -80 -36 -181 -36 -101 0 -108 1
-180 37 -95 47 -160 112 -207 207 -36 72 -37 79 -37 181 0 102 1 109 37 181
43 87 107 155 188 198 79 42 120 51 223 47 77 -3 97 -8 160 -39z"/>
					</g>
				</svg>
				설정
			</button>

			<button className="btn" onClick={props.onOpenRecords}>
				<svg className="w-4 h-4 mr-2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="M6 2h9l3 3v17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
					<path d="M9 9h6" />
					<path d="M9 13h6" />
					<path d="M9 17h6" />
				</svg>
				기록
			</button>

			<div className="ml-auto flex items-center gap-2">
				{props.isSampling ? (
					<button className="btn btn-danger" onClick={props.onPause}>
						측정 일시정지 <span className="ml-2 text-xs opacity-70">Space</span>
					</button>
				) : (
					<button className="btn btn-primary" onClick={props.onStart} disabled={!props.hasStream}>
						측정 시작 <span className="ml-2 text-xs opacity-70">Space</span>
					</button>
				)}

				<button className="btn btn-warning" onClick={props.onReset} disabled={!props.hasStarted}>
					초기화
					<span className="ml-2 text-xs opacity-70">R</span>
				</button>

				<div className="relative inline-block group">
					<button
						className={cn("btn", !props.pipSupported && "cursor-not-allowed opacity-70")}
						onClick={props.onOpenPip}
						disabled={!props.pipSupported}
						aria-disabled={!props.pipSupported}
						aria-label="PiP 열기"
					>
						PiP 열기
						<span className="ml-2 text-xs opacity-70">P</span>
						<svg
							className="w-4 h-4 ml-2 shrink-0"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.8"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<rect x="3" y="4" width="18" height="14" rx="2" ry="2" />
							<rect x="13" y="10" width="7" height="5" rx="1" ry="1" />
						</svg>
					</button>
					{!props.pipSupported && (
						<div
							role="tooltip"
							className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-pre rounded border border-white/10 bg-black/90 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
						>
							{props.pipUnsupportedTooltip}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}


