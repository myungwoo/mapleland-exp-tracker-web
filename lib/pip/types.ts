export type PipCallbacks = {
  onToggle: () => void;
  onReset: () => void;
};

export type PipState = {
  isSampling: boolean;
  elapsedMs: number;
  nextAt: Date | null;
  nextHours: number | null;
  gainedText: string;
  estText: string;
};

