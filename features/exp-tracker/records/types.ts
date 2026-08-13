import type { SamplingSnapshot } from "@/features/exp-tracker/hooks/useSampling";
import type { PaceSeriesSnapshot } from "@/features/exp-tracker/hooks/usePaceSeries";
import type { StopwatchSnapshot } from "@/features/exp-tracker/hooks/useStopwatch";

/**
 * 기록(Record)은 “세션 상태”만 저장합니다.
 * - 설정(ROI, 측정 주기, 페이스 기준 시간, 차트 표시 옵션, 디버그 등)은 기록에 포함하지 않습니다.
 * - 차트는 원본 데이터(history)를 저장하고, 표시(페이스 스케일 등)는 현재 설정에 의해 계산됩니다.
 */
export type ExpTrackerSnapshotV4 = {
	version: 4;
	capturedAt: number; // epoch ms
	runtime: {
		hasStarted: boolean;
		/** 측정 종료 후 입력한 경험치 쿠폰 사용 개수 (구버전 기록에는 없어 0으로 복원됩니다) */
		expCouponCount: number;
	};
	stopwatch: StopwatchSnapshot;
	/** 왜: v3까지는 이 필드 이름이 `ocr`이었습니다. (v3 이하 복원은 snapshot.ts가 처리합니다) */
	sampling: SamplingSnapshot;
	pace: PaceSeriesSnapshot; // chart raw history
};

export type ExpTrackerSnapshot = ExpTrackerSnapshotV4;

export type RecordItem = {
	id: string;
	name: string;
	createdAt: number; // epoch ms
	updatedAt: number; // epoch ms
	snapshot: ExpTrackerSnapshot;
};

export type RecordsDbV1 = {
	version: 1;
	records: RecordItem[];
};

export type RecordsExportRecordV1 = {
	kind: "mapleland-exp-tracker-record";
	version: 1;
	exportedAt: number;
	record: RecordItem;
};

export type RecordsExportArchiveV1 = {
	kind: "mapleland-exp-tracker-archive";
	version: 1;
	exportedAt: number;
	records: RecordItem[];
};
