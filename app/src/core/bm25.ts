/** Small BM25 implementation for ranking evidence sentences inside one source document. */
// Tokenization mirrors ml/retrieval.py so browser retrieval matches the verifier's training contexts.
const STOP = new Set('a an the of for and in on to with by from at via as is are was were be been this that these those it its into or than'.split(' '));

export function bmTokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOP.has(t));
}

export function bm25(query: string, docs: string[], k1 = 1.5, b = 0.75): number[] {
  const D = docs.map(bmTokens);
  const N = D.length;
  const avg = D.reduce((s, d) => s + d.length, 0) / Math.max(1, N);
  const df = new Map<string, number>();
  for (const d of D) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const q = [...new Set(bmTokens(query))];
  return D.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg));
    }
    return s;
  });
}

/** Reciprocal rank fusion of several score lists. */
export function rrf(lists: number[][], k = 60): number[] {
  const n = lists[0]?.length ?? 0;
  const out = new Array(n).fill(0);
  for (const s of lists) {
    const order = s.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
    order.forEach(([, i], r) => (out[i] += 1 / (k + r + 1)));
  }
  return out;
}
