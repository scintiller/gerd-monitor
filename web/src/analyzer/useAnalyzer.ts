import { useCallback, useRef, useState } from 'react';
import type { Overview, RefluxEvent, Summary } from '../types';

export type AnalyzeStatus =
  | { kind: 'idle' }
  | { kind: 'parsing'; bytesRead: number; bytesTotal: number }
  | { kind: 'analyzing'; stage: string }
  | { kind: 'done'; data: AnalysisResult }
  | { kind: 'error'; message: string };

export interface AnalysisResult {
  summary: Summary;
  events: RefluxEvent[];
  overview: Overview;
}

export function useAnalyzer() {
  const [status, setStatus] = useState<AnalyzeStatus>({ kind: 'idle' });
  const workerRef = useRef<Worker | null>(null);

  const analyze = useCallback((file: File) => {
    if (workerRef.current) workerRef.current.terminate();
    setStatus({ kind: 'parsing', bytesRead: 0, bytesTotal: file.size });

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.addEventListener('message', (e) => {
      const msg = e.data as
        | { type: 'parsing'; bytesRead: number; bytesTotal: number }
        | { type: 'analyzing'; stage: string }
        | { type: 'done'; payload: AnalysisResult }
        | { type: 'error'; message: string };

      if (msg.type === 'parsing') setStatus({ kind: 'parsing', bytesRead: msg.bytesRead, bytesTotal: msg.bytesTotal });
      else if (msg.type === 'analyzing') setStatus({ kind: 'analyzing', stage: msg.stage });
      else if (msg.type === 'done') {
        setStatus({ kind: 'done', data: msg.payload });
        worker.terminate();
        workerRef.current = null;
      } else if (msg.type === 'error') {
        setStatus({ kind: 'error', message: msg.message });
        worker.terminate();
        workerRef.current = null;
      }
    });

    worker.addEventListener('error', (e) => {
      setStatus({ kind: 'error', message: e.message || 'Worker error' });
    });

    worker.postMessage({ file });
  }, []);

  const reset = useCallback(() => {
    if (workerRef.current) workerRef.current.terminate();
    workerRef.current = null;
    setStatus({ kind: 'idle' });
  }, []);

  return { status, analyze, reset };
}
