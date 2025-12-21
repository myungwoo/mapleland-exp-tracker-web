"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AlertDialog from "@/components/AlertDialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import Modal from "@/components/Modal";
import { cn } from "@/lib/cn";
import { formatElapsed, formatNumber } from "@/lib/format";
import type { ExpTrackerSnapshot, RecordItem } from "@/features/exp-tracker/records/types";
import { deleteRecord, deleteRecords, exportArchiveJson, exportRecordJson, importFromJsonText, listRecords, saveNewRecord } from "@/features/exp-tracker/records/store";

type Props = {
	open: boolean;
	onClose: () => void;
	canSave: boolean;
	canLoad: boolean;
	avgWindowMin: number;
	getSnapshot: () => ExpTrackerSnapshot;
	applySnapshot: (snap: ExpTrackerSnapshot) => void;
};

function downloadTextFile(filename: string, text: string, mime = "application/json") {
	const blob = new Blob([text], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 500);
}

function formatDateTime(ts: number) {
	try {
		return new Date(ts).toLocaleString();
	} catch {
		return String(ts);
	}
}

function paceForAvgWindow(cumExpValue: number, elapsedMs: number, avgWindowMin: number): number | null {
	const ms = Math.max(0, elapsedMs);
	if (ms < 1000) return null;
	const factor = (Math.max(1, avgWindowMin) * 60 * 1000) / ms;
	const v = cumExpValue * factor;
	return Number.isFinite(v) ? v : null;
}

