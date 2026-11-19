/** PDF → positioned lines using pdf.js. Works in the browser (worker) and in Node (legacy build). */
import type { Line } from './doc';

type PdfJs = typeof import('pdfjs-dist');

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
  font: string;
}

export async function pdfToLines(pdfjs: PdfJs, data: ArrayBuffer | Uint8Array, onProgress?: (p: number) => void): Promise<{ lines: Line[]; pageWidths: Map<number, number>; numPages: number }> {
  const doc = await pdfjs.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data), useSystemFonts: false, verbosity: 0 } as any).promise;
  const lines: Line[] = [];
  const pageWidths = new Map<number, number>();
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    pageWidths.set(p, vp.width);
    const tc = await page.getTextContent();
    const styles = tc.styles as Record<string, { fontFamily?: string }>;
    const items: Item[] = [];
    for (const it of tc.items as any[]) {
      if (!('str' in it) || !it.str) continue;
      const [a, b, , d, e, f] = it.transform;
      const size = Math.hypot(a, b) || Math.abs(d) || 10;
      items.push({ str: it.str, x: e, y: vp.height - f, w: it.width, size, font: `${it.fontName} ${styles[it.fontName]?.fontFamily ?? ''}` });
    }
    // group into lines by baseline; superscripts (smaller, slightly raised) attach to their line
    items.sort((i1, i2) => i1.y - i2.y || i1.x - i2.x);
    const groups: Item[][] = [];
    for (const it of items) {
      const g = groups.find((gr) => {
        const ref = gr[0];
        const tol = Math.max(ref.size, it.size) * 0.45;
        const overlapX = gr.some((o) => it.x < o.x + o.w + ref.size * 25 && it.x + it.w > o.x - ref.size * 25);
        return Math.abs(ref.y - it.y) < tol && overlapX;
      });
      if (g) g.push(it);
      else groups.push([it]);
    }
    for (const g of groups) {
      g.sort((i1, i2) => i1.x - i2.x);
      // split a group if there is a big horizontal gap (two columns on the same baseline)
      const parts: Item[][] = [[g[0]]];
      for (let i = 1; i < g.length; i++) {
        const prev = g[i - 1];
        const gap = g[i].x - (prev.x + prev.w);
        if (gap > Math.max(prev.size, g[i].size) * 2.2) parts.push([g[i]]);
        else parts[parts.length - 1].push(g[i]);
      }
      for (const part of parts) {
        let text = '';
        let lastEnd = -Infinity;
        const sizes: number[] = [];
        for (const it of part) {
          const gap = it.x - lastEnd;
          if (text && gap > it.size * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
          text += it.str;
          lastEnd = it.x + it.w;
          sizes.push(it.size);
        }
        text = text.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const main = part.reduce((m, it) => (it.str.length > m.str.length ? it : m), part[0]);
        lines.push({
          text,
          page: p,
          x: part[0].x,
          y: Math.max(...part.map((it) => (it.size >= main.size * 0.85 ? it.y : -Infinity))),
          w: lastEnd - part[0].x,
          size: main.size,
          bold: /bold|black|heavy|semibold|\.B\b|-B\b|CMBX/i.test(main.font),
        });
      }
    }
    onProgress?.(p / doc.numPages);
    page.cleanup();
  }
  const n = doc.numPages;
  await (doc as any).cleanup?.();
  return { lines, pageWidths, numPages: n };
}
