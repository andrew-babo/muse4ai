/// <reference types="vite/client" />

interface MuseBridge {
  invoke(command: string, input?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string; code?: string }>;
  onEvents(cb: (batch: { type: string; payload: unknown; rev: number }[]) => void): () => void;
  pathForFile(file: File): string;
  platform: string;
}

interface Window {
  muse: MuseBridge;
}
