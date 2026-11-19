/*! Based on coi-serviceworker v0.1.7, Guido Zuidhof and contributors, MIT.
 *  Adds COOP/COEP headers on static hosts (e.g. GitHub Pages) so the page is cross-origin isolated and
 *  ONNX Runtime Web can run multi-threaded WASM. Only the page document and worker scripts are rewritten;
 *  every other request (models, APIs, PDFs) passes through untouched. */
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (event) => {
    const r = event.request;
    if (r.mode !== 'navigate' && r.destination !== 'worker' && r.destination !== 'sharedworker') return;
    event.respondWith(
      fetch(r).then((res) => {
        if (res.status === 0) return res;
        const headers = new Headers(res.headers);
        headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }),
    );
  });
} else {
  (() => {
    if (window.crossOriginIsolated || !window.isSecureContext || !navigator.serviceWorker) return;
    const reloaded = sessionStorage.getItem('coiReloaded');
    navigator.serviceWorker.register(document.currentScript.src).then(
      (reg) => {
        reg.addEventListener('updatefound', () => {
          if (!reloaded) {
            sessionStorage.setItem('coiReloaded', '1');
            location.reload();
          }
        });
        if (reg.active && !navigator.serviceWorker.controller && !reloaded) {
          sessionStorage.setItem('coiReloaded', '1');
          location.reload();
        }
      },
      () => {
        /* isolation is an optimization; the app works without it */
      },
    );
  })();
}
