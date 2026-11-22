import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldCheck, RefResult, Verdict } from '../core/types';
import { titleSim } from '../core/text';
import { formatReference, kindLabel, sourceLabel, toBibtex } from '../core/verify';
import { getState, reset, retryUnchecked, runClaimAudit, useSession, type ClaimCheck } from '../engine/session';
import { Brand } from './Brand';
import { correctedBibtex, download, jsonReport, markdownReport } from './exporters';
import { SUPPORT, VERDICT, VERDICT_ORDER, isProblem, shortLabel } from './labels';

type Sel = { kind: 'ref'; i: number } | { kind: 'claim'; i: number } | null;

export function Report() {
  const doc = useSession((s) => s.doc);
  const results = useSession((s) => s.results);
  const claims = useSession((s) => s.claims);
  const phase = useSession((s) => s.phase);
  const replayed = useSession((s) => s.replayed);
  const [tab, setTab] = useState<'refs' | 'claims'>('refs');
  const [filter, setFilter] = useState<Verdict | 'problems' | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Sel>(null);
  const [toast, setToast] = useState<string | null>(null);

  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1800);
  };

  const refRows = useMemo(() => {
    if (!doc) return [];
    const ql = q.toLowerCase();
    return doc.references
      .map((p, i) => ({ p, i, r: results[i] }))
      .filter(({ p, r }) => {
        if (ql && !p.raw.toLowerCase().includes(ql)) return false;
        if (!filter) return true;
        if (!r) return false;
        if (filter === 'problems') return isProblem(r.verdict);
        return r.verdict === filter;
      })
      .sort((a, b) => (filter === 'problems' ? VERDICT_ORDER.indexOf(a.r!.verdict) - VERDICT_ORDER.indexOf(b.r!.verdict) || a.i - b.i : a.i - b.i));
  }, [doc, results, filter, q]);

  const claimPhase = useSession((s) => s.claimPhase);
  const claimRows = useMemo(() => {
    const ql = q.toLowerCase();
    const rows = claims.map((c, i) => ({ c, i })).filter(({ c }) => !ql || doc!.citances[c.citanceId].claim.toLowerCase().includes(ql));
    // once all claims are checked, list what needs action first (rows stay in document order while checks stream in)
    if (claimPhase !== 'done') return rows;
    const rank = (c: ClaimCheck) => (c.label ? { review: 0, supported: 1, unclear: 2, mention: 4 }[c.label] : c.status === 'no_source' ? 3 : 2);
    return rows.sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i);
  }, [claims, q, doc, claimPhase]);

  // select the first problem automatically once results arrive
  useEffect(() => {
    if (sel || !results.some(Boolean)) return;
    const first = results.findIndex((r) => r && isProblem(r.verdict));
    if (first >= 0) setSel({ kind: 'ref', i: first });
    // a clean paper: open the first reference so the evidence view is never empty
    else if (results.length && results.every(Boolean)) setSel({ kind: 'ref', i: 0 });
  }, [results, sel]);

  // keyboard navigation
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'j' && e.key !== 'k') return;
      e.preventDefault();
      const dir = e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1;
      if (tab === 'refs') {
        const pos = refRows.findIndex((x) => sel?.kind === 'ref' && x.i === sel.i);
        const nx = refRows[Math.max(0, Math.min(refRows.length - 1, pos + dir))];
        if (nx) setSel({ kind: 'ref', i: nx.i });
      } else {
        const pos = claimRows.findIndex((x) => sel?.kind === 'claim' && x.i === sel.i);
        const nx = claimRows[Math.max(0, Math.min(claimRows.length - 1, pos + dir))];
        if (nx) setSel({ kind: 'claim', i: nx.i });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, refRows, claimRows, sel]);
  useEffect(() => {
    listRef.current?.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!doc) return null;
  const done = results.filter(Boolean).length;
  // the paper's own title when it was extracted cleanly, otherwise the file name / arXiv ID
  const inputName = getState().inputName ?? '';
  const heading = doc.title && doc.title.length >= 8 && doc.title.length <= 220 && !/^arxiv:|^\d+$/i.test(doc.title) ? doc.title : inputName;

  return (
    <div className="report">
      <header className="topbar">
        <Brand />
        <div className="docname">
          <b title={heading}>{heading}</b>
          <small title={replayed ? `Sample: scholarly-index responses are replayed from a ${replayed} snapshot so the demo is fast and reproducible; parsing, matching, verification and the claim model all run live in this browser.` : undefined}>
            {replayed ? `Sample, index responses replayed from a ${replayed} snapshot · ` : ''}
            {heading !== inputName && inputName && !inputName.toLowerCase().includes(heading.toLowerCase().slice(0, 20)) ? `${inputName} · ` : ''}
            {doc.stats.pages ? `${doc.stats.pages} pages · ` : ''}
            {doc.references.length} references · {doc.citances.length} citing sentences
            {doc.style !== 'unknown' ? ` · ${doc.style} citations` : ''}
          </small>
        </div>
        <div className="spacer" />
        <SourceStatus />
        <ExportMenu onDone={say} disabled={phase !== 'done'} />
        <button className="btn" onClick={reset}>
          New audit
        </button>
      </header>
      <Ledger filter={filter} setFilter={(f) => { setFilter(f); setTab('refs'); }} openClaims={() => setTab('claims')} />
      <div className="work">
        <div className="docket">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'refs'} className={tab === 'refs' ? 'on' : ''} onClick={() => setTab('refs')}>
              References<span className="count num">{done < doc.references.length ? `${done}/${doc.references.length}` : doc.references.length}</span>
            </button>
            <button role="tab" aria-selected={tab === 'claims'} className={tab === 'claims' ? 'on' : ''} onClick={() => setTab('claims')}>
              Claims<span className="count num">{claims.length || ''}</span>
            </button>
            <input id="list-search" className="search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="list" ref={listRef}>
            {tab === 'refs' &&
              refRows.map(({ p, i, r }) => {
                const v = r?.verdict ?? 'pending';
                return (
                  <button key={i} className={`row${sel?.kind === 'ref' && sel.i === i ? ' sel' : ''}`} onClick={() => setSel({ kind: 'ref', i })}>
                    <span className={`stripe stripe-${v}`} />
                    <span className="idx">{shortLabel(p.label, i)}</span>
                    <span className="t">
                      <b>{p.title ?? p.raw}</b>
                      <small>{r && r.issues[0] && isProblem(r.verdict) ? <span className="why">{r.issues[0]}</span> : [p.authors.slice(0, 3).map((a) => a.family).join(', ') + (p.authors.length > 3 || p.etAl ? ' et al.' : ''), p.year].filter(Boolean).join(' · ')}</small>
                    </span>
                    {r ? <span className={`chip v-${v}`}>{VERDICT[v].short}</span> : <span className="skeleton" />}
                  </button>
                );
              })}
            {tab === 'refs' && refRows.length === 0 && <div className="detail"><p className="empty">No references match this filter.</p></div>}
            {tab === 'claims' && <ClaimList rows={claimRows} sel={sel} setSel={setSel} />}
          </div>
        </div>
        <div className="detail">{sel?.kind === 'ref' ? <RefDetail i={sel.i} onToast={say} openClaim={(ci) => { setTab('claims'); setSel({ kind: 'claim', i: ci }); }} /> : sel?.kind === 'claim' ? <ClaimDetail i={sel.i} openRef={(ri) => { setTab('refs'); setSel({ kind: 'ref', i: ri }); }} /> : <p className="empty">Select a reference to see the evidence.</p>}</div>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* ------------------------------ ledger ------------------------------ */

function Ledger({ filter, setFilter, openClaims }: { filter: Verdict | 'problems' | null; setFilter: (f: Verdict | 'problems' | null) => void; openClaims: () => void }) {
  const doc = useSession((s) => s.doc)!;
  const results = useSession((s) => s.results);
  const phase = useSession((s) => s.phase);
  const claims = useSession((s) => s.claims);
  const claimPhase = useSession((s) => s.claimPhase);
  const modelProgress = useSession((s) => s.modelProgress);
  const mode = useSession((s) => s.mode);
  const throttled = useSession((s) => (s.sourceStatus.semanticscholar?.limited ?? 0) >= 6);
  const rs = results.filter((r): r is RefResult => !!r);
  const counts = new Map<Verdict, number>();
  for (const r of rs) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
  const checkable = rs.filter((r) => r.verdict !== 'unverifiable' && r.verdict !== 'unchecked').length;
  const unchecked = counts.get('unchecked') ?? 0;
  const good = (counts.get('verified') ?? 0) + (counts.get('verified_minor') ?? 0);
  const problems = rs.filter((r) => isProblem(r.verdict)).length;
  const total = doc.references.length;
  const pct = checkable ? Math.round((good / checkable) * 100) : 0;

  const cDone = claims.filter((c) => c.status === 'done' && c.label);
  const sc = new Map<string, number>();
  for (const c of cDone) sc.set(c.label!, (sc.get(c.label!) ?? 0) + 1);
  const noSrc = claims.filter((c) => c.status === 'no_source').length;
  const claimOrder: (keyof typeof SUPPORT)[] = ['supported', 'review', 'unclear', 'mention'];
  const sColor: Record<string, string> = { supported: 'var(--ok)', review: 'var(--warn)', unclear: 'var(--rule-2)', mention: 'var(--wash)' };

  return (
    <div className="ledger">
      <section>
        <div className="eyebrow">Reference integrity</div>
        <div className="score">
          <span className="val">{rs.length ? `${pct}%` : '–'}</span>
          <span className="of num">
            {good}/{checkable} verified
          </span>
        </div>
        {phase !== 'checking' && problems > 0 ? (
          <p>
            <button className={`linkbtn${filter === 'problems' ? ' on' : ''}`} onClick={() => setFilter(filter === 'problems' ? null : 'problems')} title="Show only these references">
              {problems} reference{problems > 1 ? 's' : ''} need{problems > 1 ? '' : 's'} attention
            </button>
            {filter === 'problems' ? ' (shown below)' : ''}
          </p>
        ) : (
          <p>{phase === 'checking' ? `Checking ${rs.length + 1} of ${total}…` : 'No problems found.'}</p>
        )}
        {phase === 'checking' && throttled && <p className="hint">Semantic Scholar is throttling anonymous lookups. A free key in Settings makes this faster.</p>}
        {phase === 'done' && unchecked > 0 && (
          <button className="btn" style={{ marginTop: 10, height: 28 }} onClick={() => retryUnchecked()}>
            Retry {unchecked} not checked
          </button>
        )}
        {phase === 'checking' && (
          <div className="progress">
            <i style={{ width: `${(rs.length / total) * 100}%` }} />
          </div>
        )}
      </section>
      <section>
        <div className="eyebrow">By verdict</div>
        <div className="bar" aria-hidden="true">
          {VERDICT_ORDER.filter((v) => v !== 'pending').map((v) => {
            const n = counts.get(v as Verdict) ?? 0;
            return n ? <i key={v} style={{ width: `${(n / total) * 100}%`, background: VERDICT[v].color }} /> : null;
          })}
        </div>
        <div className="legend">
          {VERDICT_ORDER.filter((v) => v !== 'pending' && counts.get(v as Verdict)).map((v) => (
            <button key={v} className={filter === v ? 'on' : ''} title={VERDICT[v].help} onClick={() => setFilter(filter === v ? null : (v as Verdict))}>
              <span className={`chip v-${v}`}>{VERDICT[v].label}</span>
              <span className="n">{counts.get(v as Verdict)}</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <div className="eyebrow">Claim support</div>
        {claimPhase === 'idle' && !doc.citances.length && <p>No citing sentences found (reference list only), so there are no claims to check.</p>}
        {claimPhase === 'idle' && doc.citances.length > 0 && mode === 'full' && (
          <p>{phase === 'checking' ? `Starts when references are resolved. Preparing the verifier in the background${modelProgress ? ` (${Math.round(modelProgress * 100)}%)` : '…'}` : 'Starting…'}</p>
        )}
        {claimPhase === 'idle' && doc.citances.length > 0 && mode === 'quick' && (
          <div className="claim-offer">
            <p>
              Quick check: references only. {doc.citances.length} citing sentence{doc.citances.length > 1 ? 's' : ''} can also be tested against the text of the works they cite.
            </p>
            <button className="btn primary" disabled={phase !== 'done'} onClick={() => runClaimAudit()} title={phase !== 'done' ? 'Available when the reference check finishes' : undefined}>
              Check claim support
            </button>
            <small>Runs on this device. Downloads a 136 MB verifier the first time, cached afterwards.</small>
          </div>
        )}
        {claimPhase === 'loading-model' && (
          <>
            <p>Loading the verifier into your browser, about 136 MB the first time and cached afterwards{modelProgress ? ` (${Math.round(modelProgress * 100)}%)` : '…'}</p>
            <div className="progress">
              <i style={{ width: `${modelProgress * 100}%` }} />
            </div>
          </>
        )}
        {claimPhase === 'done' && !claims.length && <p>{doc.citances.length ? 'No checkable claims: claims are checked only against references that were matched to a published record, and only when the citing sentence makes a statement.' : 'No citing sentences found (reference list only), so there are no claims to check.'}</p>}
        {(claimPhase === 'running' || (claimPhase === 'done' && claims.length > 0) || claimPhase === 'unavailable') && (
          <>
            <div className="bar" aria-hidden="true">
              {claimOrder.map((k) => (sc.get(k) ? <i key={k} style={{ width: `${((sc.get(k) ?? 0) / Math.max(1, claims.length)) * 100}%`, background: sColor[k] }} /> : null))}
            </div>
            <div className="legend">
              {claimOrder
                .filter((k) => sc.get(k))
                .map((k) => (
                  <button key={k} onClick={openClaims} title={SUPPORT[k].help}>
                    <span className={`chip s-${k}`}>{SUPPORT[k].label}</span>
                    <span className="n">{sc.get(k)}</span>
                  </button>
                ))}
              {noSrc > 0 && (
                <button onClick={openClaims} title={SUPPORT.none.help}>
                  <span className="chip s-none">No source text</span>
                  <span className="n">{noSrc}</span>
                </button>
              )}
            </div>
            {claimPhase === 'running' && <p>Checked {claims.filter((c) => c.status === 'done' || c.status === 'no_source').length} of {claims.length} claims…</p>}
            {claimPhase === 'unavailable' &&
              (claims.length ? (
                <p>The verifier model could not load (offline, or blocked by this browser). Retrieved evidence is still shown for each claim.</p>
              ) : (
                <p>Claim checks could not start (the connection dropped, or this browser blocked them). The reference results are complete.</p>
              ))}
          </>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ claims list ------------------------------ */

function ClaimList({ rows, sel, setSel }: { rows: { c: ClaimCheck; i: number }[]; sel: Sel; setSel: (s: Sel) => void }) {
  const doc = useSession((s) => s.doc)!;
  const mode = useSession((s) => s.mode);
  const claimPhase = useSession((s) => s.claimPhase);
  const phase = useSession((s) => s.phase);
  if (!rows.length) {
    if (doc.citances.length && mode === 'quick' && claimPhase === 'idle')
      return (
        <div className="detail">
          <p className="empty">This was a quick check of the references only.</p>
          <p className="empty" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={phase !== 'done'} onClick={() => runClaimAudit()}>
              Check claim support
            </button>
          </p>
        </div>
      );
    return <div className="detail"><p className="empty">{!doc.citances.length ? 'This input has no body text, so there are no claims to check.' : claimPhase === 'done' ? 'No checkable claims were found.' : 'Claims are checked after references are resolved.'}</p></div>;
  }
  return (
    <>
      {rows.map(({ c, i }) => {
        const ci = doc.citances[c.citanceId];
        const lab = c.label ?? (c.status === 'no_source' ? 'none' : null);
        const stripe = lab === 'supported' ? 'verified' : lab === 'review' ? 'metadata_error' : 'pending';
        return (
          <button key={i} className={`row${sel?.kind === 'claim' && sel.i === i ? ' sel' : ''}`} onClick={() => setSel({ kind: 'claim', i })}>
            <span className={`stripe stripe-${stripe}`} />
            <span className="idx">{shortLabel(doc.references[c.refIndex].label, c.refIndex)}</span>
            <span className="t">
              <b className="cite" style={{ fontWeight: 400 }}>{ci.claim}</b>
              <small>{c.note ? c.note : c.sourceKind ? `Checked against ${c.sourceKind}` : c.status === 'queued' ? 'Queued' : ''}</small>
            </span>
            {lab ? <span className={`chip s-${lab}`}>{SUPPORT[lab].label}</span> : <span className="skeleton" />}
          </button>
        );
      })}
    </>
  );
}

/* ------------------------------ reference detail ------------------------------ */

const FIELD_NAME: Record<FieldCheck['field'], string> = { title: 'Title', authors: 'Authors', year: 'Year', venue: 'Venue', identifier: 'Identifier', pages: 'Vol. / pages' };

function StatusIcon({ s }: { s: FieldCheck['status'] }) {
  if (s === 'match') return <span className="ok" aria-label="matches">✓</span>;
  if (s === 'minor') return <span className="warn" aria-label="minor difference">≈</span>;
  if (s === 'mismatch' || s === 'missing') return <span className="bad" aria-label="mismatch">✕</span>;
  return <span aria-label="not compared">–</span>;
}

function RefDetail({ i, onToast, openClaim }: { i: number; onToast: (m: string) => void; openClaim: (ci: number) => void }) {
  const doc = useSession((s) => s.doc)!;
  const r = useSession((s) => s.results[i]);
  const claims = useSession((s) => s.claims);
  const p = doc.references[i];
  const myClaims = claims.map((c, ci) => ({ c, ci })).filter(({ c }) => c.refIndex === i);
  const citing = doc.citances.filter((c) => c.refIndices.includes(i));

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast(`${what} copied`);
    } catch {
      onToast('Copy failed; select the text instead');
    }
  };

  if (!r)
    return (
      <>
        <div className="dhead">
          <span className="ref-no">[{shortLabel(p.label, i)}]</span>
          <span className="skeleton" />
        </div>
        <p className="citetext">{p.raw}</p>
        <p className="empty">Searching the indexes…</p>
      </>
    );
  const v = VERDICT[r.verdict];
  // A wrong-identifier or missing reference can carry a loosely similar record; showing it as the match
  // (with Copy BibTeX) would read as the correction. Only show it when it really is the cited work.
  const showMatch = !!r.match && (!['id_mismatch', 'fabricated', 'not_found'].includes(r.verdict) || !p.title || titleSim(p.title, r.match.title) >= 0.85);
  const tone =r.verdict === 'verified' ? 'ok' : r.verdict === 'verified_minor' || r.verdict === 'unverifiable' ? 'muted' : r.verdict === 'metadata_error' ? 'warn' : 'bad';
  return (
    <>
      <div className="dhead">
        <span className="ref-no">[{shortLabel(p.label, i)}]</span>
        <span className={`chip v-${r.verdict}`}>{v.label}</span>
        <span className="eyebrow" style={{ marginLeft: 4 }}>{kindLabel(p.kind)}</span>
        {doc.refPages?.[i] ? <span className="eyebrow" title="Where this entry starts in the PDF">PDF p. {doc.refPages[i]}</span> : null}
        <span className="conf num">confidence the reference is accurate: {Math.round(r.confidence * 100)}%</span>
      </div>
      <p className="citetext">{p.raw}</p>
      <div className={`callout ${tone}`}>
        {r.issues.length ? (
          <ul>
            {r.issues.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : (
          v.help
        )}
      </div>

      {r.checks.length > 0 && (
        <table className="diff">
          <thead>
            <tr>
              <th>Field</th>
              <th />
              <th>As cited</th>
              <th>Published record</th>
            </tr>
          </thead>
          <tbody>
            {r.checks.map((c, k) => (
              <tr key={k}>
                <td>{FIELD_NAME[c.field]}</td>
                <td className="st">
                  <StatusIcon s={c.status} />
                </td>
                <td className={c.field === 'title' ? 'cite' : c.field === 'identifier' ? 'mono' : ''}>{c.cited || '—'}</td>
                <td className={c.field === 'title' ? 'cite' : c.field === 'identifier' ? 'mono' : ''}>
                  {c.found || '—'}
                  {c.note && <span className="note">{c.note}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showMatch && r.match && (
        <>
          <div className="section-h">
            <h3>Matched record</h3>
            <small>{sourceLabel(r.match.source)}</small>
          </div>
          <p className="cite" style={{ margin: 0, fontSize: 15 }}>
            {formatReference(r.match)}
          </p>
          <div className="fix-actions">
            {r.match.doi && (
              <a className="btn" href={`https://doi.org/${r.match.doi}`} target="_blank" rel="noreferrer">
                Open DOI
              </a>
            )}
            {r.match.arxivId && (
              <a className="btn" href={`https://arxiv.org/abs/${r.match.arxivId}`} target="_blank" rel="noreferrer">
                Open arXiv
              </a>
            )}
            {r.match.url && !r.match.doi && !r.match.arxivId && (
              <a className="btn" href={r.match.url} target="_blank" rel="noreferrer">
                Open record
              </a>
            )}
            <button className="btn" onClick={() => copy(toBibtex(r.match!), 'BibTeX')}>
              Copy BibTeX
            </button>
          </div>
        </>
      )}

      {r.suggestedFix && (
        <>
          <div className="section-h">
            <h3>Suggested correction</h3>
            <small>built from the published record</small>
          </div>
          <pre className="fix">{r.suggestedFix}</pre>
          <div className="fix-actions">
            <button className="btn" onClick={() => copy(r.suggestedFix!, 'Correction')}>
              Copy correction
            </button>
          </div>
        </>
      )}

      {citing.length > 0 && (
        <>
          <div className="section-h">
            <h3>Cited in the text</h3>
            <small>
              {citing.length} sentence{citing.length > 1 ? 's' : ''}
            </small>
          </div>
          {citing.map((c) => {
            const cc = myClaims.find((x) => doc.citances[x.c.citanceId].id === c.id);
            return <ClaimCard key={c.id} claim={c.sentence} marker={c.marker} check={cc?.c} onOpen={cc ? () => openClaim(cc.ci) : undefined} />;
          })}
        </>
      )}

      {r.candidates.length > 0 && !r.match && (
        <>
          <div className="section-h">
            <h3>Nearest records found</h3>
            <small>none matched closely enough</small>
          </div>
          {r.candidates.slice(0, 3).map((c, k) => (
            <p key={k} className="cite" style={{ margin: '0 0 8px', color: 'var(--ink-2)' }}>
              {formatReference(c)} <span className="eyebrow">{sourceLabel(c.source)}</span>
            </p>
          ))}
        </>
      )}

      <div className="section-h">
        <h3>Sources consulted</h3>
      </div>
      <div className="sources">
        {r.sourcesQueried.map((s) => (
          <span key={s} className={r.sourcesFailed.includes(s) ? 'failed' : ''} title={r.sourcesFailed.includes(s) ? 'Did not respond' : 'Answered'}>
            {sourceLabel(s)}
            {r.sourcesFailed.includes(s) ? ' (no response)' : ''}
          </span>
        ))}
      </div>
    </>
  );
}

/* ------------------------------ claims ------------------------------ */

function highlight(sentence: string, marker: string) {
  const k = sentence.indexOf(marker);
  if (k < 0) return sentence;
  return (
    <>
      {sentence.slice(0, k)}
      <mark>{marker}</mark>
      {sentence.slice(k + marker.length)}
    </>
  );
}

function Gauge({ probs }: { probs?: Record<string, number> }) {
  if (!probs) return null;
  return (
    <span className="gauge" title={`model scores: supported ${Math.round(probs.ACCURATE * 100)}% · not substantiated ${Math.round(probs.NOT_ACCURATE * 100)}% · unrelated ${Math.round(probs.NEI * 100)}%`}>
      <i style={{ width: `${probs.ACCURATE * 100}%`, background: 'var(--ok)' }} />
      <i style={{ width: `${probs.NOT_ACCURATE * 100}%`, background: 'var(--warn)' }} />
      <i style={{ width: `${probs.NEI * 100}%`, background: 'var(--bad)' }} />
    </span>
  );
}

function ClaimCard({ claim, marker, check, onOpen }: { claim: string; marker: string; check?: ClaimCheck; onOpen?: () => void }) {
  const lab = check?.label ?? (check?.status === 'no_source' ? 'none' : null);
  return (
    <div className="claim">
      <div className="meta">
        {lab ? <span className={`chip s-${lab}`}>{SUPPORT[lab].label}</span> : check ? <span className="skeleton" /> : <span className="chip s-none">Not checked</span>}
        {check?.sourceKind && <span>against the {check.sourceKind}</span>}
        <span className="gauge-wrap" style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Gauge probs={check?.probs} />
          {onOpen && (
            <button className="btn ghost" style={{ height: 24, padding: '0 6px' }} onClick={onOpen}>
              Evidence →
            </button>
          )}
        </span>
      </div>
      <p className="q">{highlight(claim, marker)}</p>
    </div>
  );
}

const SHARE_STOP = new Set('this that these those with from have been were which their there about into than then when where while also such using used based both more most other some very between within across over under after before among each'.split(' '));

/** Underline the content words a passage shares with the claim (why it was retrieved). */
function markShared(text: string, claim: string) {
  const stem = (w: string) => w.toLowerCase().replace(/(ing|ed|es|s)$/, '');
  const claimWords = new Set((claim.match(/[\p{L}\d][\p{L}\d-]{3,}/gu) ?? []).map(stem).filter((w) => !SHARE_STOP.has(w)));
  const parts = text.split(/([\p{L}\d][\p{L}\d-]{3,})/u);
  return parts.map((p, j) => (j % 2 === 1 && claimWords.has(stem(p)) && !SHARE_STOP.has(p.toLowerCase()) ? <u key={j} className="shared">{p}</u> : p));
}

function ClaimDetail({ i, openRef }: { i: number; openRef: (ri: number) => void }) {
  const doc = useSession((s) => s.doc)!;
  const c = useSession((s) => s.claims[i]);
  const r = useSession((s) => s.results[c.refIndex]);
  const ci = doc.citances[c.citanceId];
  const lab = c.label ?? (c.status === 'no_source' ? 'none' : null);
  return (
    <>
      <div className="dhead">
        <span className="ref-no">claim → [{shortLabel(doc.references[c.refIndex].label, c.refIndex)}]</span>
        {lab ? <span className={`chip s-${lab}`}>{SUPPORT[lab].label}</span> : <span className="skeleton" />}
        <span className="conf">
          <Gauge probs={c.probs} />
        </span>
      </div>
      <p className="citetext">{highlight(ci.sentence, ci.marker)}</p>
      {lab && (
        <div className={`callout ${lab === 'supported' ? 'ok' : lab === 'review' ? 'warn' : 'muted'}`}>
          {SUPPORT[lab].help}
          {c.unrelated && ' The retrieved passages barely touch the topic of this sentence, which can mean the wrong work is cited.'}
          {c.sourceKind === 'abstract' && lab !== 'supported' && ' Only the abstract was available, so the full paper may still contain support.'}
          {c.note && ` ${c.note}`}
        </div>
      )}
      <div className="section-h">
        <h3>Cited work</h3>
        {r && <span className={`chip v-${r.verdict}`}>{VERDICT[r.verdict].label}</span>}
      </div>
      <p className="cite" style={{ margin: 0 }}>
        {r?.match ? formatReference(r.match) : doc.references[c.refIndex].raw}
      </p>
      <div className="fix-actions">
        <button className="btn" onClick={() => openRef(c.refIndex)}>
          Reference details
        </button>
      </div>
      {c.evidence.length > 0 && (
        <>
          <div className="section-h">
            <h3>Most relevant passages</h3>
            <small>from the {c.sourceKind}, ranked by relevance</small>
          </div>
          <ol className="ev">
            {c.evidence.map((e, k) => (
              <li key={k} className={k === 0 ? 'top' : ''}>
                <i>{k + 1}</i>
                <span className="cite">{markShared(e.text, ci.claim)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

/* ------------------------------ top bar widgets ------------------------------ */

function SourceStatus() {
  const st = useSession((s) => s.sourceStatus);
  const entries = Object.entries(st).filter(([, v]) => v && v.ok + v.limited + v.failed > 0);
  if (!entries.length) return null;
  return (
    <div className="status-dots" title="Index responses during this audit">
      {entries.map(([k, v]) => (
        <span key={k} className={v!.limited > v!.ok ? 'limited' : ''}>
          {sourceLabel(k as never)}
        </span>
      ))}
    </div>
  );
}

function ExportMenu({ onDone, disabled }: { onDone: (m: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const name = (getState().inputName ?? 'audit').replace(/\.[a-z]+$/i, '').replace(/[^\w.-]+/g, '_');
  const run = (fn: () => void, msg: string) => {
    fn();
    setOpen(false);
    onDone(msg);
  };
  return (
    <div className="menu">
      <button className="btn" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open}>
        Export
      </button>
      {open && (
        <div className="menu-pop">
          <button onClick={() => run(() => download(`${name}-audit.md`, markdownReport(getState()), 'text/markdown'), 'Report downloaded')}>
            Audit report<small>Markdown, problems and evidence</small>
          </button>
          <button onClick={() => run(() => download(`${name}-corrected.bib`, correctedBibtex(getState()), 'application/x-bibtex'), 'BibTeX downloaded')}>
            Corrected bibliography<small>BibTeX built from the published records</small>
          </button>
          <button onClick={() => run(() => download(`${name}-audit.json`, jsonReport(getState()), 'application/json'), 'JSON downloaded')}>
            Full results<small>JSON, every check and score</small>
          </button>
        </div>
      )}
    </div>
  );
}
