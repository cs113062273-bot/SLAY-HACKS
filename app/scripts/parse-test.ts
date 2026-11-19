import { parseReference } from '../src/core/parse';
import { loadBench } from './bench-data';
const rows = loadBench().map((r) => ({ document_id: r.doc, reference_number: r.num, reference: r.reference }));
for (const r of rows) {
  const p = parseReference(r.reference);
  console.log(`${r.document_id} ${r.reference_number} [${p.kind}] y=${p.year} etal=${p.etAl} ph=${p.placeholders.join('|')}\n   T: ${p.title}\n   A: ${p.authors.map((a) => a.family).join('; ')}\n   V: ${p.venue ?? ''} | doi=${p.dois.join(',')} arx=${p.arxivIds.join(',')}`);
}
