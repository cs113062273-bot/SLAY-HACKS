import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';

import { runFromHash } from './ui/Landing';

if (location.hash.startsWith('#ml-selftest')) {
  // diagnostics: load both models and run one embedding and one verification
  import('./engine/mlClient').then(async (ml) => {
    const t0 = performance.now();
    try {
      const device = await ml.loadModels(undefined, location.hash.endsWith('-wasm') ? 'wasm' : undefined);
      const t1 = performance.now();
      const [v] = await ml.embed(['Transformers rely entirely on attention.'], true);
      const evid = 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable. Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task. We show that the Transformer generalizes well to other tasks.';
      const pairs = Array.from({ length: 10 }, () => ({ claim: 'The Transformer relies entirely on attention mechanisms, dispensing with recurrence.', evidence: evid }));
      const t2 = performance.now();
      const ps = await ml.verifyPairs(pairs);
      const p = ps[0];
      (window as any).perPairMs = Math.round((performance.now() - t2) / pairs.length);
      document.title = 'ML-OK';
      document.body.dataset.ml = JSON.stringify({ device, loadMs: Math.round(t1 - t0), perPairMs: (window as any).perPairMs, isolated: crossOriginIsolated, threads: navigator.hardwareConcurrency, dim: v.length, probs: p });
    } catch (e) {
      document.title = 'ML-FAIL';
      document.body.dataset.ml = String((e as Error)?.stack ?? e);
    }
  });
} else runFromHash();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
