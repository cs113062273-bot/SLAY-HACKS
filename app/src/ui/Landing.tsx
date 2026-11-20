import { useRef, useState } from 'react';
import { analyze, saveMode, savedMode, type Mode } from '../engine/session';
import { Brand } from './Brand';
import { SettingsButton } from './Settings';

const SAMPLES = [
  {
    title: 'NeurIPS 2025 preprint with fabricated references',
    note: 'arXiv 2510.21310v1 · 65 references · audited in Badalova & Mayr (2026)',
    run: () => analyze({ kind: 'sample', url: 'https://arxiv.org/pdf/2510.21310v1', name: 'arXiv 2510.21310v1', seed: `${import.meta.env.BASE_URL}samples/neurips.seed.json` }),
  },
  {
    title: 'Attention Is All You Need',
    note: 'arXiv 1706.03762 · 40 references · a clean control',
    run: () => analyze({ kind: 'sample', url: 'https://arxiv.org/pdf/1706.03762', name: 'Attention Is All You Need (arXiv 1706.03762)', seed: `${import.meta.env.BASE_URL}samples/attention.seed.json` }),
  },
  {
    title: 'Reference list with planted errors',
    note: '12 references · real fabrication patterns from NeurIPS 2025',
    run: () => analyze({ kind: 'sample', url: `${import.meta.env.BASE_URL}samples/planted.txt`, name: 'Reference list with planted errors', seed: `${import.meta.env.BASE_URL}samples/planted.seed.json` }),
  },
];

/** Every number: source, version and conditions in the note; reproducible with app/scripts/bench-*.ts and ml/eval_shipped.py (README). */
const BENCH: { name: string; what: string; metric: string; bars: { label: string; v: number; ours?: boolean }[]; note: string }[] = [
  {
    name: 'Reference verification',
    what: '104 manually verified references (33 problematic) on which five published checkers were evaluated.',
    metric: 'F1',
    bars: [
      { label: 'Veracite', v: 0.971, ours: true },
      { label: 'Hallucinator (best of 5)', v: 0.644 },
    ],
    note: 'Badalova & Mayr 2026, Zenodo 10.5281/zenodo.21457492; used during development. Frozen PDF audits: 86/635 (13.5%) and 54/465 (11.6%) references falsely flagged. Later parser fixes need an independent audit.',
  },
  {
    name: 'Hallucinated-citation detection',
    what: 'HALLMARK v1.2 test_public: 825 citations, 14 fabrication types. Historical held-out run.',
    metric: 'F1',
    bars: [
      { label: 'Paid agent cascade', v: 0.986 },
      { label: 'Veracite (no LLM)', v: 0.959, ours: true },
      { label: 'Claude Sonnet 4.6', v: 0.916 },
    ],
    note: 'Reizinger et al. 2026; baselines from the paper. Cascade = bibtex-updater + Claude Sonnet 4.6 agent. OpenAlex quota ran out during our run.',
  },
  {
    name: 'Claim support',
    what: 'Citation-Integrity test split: does the cited abstract support the citing sentence? Model chosen on dev.',
    metric: 'Macro-F1',
    bars: [
      { label: 'MultiVerS (GPU)', v: 0.52 },
      { label: 'Veracite (in-browser)', v: 0.486, ours: true },
      { label: 'GPT-4, in-context', v: 0.45 },
    ],
    note: 'Sarol et al. 2024; baselines from the paper. Veracite: 102 MB 4-bit model, top-5 retrieved evidence. Weakest on subtle misrepresentation. A withdrawn retrained variant was also scored on this split (.456).',
  },
];

/** Deep links: #sample-planted, #sample-neurips, #sample-attention, #arxiv-2510.21310v1 */
export function runFromHash(): boolean {
  const h = location.hash.slice(1);
  const s = { 'sample-neurips': 0, 'sample-attention': 1, 'sample-planted': 2 }[h];
  if (s !== undefined) {
    SAMPLES[s].run();
    return true;
  }
  const ax = h.match(/^arxiv-(\d{4}\.\d{4,5}(?:v\d+)?)$/);
  if (ax) {
    analyze({ kind: 'arxiv', id: ax[1] });
    return true;
  }
  return false;
}

