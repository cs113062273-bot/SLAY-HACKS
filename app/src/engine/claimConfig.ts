/** Claim-verification settings. Thresholds are tuned on the Citation-Integrity dev split (see ml/). */
export const CLAIM_CONFIG = {
  topK: 5,
  // calibrated with the shipped model (ml/calib.py on Citation-Integrity dev, ml/calib_sc.py on SemanticCite):
  // supported: P(acc) ≥ .5 → precision .75 (biomedical CI) / .93 (SemanticCite, 8 fields)
  // review: P(not accurate or unrelated) ≥ .98 → flags 8% of supported vs 41% of unsupported citations across fields
  thresholds: { supported: 0.5, review: 0.98, unrelatedMulti: 0.98 },
  /** BM25 prefilter before dense re-scoring (keeps full-text retrieval fast in WASM) */
  prefilter: 40,
};
