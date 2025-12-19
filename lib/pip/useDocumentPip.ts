import { useCallback, useEffect, useRef } from "react";
import { PipController } from "./PipController";
import type { PipCallbacks, PipState } from "./types";

export function isDocumentPipSupported(): boolean {
  if (typeof window === "undefined") return false;
  const dpi = (window as any).documentPictureInPicture;
  return !!(dpi && typeof dpi.requestWindow === "function");
}

export function useDocumentPip(callbacks: PipCallbacks) {
  const controllerRef = useRef<PipController | null>(null);
  const cbRef = useRef<PipCallbacks>(callbacks);
  useEffect(() => { cbRef.current = callbacks; }, [callbacks]);

  // Lazily create controller
  const ensure = useCallback(() => {
    if (!controllerRef.current) {
      controllerRef.current = new PipController({
        onToggle: () => cbRef.current.onToggle(),
        onReset: () => cbRef.current.onReset()
      });
    } else {
      controllerRef.current.setCallbacks({
        onToggle: () => cbRef.current.onToggle(),
        onReset: () => cbRef.current.onReset()
      });
    }
    return controllerRef.current;
  }, []);

  const open = useCallback(async () => {
    const c = ensure();
    await c.open();
  }, [ensure]);

  const update = useCallback((state: PipState) => {
    const c = ensure();
    c.update(state);
  }, [ensure]);

  const close = useCallback(() => {
    controllerRef.current?.close();
    controllerRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      controllerRef.current?.close();
      controllerRef.current = null;
    };
  }, []);

  return { open, update, close, isOpen: () => !!controllerRef.current?.isOpen() };
}