export function Landing() {
  const [over, setOver] = useState(false);
  const [text, setText] = useState('');
  const [arxiv, setArxiv] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [mode, setModeState] = useState<Mode>(savedMode);
  const pickMode = (m: Mode) => {
    saveMode(m);
    setModeState(m);
  };

  const onFiles = (fs: FileList | null) => {
    const f = fs?.[0];
    if (f) analyze({ kind: 'file', file: f });
  };

  return (
    <div className="landing">
      <header className="topbar">
        <Brand />
        <div className="spacer" />
        <SettingsButton />
      </header>
      <main>
        <section className="hero">
          <div>
            <div className="eyebrow">Citation integrity audit</div>
            <h1 style={{ marginTop: 12 }}>
              Every reference, <em>checked against the record</em>.
            </h1>
            <p className="lede">
              Veracite reads a paper's reference list and its citing sentences. It confirms each source exists as cited, catches fabricated and misattributed references, and tests whether the cited work actually supports the claim. It all runs in your browser.
            </p>
            <div className="proof">
              <div>
                <div className="big">1 in 277</div>
                <div className="lbl">PubMed Central papers in early 2026 cited at least one fabricated reference</div>
              </div>
              <div>
                <div className="big">100</div>
                <div className="lbl">fabricated citations passed peer review into NeurIPS 2025 papers</div>
              </div>
              <div>
                <div className="big">39%</div>
                <div className="lbl">of citations in an annotated biomedical corpus had accuracy errors</div>
              </div>
            </div>
            <figure className="specimen">
              <figcaption>
                <span className="chip v-id_mismatch">Wrong identifier</span>
                <span className="eyebrow">From a paper accepted at NeurIPS 2025</span>
              </figcaption>
              <p className="cite">Alex Wang, Rishi Bommasani, Dan Hendrycks, Daniel Song, and Zhilin Zhang. Efficient few-shot learning with EFL: A single transformer for all tasks. <mark>arXiv:2107.13586</mark>, 2021.</p>
              <div className="resolves">
                <span className="mono">arXiv:2107.13586</span> resolves to
                <b className="cite">Pre-train, Prompt, and Predict: A Systematic Survey of Prompting Methods in Natural Language Processing</b>
                <small>Liu, Yuan, Fu, Jiang, Hayashi, Neubig · 2021. No author or title in common with the citation.</small>
              </div>
            </figure>
          </div>
          <div className="intake">
            <div className="mode" role="radiogroup" aria-label="Audit depth">
              {(
                [
                  ['full', 'Full audit', 'References and claim support. Downloads 136 MB of models once.'],
                  ['quick', 'Quick check', 'References only, fastest. Claim support stays one click away.'],
                ] as const
              ).map(([m, label, help]) => (
                <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => pickMode(m)}>
                  <b>{label}</b>
                  <small>{help}</small>
                </button>
              ))}
            </div>
            <div
              className={`drop${over ? ' over' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => file.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && file.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                onFiles(e.dataTransfer.files);
              }}
            >
              <strong>Drop a paper to audit</strong>
              <span>PDF, Word (.docx), BibTeX (.bib) or plain text. The file stays on your device.</span>
              <input ref={file} id="file-input" type="file" accept=".pdf,.docx,.bib,.txt,.md,application/pdf" hidden onChange={(e) => onFiles(e.target.files)} />
            </div>
            <div className="intake-row">
              <input id="arxiv-input" placeholder="arXiv ID or URL, e.g. 2510.21310" value={arxiv} onChange={(e) => setArxiv(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && arxiv.trim() && analyze({ kind: 'text', text: arxiv })} />
              <button className="btn" disabled={!arxiv.trim()} onClick={() => analyze({ kind: 'text', text: arxiv })}>
                Fetch &amp; audit
              </button>
            </div>
            <textarea id="paste-input" placeholder="…or paste a reference list, a BibTeX file, or a whole paper with its References section." value={text} onChange={(e) => setText(e.target.value)} />
            <div className="intake-row">
              <div style={{ flex: 1 }} />
              <button className="btn primary" disabled={!text.trim()} onClick={() => analyze({ kind: 'text', text })}>
                Audit pasted text
              </button>
            </div>
            <div className="samples">
              <div className="eyebrow">Try a sample</div>
              {SAMPLES.map((s) => (
                <button key={s.title} className="sample" onClick={s.run}>
                  <b>{s.title}</b>
                  <small>{s.note}</small>
                  <span className="go">Run →</span>
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="how">
          <div>
            <div className="eyebrow">Read</div>
            <h3>Layout-aware parsing</h3>
            <p>Splits two-column PDFs, isolates the reference section and links every in-text marker, numeric or author–year, to its entry.</p>
          </div>
          <div>
            <div className="eyebrow">Resolve</div>
            <h3>Five scholarly indexes</h3>
            <p>Crossref, OpenAlex, Semantic Scholar, DataCite and Europe PMC, plus GitHub and Hugging Face for software and models.</p>
          </div>
          <div>
            <div className="eyebrow">Cross-verify</div>
            <h3>Field by field</h3>
            <p>Title, every author, year, venue and identifier must point to the same record. That is what catches hijacked DOIs and swapped authors.</p>
          </div>
          <div>
            <div className="eyebrow">Ground</div>
            <h3>Claim support</h3>
            <p>A fine-tuned verifier reads the cited abstract or open-access full text and shows the sentence that backs, or fails to back, each claim.</p>
          </div>
        </section>
        <section className="bench">
          <div className="eyebrow">Measured on public benchmarks</div>
          <div className="bench-grid">
            {BENCH.map((b) => (
              <div key={b.name} className="bench-row">
                <div className="bench-name">
                  <b>{b.name}</b>
                  <small>{b.what}</small>
                </div>
                <div className="bench-bars" role="img" aria-label={`${b.metric}: ${b.bars.map((x) => `${x.label} ${x.v.toFixed(3)}`).join(', ')}`}>
                  {b.bars.map((x) => (
                    <div key={x.label} className="bench-bar">
                      <span>{x.label}</span>
                      <i style={{ width: `${x.v * 100}%` }} className={x.ours ? 'ours' : undefined} />
                      <em className="num">{x.v.toFixed(2)}</em>
                    </div>
                  ))}
                  <small className="bench-note">{b.note}</small>
                </div>
                <div className="bench-metric">{b.metric}</div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="footer">
        <span>Runs locally. Only reference strings are sent to public scholarly indexes.</span>
        <span>Results are evidence for review, not a final ruling.</span>
      </footer>
    </div>
  );
}
