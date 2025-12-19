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

declare global {
  interface Window {
    // Experimental Document Picture-in-Picture API (Chrome/Edge)
    documentPictureInPicture?: {
      window?: Window | null;
      requestWindow?: (options?: { width?: number; height?: number }) => Promise<Window>;
    };
  }
}

export {};

