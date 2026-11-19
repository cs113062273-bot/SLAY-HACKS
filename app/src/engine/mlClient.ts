/** Promise wrapper around the ML worker. */
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
let ready: Promise<string> | null = null;
let onProgress: ((loaded: number, total: number) => void) | null = null;
const files = new Map<string, { loaded: number; total: number }>();

function ensure(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./ml.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'progress') {
      files.set(`${m.kind}:${m.file}`, { loaded: m.loaded, total: m.total });
      let l = 0;
      let t = 0;
      for (const f of files.values()) {
        l += f.loaded;
        t += f.total;
      }
      onProgress?.(l, t);
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.type === 'error') p.reject(new Error(m.error));
    else p.resolve(m.type === 'ready' ? m.device : m.data);
  };
  return worker;
}

function call<T>(msg: Record<string, unknown>): Promise<T> {
  const w = ensure();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...msg, id });
  });
}

export function loadModels(progress?: (loaded: number, total: number) => void, device?: 'wasm' | 'webgpu'): Promise<string> {
  onProgress = progress ?? null;
  if (!ready) ready = call<string>({ type: 'load', base: new URL(import.meta.env.BASE_URL, location.href).href, device });
  return ready;
}

export const embed = (texts: string[], query = false) => call<number[][]>({ type: 'embed', texts, query });
export const verifyPairs = (pairs: { claim: string; evidence: string }[]) => call<number[][]>({ type: 'verify', pairs });
