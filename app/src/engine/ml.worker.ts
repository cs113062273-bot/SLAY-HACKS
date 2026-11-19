/// <reference lib="webworker" />
/**
 * In-browser ML worker (transformers.js, ONNX Runtime Web).
 * - embedder: e5-small-v2 sentence embeddings for evidence retrieval (Hugging Face CDN)
 * - verifier: Veracite claim/evidence cross-encoder → [ACCURATE, NOT_ACCURATE, NEI] (served with the site)
 * Runs on WebGPU when available and falls back to WASM automatically if WebGPU fails at any point.
 */
import { AutoModelForSequenceClassification, AutoTokenizer, env, pipeline } from '@huggingface/transformers';
import { MODELS } from './models';

env.useBrowserCache = true;
// multi-threaded WASM when the page is cross-origin isolated (see public/coi-serviceworker.js)
if ((self as any).crossOriginIsolated && (env as any).backends?.onnx?.wasm) {
  (env as any).backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
}

let embedder: any = null;
let tok: any = null;
let verifier: any = null;
let device: 'webgpu' | 'wasm' = 'wasm';
let base = '/';

async function pickDevice(): Promise<'webgpu' | 'wasm'> {
  try {
    const gpu = (navigator as any).gpu;
    if (gpu && (await gpu.requestAdapter())) return 'webgpu';
  } catch {
    /* no webgpu */
  }
  return 'wasm';
}

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

function progress(kind: string) {
  return (p: any) => {
    if (p.status === 'progress' && p.total) post({ type: 'progress', kind, file: p.file, loaded: p.loaded, total: p.total });
  };
}

async function load(dev: 'webgpu' | 'wasm') {
  device = dev;
  // embedder from the Hugging Face CDN, verifier from this site: each model is looked up in exactly one place
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  embedder = await pipeline('feature-extraction', MODELS.embedder.id, { device, dtype: device === 'webgpu' ? 'fp32' : 'q8', progress_callback: progress('embedder') } as any);
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  // must be a site-relative path: transformers.js skips its local probe for absolute URLs
  env.localModelPath = new URL('models/', base).pathname;
  tok = tok ?? (await AutoTokenizer.from_pretrained(MODELS.verifier.id, { progress_callback: progress('verifier') } as any));
  // 4-bit weight-only MatMuls + int8 embeddings (dev macro-F1 equal to fp32; see ml/export_onnx.py)
  verifier = await AutoModelForSequenceClassification.from_pretrained(MODELS.verifier.id, { device, dtype: 'q4', progress_callback: progress('verifier') } as any);
}

/** Run with the current device; on a WebGPU failure, reload on WASM once and retry. */
async function withFallback<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (device !== 'webgpu') throw e;
    console.warn('WebGPU inference failed; switching to WASM.', e);
    await load('wasm');
    return fn();
  }
}

async function embed(texts: string[], query: boolean): Promise<number[][]> {
  const out = await embedder(
    texts.map((t) => (query ? MODELS.embedder.queryPrefix : MODELS.embedder.passagePrefix) + t),
    { pooling: MODELS.embedder.pooling, normalize: true },
  );
  return out.tolist();
}

async function verify(pairs: { claim: string; evidence: string }[]): Promise<number[][]> {
  const res: number[][] = [];
  const bs = device === 'webgpu' ? 8 : 4;
  for (let i = 0; i < pairs.length; i += bs) {
    const batch = pairs.slice(i, i + bs);
    const inputs = tok(
      batch.map((p) => p.claim),
      { text_pair: batch.map((p) => p.evidence), padding: true, truncation: true, max_length: MODELS.verifier.maxLen },
    );
    const { logits } = await verifier(inputs);
    for (const row of logits.tolist() as number[][]) {
      const mx = Math.max(...row);
      const ex = row.map((v) => Math.exp(v - mx));
      const s = ex.reduce((a, b) => a + b, 0);
      res.push(ex.map((v) => v / s));
    }
  }
  return res;
}

// one operation at a time: concurrent GPU runs can fail buffer mapping
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  serial(async () => {
    try {
      if (m.type === 'load') {
        base = m.base;
        try {
          // WASM by default: measured 1.0 s per claim and fully reliable, while WebGPU inference on this
          // model failed intermittently (buffer mapping) in testing. WebGPU is opt-in via m.device.
          await load(m.device ?? 'wasm');
          void pickDevice;
        } catch (e) {
          if (device !== 'webgpu') throw e;
          console.warn('WebGPU model load failed; using WASM.', e);
          await load('wasm');
        }
        post({ type: 'ready', id: m.id, device: `${device} isolated=${(self as any).crossOriginIsolated} threads=${(env as any).backends?.onnx?.wasm?.numThreads}` });
      } else if (m.type === 'embed') {
        post({ type: 'result', id: m.id, data: await withFallback(() => embed(m.texts, !!m.query)) });
      } else if (m.type === 'verify') {
        post({ type: 'result', id: m.id, data: await withFallback(() => verify(m.pairs)) });
      }
    } catch (e) {
      post({ type: 'error', id: m.id, error: (e as Error).message });
    }
  });
};