export default function RecordsModal(props: Props) {
	const [records, setRecords] = useState<RecordItem[]>([]);
	const [name, setName] = useState<string>("");
	const [busy, setBusy] = useState<string | null>(null);
	const [defaultName, setDefaultName] = useState<string>("");
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const confirmActionRef = useRef<null | (() => void)>(null);
	const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; danger?: boolean }>({
		open: false,
		title: "확인",
		message: ""
	});
	const [alertState, setAlertState] = useState<{ open: boolean; title: string; message: string }>({
		open: false,
		title: "알림",
		message: ""
	});

	const refresh = () => setRecords(listRecords());

	useEffect(() => {
		if (props.open) refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.open]);

	const totalCount = records.length;
	const selectedCount = selectedIds.size;
	const allSelected = totalCount > 0 && selectedCount === totalCount;

	const selectedRecords = useMemo(() => {
		if (selectedIds.size === 0) return [];
		const s = selectedIds;
		return records.filter(r => s.has(r.id));
	}, [records, selectedIds]);

	const openAlert = (message: string, title = "알림") => {
		setAlertState({ open: true, title, message });
	};

	const openConfirm = (args: { title?: string; message: string; danger?: boolean; onConfirm: () => void }) => {
		confirmActionRef.current = args.onConfirm;
		setConfirmState({
			open: true,
			title: args.title ?? "확인",
			message: args.message,
			danger: args.danger
		});
	};

	useEffect(() => {
		if (!props.open) return;
		const t = new Date();
		const s = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
		setDefaultName(`기록 ${s}`);
	}, [props.open]);

	return (
		<>
		<Modal
			open={props.open}
			onClose={props.onClose}
			title="기록"
			variant="panel"
			className="max-w-4xl"
		>
			<div className="space-y-3">
				<div className="flex flex-col md:flex-row gap-2 md:items-center">
					<input
						className="flex-1 bg-white/10 text-white rounded px-3 py-2 text-sm border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
						placeholder={defaultName}
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
					<button
						className={cn("btn btn-primary", busy && "opacity-70 cursor-not-allowed")}
						disabled={!!busy || !props.canSave}
						onClick={() => {
							if (!props.canSave) {
								openAlert("타이머를 일시정지한 상태에서만 기록을 저장할 수 있습니다.");
								return;
							}
							try {
								setBusy("save");
								const snap = props.getSnapshot();
								saveNewRecord(name || defaultName, snap);
								setName("");
								refresh();
							} catch (e: any) {
								openAlert(e?.message ?? "저장에 실패했습니다.");
							} finally {
								setBusy(null);
							}
						}}
					>
						현재 상태 저장
					</button>
					<button
						className={cn("btn", busy && "opacity-70 cursor-not-allowed")}
						disabled={!!busy}
						onClick={() => fileInputRef.current?.click()}
					>
						파일에서 불러오기
					</button>
					<input
						ref={fileInputRef}
						type="file"
						accept="application/json,.json"
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (!file) return;
							const reader = new FileReader();
							reader.onload = () => {
								try {
									setBusy("import");
									const text = String(reader.result ?? "");
									const res = importFromJsonText(text);
									refresh();
									openAlert(`가져오기 완료: ${res.imported}개`);
								} catch (err: any) {
									openAlert(err?.message ?? "가져오기에 실패했습니다.");
								} finally {
									setBusy(null);
									// allow importing same file again
									if (fileInputRef.current) fileInputRef.current.value = "";
								}
							};
							reader.readAsText(file);
						}}
					/>
				</div>

				<div className="text-sm text-white/60">
					총 {totalCount}개 · 이전 기록을 불러오거나, 기록을 파일로 내보내기/불러오기 할 수 있습니다.
				</div>
				<div className="text-xs text-white/50">
					기록 저장/불러오기는 <span className="text-white/70">타이머 일시정지 상태</span>에서만 가능합니다.
				</div>

				<div className="flex items-center gap-2 border border-white/10 rounded px-3 py-2 bg-white/5">
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={allSelected}
							disabled={totalCount === 0}
							onChange={() => {
								if (totalCount === 0) return;
								setSelectedIds(prev => {
									if (prev.size === totalCount) return new Set();
									return new Set(records.map(r => r.id));
								});
							}}
						/>
						전체 선택
					</label>
					<div className="ml-auto text-sm text-white/70">선택 {selectedCount}개</div>
					<button
						className={cn("btn", busy && "opacity-70 cursor-not-allowed")}
						disabled={!!busy || selectedCount === 0}
						onClick={() => {
							try {
								setBusy("export-selected");
								const json = exportArchiveJson(selectedRecords);
								downloadTextFile(`mapleland-exp-tracker-selected-${Date.now()}.json`, json);
							} finally {
								setBusy(null);
							}
						}}
					>
						선택 내보내기
					</button>
					<button
						className={cn("btn btn-danger", busy && "opacity-70 cursor-not-allowed")}
						disabled={!!busy || selectedCount === 0}
						onClick={() => {
							openConfirm({
								title: "선택 삭제",
								message: `선택한 기록 ${selectedCount}개를 삭제할까요?\n\n삭제한 기록은 되돌릴 수 없습니다.`,
								danger: true,
								onConfirm: () => {
									deleteRecords(Array.from(selectedIds));
									setSelectedIds(new Set());
									refresh();
								}
							});
						}}
					>
						선택 삭제
					</button>
				</div>

				<div className="divide-y divide-white/10 border border-white/10 rounded overflow-hidden">
					{records.length === 0 ? (
						<div className="p-4 text-sm text-white/60">저장된 기록이 없습니다. “현재 상태 저장”으로 기록을 만들어보세요.</div>
					) : (
						records.map((r) => (
							<div key={r.id} className="p-3 flex flex-col md:flex-row md:items-center gap-3">
								<label className="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										checked={selectedIds.has(r.id)}
										onChange={() => {
											setSelectedIds(prev => {
												const next = new Set(prev);
												if (next.has(r.id)) next.delete(r.id);
												else next.add(r.id);
												return next;
											});
										}}
									/>
								</label>
								<div className="flex-1 min-w-0">
									<div className="font-medium truncate">{r.name}</div>
									<div className="text-xs text-white/60">
										{formatDateTime(r.createdAt)}
										{" · "}
										경과 {formatElapsed(r.snapshot.stopwatch?.elapsedMs ?? 0)}
										{" · "}
										누적 {formatNumber((r.snapshot.ocr?.cumExpValue ?? 0) as number)}
										{" · "}
										페이스{" "}
										{(() => {
											const p = paceForAvgWindow(
												Number((r.snapshot.ocr?.cumExpValue ?? 0) as number),
												Number((r.snapshot.stopwatch?.elapsedMs ?? 0) as number),
												props.avgWindowMin
											);
											return p == null ? "-" : `${formatNumber(p)} / ${props.avgWindowMin}분`;
										})()}
									</div>
								</div>
								<div className="flex items-center gap-2">
									<button
										className={cn("btn btn-primary", busy && "opacity-70 cursor-not-allowed")}
										disabled={!!busy || !props.canLoad}
										onClick={() => {
											if (!props.canLoad) {
												openAlert("타이머를 일시정지한 상태에서만 기록을 불러올 수 있습니다.");
												return;
											}
											openConfirm({
												title: "기록 불러오기",
												message: `이 기록을 불러올까요?\n\n"${r.name}"`,
												onConfirm: () => {
													try {
														setBusy("load");
														props.applySnapshot(r.snapshot);
														props.onClose();
													} finally {
														setBusy(null);
													}
												}
											});
										}}
									>
										불러오기
									</button>
									<button
										className={cn("btn", busy && "opacity-70 cursor-not-allowed")}
										disabled={!!busy}
										onClick={() => {
											try {
												setBusy("export-one");
												const json = exportRecordJson(r);
												downloadTextFile(`mapleland-exp-tracker-record-${r.id}.json`, json);
											} finally {
												setBusy(null);
											}
										}}
									>
										내보내기
									</button>
									<button
										className={cn("btn btn-danger", busy && "opacity-70 cursor-not-allowed")}
										disabled={!!busy}
										onClick={() => {
											openConfirm({
												title: "삭제",
												message: `삭제할까요?\n\n"${r.name}"\n\n삭제한 기록은 되돌릴 수 없습니다.`,
												danger: true,
												onConfirm: () => {
													try {
														setBusy("delete");
														deleteRecord(r.id);
														setSelectedIds(prev => {
															const next = new Set(prev);
															next.delete(r.id);
															return next;
														});
														refresh();
													} finally {
														setBusy(null);
													}
												}
											});
										}}
									>
										삭제
									</button>
								</div>
							</div>
						))
					)}
				</div>
			</div>
		</Modal>

		<AlertDialog
			open={alertState.open}
			title={alertState.title}
			message={alertState.message}
			onClose={() => setAlertState((s) => ({ ...s, open: false }))}
		/>
		<ConfirmDialog
			open={confirmState.open}
			title={confirmState.title}
			message={confirmState.message}
			danger={confirmState.danger}
			onCancel={() => {
				confirmActionRef.current = null;
				setConfirmState((s) => ({ ...s, open: false }));
			}}
			onConfirm={() => {
				const fn = confirmActionRef.current;
				confirmActionRef.current = null;
				setConfirmState((s) => ({ ...s, open: false }));
				fn?.();
			}}
		/>
		</>
	);
}


