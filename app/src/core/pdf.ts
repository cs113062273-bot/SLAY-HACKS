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

// spacing accents as LaTeX/pdf.js emit them → combining marks
// (ASCII "~" and "^" are left alone: standalone, they are usually mathematics)
const COMBINING: Record<string, string> = Object.fromEntries(
  ([['¨', 0x308], ['´', 0x301], ['`', 0x300], ['ˇ', 0x30c], ['˜', 0x303], ['ˆ', 0x302], ['˚', 0x30a], ['¸', 0x327], ['˘', 0x306], ['˝', 0x30b], ['¯', 0x304], ['˙', 0x307]] as [string, number][]).map(([k, c]) => [k, String.fromCharCode(c)]),
);
const ACCENT = new Set(Object.keys(COMBINING));
function compose(mark: string, letter: string): string {
  const c = COMBINING[mark];
  if (!c || !/\p{L}/u.test(letter)) return letter;
  return ((letter === 'ı' ? 'i' : letter === 'ȷ' ? 'j' : letter) + c).normalize('NFC');
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
      const [a, b, c, d, e, f] = it.transform;
      // rotated text (arXiv's vertical side stamp, axis labels) is never body or reference text
      if (Math.abs(b) > Math.abs(a) * 0.05 || Math.abs(c) > Math.abs(d) * 0.05) continue;
      const size = Math.hypot(a, b) || Math.abs(d) || 10;
      items.push({ str: it.str, x: e, y: vp.height - f, w: it.width, size, font: `${it.fontName} ${styles[it.fontName]?.fontFamily ?? ''}` });
    }
    // LaTeX sets accents as separate, raised glyphs ("M" "¨" "uller"): fold each into the letter below it, so the
    // raised glyph cannot start a line of its own and split the name across two lines
    for (const acc of items.filter((it) => ACCENT.has(it.str.trim()))) {
      const mark = acc.str.trim();
      const cx = acc.x + acc.w / 2;
      const base = items.find((b) => b !== acc && b.str && !ACCENT.has(b.str.trim()) && b.y - acc.y > -acc.size * 0.2 && b.y - acc.y < Math.max(b.size, acc.size) * 0.9 && cx >= b.x - b.size * 0.3 && cx <= b.x + b.w + b.size * 0.1);
      acc.str = '';
      if (!base) continue;
      const k = Math.max(0, Math.min(base.str.length - 1, Math.floor(((cx - base.x) / Math.max(1, base.w)) * base.str.length)));
      const i = /\p{L}/u.test(base.str[k] ?? '') ? k : ([k + 1, k - 1].find((j) => /\p{L}/u.test(base.str[j] ?? '')) ?? -1);
      if (i >= 0) base.str = base.str.slice(0, i) + compose(mark, base.str[i]) + base.str.slice(i + 1);
    }
    items.splice(0, items.length, ...items.filter((it) => it.str));
    // group into lines by baseline; superscripts (smaller, slightly raised) attach to their line
    items.sort((i1, i2) => i1.y - i2.y || i1.x - i2.x);
    const groups: Item[][] = [];
    for (const it of items) {
      const g = groups.find((gr) => {
        const ref = gr[0];
        // baseline only: columns are separated afterwards by the gap/gutter split. (A horizontal-proximity test here
        // let a word join the other column's line at nearly the same height, splitting its own line in two.)
        const tol = Math.max(ref.size, it.size) * 0.45;
        return Math.abs(ref.y - it.y) < tol;
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
        const sz = Math.max(prev.size, g[i].size);
        // narrow gutters (ACL two-column: ~17 pt at 10 pt type) are caught by a gap that straddles the page centre
        const mid = vp.width / 2;
        const gutter = gap > sz * 1.0 && prev.x + prev.w <= mid + sz && g[i].x >= mid - sz;
        if (gap > sz * 2.2 || gutter) parts.push([g[i]]);
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
        // accents that arrive inside a string ("W¨olk", "Mart´ınez") are composed with the next letter
        text = text.replace(/(\p{L})\s?([¨´`ˇ˜˚¸˘˝¯˙])\s?(\p{L})/gu, (_, a: string, m: string, b: string) => a + compose(m, b));
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
