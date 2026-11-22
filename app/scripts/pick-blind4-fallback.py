"""Blind set 4 amendment (data/blind4/AMENDMENT.md): q-bio.CB had no eligible paper (its recent listing held 4
papers: 3 without a .bbl, 1 cross-list), so it is replaced by the first of FALLBACK, in this fixed order, that yields
an eligible paper under exactly the set-3/set-4 rule (newest primary-category paper, >=10-entry .bbl, PDF downloads,
never downloaded before). Existing picks are kept. Run inside the frozen worktree; no paper has been parsed.
Usage: python -I app/scripts/pick-blind4-fallback.py
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texrefs import files_of, from_bbl  # noqa: E402

FALLBACK = ['q-bio.MN', 'q-bio.TO', 'q-bio.SC']
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'data'))
OUT = os.path.join(ROOT, 'pdfs', 'blind4')
MANIFEST = os.path.join(ROOT, 'blind4', 'manifest.json')
UA = {'User-Agent': 'veracite-benchmark/1.0 (research evaluation script)'}
m = json.load(open(MANIFEST, encoding='utf-8'))
freeze = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
if m.get('selectionComplete') or m['freezeCommit'] != freeze or len(m['picked']) != 13:
    raise RuntimeError('Fallback applies only to the incomplete 13-paper manifest at its freeze commit')
if any(p.get('cat') in FALLBACK for p in m['picked']) or any(p.get('cat') == 'q-bio.CB' for p in m['picked']):
    raise RuntimeError('Replacement already picked')
if subprocess.check_output(['git', 'status', '--porcelain', '--', 'app/src', 'app/scripts/pick-blind4.py', 'app/scripts/blind-test.ts', 'data/blind4/PROTOCOL.md'], cwd=os.path.dirname(ROOT), text=True).strip():
    raise RuntimeError('Frozen source changed')

seen = set()
for d in ('blind', 'blind2', 'blind3'):
    old = json.load(open(os.path.join(ROOT, d, 'manifest.json'), encoding='utf-8'))
    for p in old['picked'] + old.get('skipped', []):
        seen.add(re.sub(r'v\d+$', '', p['id']))
for p in m['picked'] + m['skipped']:
    seen.add(re.sub(r'v\d+$', '', p['id']))
for _, _, filenames in os.walk(os.path.join(ROOT, 'pdfs')):
    for filename in filenames:
        seen.update(re.findall(r'\d{4}\.\d{4,5}', filename))
for line in open(os.path.join(ROOT, 'parser_dev', 'truth.tsv'), encoding='utf-8').read().splitlines()[1:]:
    seen.add(re.sub(r'v\d+$', '', line.split('\t')[2]))


def get(url, tries=3):
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503): raise
        except Exception:
            pass
        time.sleep(30 * (t + 1))
    raise RuntimeError('fetch failed: ' + url)


m['amendment'] = {'file': 'data/blind4/AMENDMENT.md', 'replaced': 'q-bio.CB', 'fallbackOrder': FALLBACK}
for cat in FALLBACK:
    html = get(f'https://arxiv.org/list/{cat}/recent?skip=0&show=50').decode('utf-8', 'replace')
    ids = list(dict.fromkeys(re.findall(r'/abs/(\d{4}\.\d{4,5})', html)))
    got = False
    for aid in ids[:30]:
        if aid in seen:
            m['skipped'].append({'cat': cat, 'id': aid, 'reason': 'previously downloaded or selected'}); continue
        time.sleep(4)
        abs_html = get(f'https://arxiv.org/abs/{aid}').decode('utf-8', 'replace')
        prim = re.search(r'primary-subject">[^<]*\(([^)]+)\)', abs_html)
        if not prim or prim.group(1) != cat:
            m['skipped'].append({'cat': cat, 'id': aid, 'reason': 'not primary category'}); continue
        versions = re.findall(re.escape(aid) + r'v(\d+)\b', abs_html)
        versioned_id = aid + 'v' + str(max(map(int, versions))) if versions else aid
        title = re.search(r'<meta name="citation_title" content="([^"]*)"', abs_html)
        title = title.group(1) if title else ''
        time.sleep(4)
        try:
            k = from_bbl(files_of(get(f'https://arxiv.org/e-print/{versioned_id}')))
        except Exception as e:
            m['skipped'].append({'cat': cat, 'id': aid, 'reason': 'source: ' + str(e)[:80]}); continue
        if k is None or k < 10:
            m['skipped'].append({'cat': cat, 'id': aid, 'title': title, 'reason': 'no .bbl' if k is None else f'.bbl has {k} entries'}); continue
        time.sleep(4)
        try:
            pdf = get(f'https://arxiv.org/pdf/{versioned_id}')
            assert pdf.startswith(b'%PDF')
        except Exception as e:
            m['skipped'].append({'cat': cat, 'id': aid, 'reason': 'pdf: ' + str(e)[:80]}); continue
        f = f'{cat}_{aid}.pdf'
        open(os.path.join(OUT, f), 'wb').write(pdf)
        m['picked'].insert(9, {'source': 'arXiv', 'cat': cat, 'replaces': 'q-bio.CB', 'id': versioned_id, 'pdfUrl': f'https://arxiv.org/pdf/{versioned_id}', 'title': title, 'file': f, 'truthRefs': k, 'truthMethod': 'main .bbl, else largest .bbl'})
        print(f'{cat} (replaces q-bio.CB): {aid} ({k} refs in .bbl) {title[:70]}', flush=True)
        got = True
        break
    json.dump(m, open(MANIFEST, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    if got: break
    print(f'{cat}: nothing picked', flush=True)
m['selectionComplete'] = len(m['picked']) == 14
json.dump(m, open(MANIFEST, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(f"picked {len(m['picked'])}, complete {m['selectionComplete']}")
