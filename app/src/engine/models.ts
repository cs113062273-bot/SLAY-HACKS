/** Model registry. The verifier is Veracite's fine-tuned claim-support cross-encoder (see /ml).
 *  The embedder matches the retrieval used to build the verifier's training contexts (e5-small-v2 + BM25, RRF). */
export const MODELS = {
  // both models are served with the site (public/models): no third-party model server at run time
  embedder: { id: 'e5-small-v2', pooling: 'mean' as const, queryPrefix: 'query: ', passagePrefix: 'passage: ' },
  verifier: { id: 'veracite-verifier', maxLen: 512, labels: ['ACCURATE', 'NOT_ACCURATE', 'NEI'] as const },
};
