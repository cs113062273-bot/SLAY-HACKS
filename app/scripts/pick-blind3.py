"""Pre-registered selection for blind set 3 (data/blind3/). The rule is fixed here before any paper is picked.

Unlike sets 1 and 2, the parser plays NO part in the selection, so extraction failures stay in the set and the
reference count can be scored against ground truth:
  - arXiv: for each category below (none used by the development papers, the parser corpus or sets 1-2), go down the
    category's "recent" listing (newest first) and take the first paper whose PRIMARY category is that category,
    that was not picked before, whose source contains a .bbl with at least 10 entries, and whose PDF downloads.
    Ground truth = number of \\bibitem / \\entry in the .bbl named after the main .tex (else the largest .bbl).
  - PLOS ONE: the two most recently published research articles not picked before; ground truth = number of <ref>
    elements in the article XML.
  - Every candidate passed over is recorded in "skipped" with the reason.
Writes data/blind3/manifest.json and the PDFs to data/pdfs/blind3/.
Usage: python -I scripts/pick-blind3.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texrefs import files_of, from_bbl  # noqa: E402  (the .bbl count, shared with blind-truth.py)

CATS = ['cs.DC', 'cs.SI', 'math.NA', 'math.ST', 'physics.plasm-ph', 'physics.ins-det', 'cond-mat.mes-hall',
        'astro-ph.HE', 'hep-ex', 'q-bio.BM', 'cs.NE', 'nlin.CD']
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'data'))
OUT = os.path.join(ROOT, 'pdfs', 'blind3')
UA = {'User-Agent': 'veracite-benchmark/1.0 (research evaluation script)'}
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(ROOT, 'blind3'), exist_ok=True)
MANIFEST = os.path.join(ROOT, 'blind3', 'manifest.json')
resume = '--resume' in sys.argv
if os.path.exists(MANIFEST) and not resume:
    raise RuntimeError('Manifest already exists: use --resume only for interrupted, incomplete selection')
freeze = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
if subprocess.check_output(['git', 'status', '--porcelain', '--', 'app/src', 'app/scripts/pick-blind3.py', 'app/scripts/blind-test.ts', 'data/blind3/PROTOCOL.md'], cwd=os.path.dirname(ROOT), text=True).strip():
    raise RuntimeError('Commit code and protocol before selection')

seen = set()
for d in ('blind', 'blind2'):
    old = json.load(open(os.path.join(ROOT, d, 'manifest.json'), encoding='utf-8'))
    for p in old['picked'] + old.get('skipped', []):
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


def bbl_truth(src):
    return from_bbl(files_of(src))


manifest = {'rule': 'blind set 3: first recent primary-category arXiv paper per category with a >=10-entry .bbl; two newest PLOS ONE research articles; parser not used in selection',
            'freezeCommit': freeze, 'queriedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'picked': [], 'skipped': []}
if resume:
    manifest = json.load(open(MANIFEST, encoding='utf-8'))
    if manifest.get('selectionComplete') or manifest['freezeCommit'] != freeze:
        raise RuntimeError('Cannot reselect a complete manifest or change its freeze commit')
for cat in CATS:
    if any(p.get('cat') == cat for p in manifest['picked']): continue
    html = get(f'https://arxiv.org/list/{cat}/recent?skip=0&show=50').decode('utf-8', 'replace')
    ids = list(dict.fromkeys(re.findall(r'/abs/(\d{4}\.\d{4,5})', html)))
    got = False
    for aid in ids[:30]:
        if aid in seen:
            manifest['skipped'].append({'cat': cat, 'id': aid, 'reason': 'previously downloaded or selected'})
            continue
        time.sleep(4)
        abs_html = get(f'https://arxiv.org/abs/{aid}').decode('utf-8', 'replace')
        prim = re.search(r'primary-subject">[^<]*\(([^)]+)\)', abs_html)
        if not prim or prim.group(1) != cat:
            manifest['skipped'].append({'cat': cat, 'id': aid, 'reason': 'not primary category'})
            continue
        versions = re.findall(re.escape(aid) + r'v(\d+)\b', abs_html)
        versioned_id = aid + 'v' + str(max(map(int, versions))) if versions else aid
        title = re.search(r'<meta name="citation_title" content="([^"]*)"', abs_html)
        title = title.group(1) if title else ''
        time.sleep(4)
        try:
            k = bbl_truth(get(f'https://arxiv.org/e-print/{versioned_id}'))
        except Exception as e:
            manifest['skipped'].append({'cat': cat, 'id': aid, 'reason': 'source: ' + str(e)[:80]}); continue
        if k is None or k < 10:
            manifest['skipped'].append({'cat': cat, 'id': aid, 'title': title, 'reason': 'no .bbl' if k is None else f'.bbl has {k} entries'}); continue
        time.sleep(4)
        try:
            pdf = get(f'https://arxiv.org/pdf/{versioned_id}')
            assert pdf.startswith(b'%PDF')
        except Exception as e:
            manifest['skipped'].append({'cat': cat, 'id': aid, 'reason': 'pdf: ' + str(e)[:80]}); continue
        f = f'{cat}_{aid}.pdf'
        open(os.path.join(OUT, f), 'wb').write(pdf)
        manifest['picked'].append({'source': 'arXiv', 'cat': cat, 'id': versioned_id, 'pdfUrl': f'https://arxiv.org/pdf/{versioned_id}', 'title': title, 'file': f, 'truthRefs': k, 'truthMethod': 'main .bbl, else largest .bbl'})
        print(f'{cat}: {aid} ({k} refs in .bbl) {title[:70]}', flush=True)
        got = True
        json.dump(manifest, open(MANIFEST, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
        break
    if not got: print(f'{cat}: nothing picked', flush=True)

q = urllib.parse.quote('journal:"PLOS ONE" AND article_type:"Research Article"')
docs = json.loads(get(f'https://api.plos.org/search?q={q}&fq=doc_type:full&sort=publication_date%20desc&rows=10&fl=id,title_display,publication_date'))['response']['docs']
n = sum(p['source'] == 'PLOS ONE' for p in manifest['picked'])
seen.update(p['id'] for p in manifest['picked'])
for d in docs:
    if n >= 2: break
    if d['id'] in seen: continue
    try:
        xml = get(f"https://journals.plos.org/plosone/article/file?id={d['id']}&type=manuscript").decode('utf-8', 'replace')
        k = len(re.findall(r'<ref[ >]', xml))
        pdf = get(f"https://journals.plos.org/plosone/article/file?id={d['id']}&type=printable")
        assert pdf.startswith(b'%PDF')
    except Exception as e:
        manifest['skipped'].append({'source': 'PLOS ONE', 'id': d['id'], 'reason': str(e)[:80]}); continue
    if k < 10:
        manifest['skipped'].append({'source': 'PLOS ONE', 'id': d['id'], 'reason': f'XML has {k} refs'}); continue
    f = 'plos_' + re.sub(r'[/.]', '_', d['id']) + '.pdf'
    open(os.path.join(OUT, f), 'wb').write(pdf)
    manifest['picked'].append({'source': 'PLOS ONE', 'id': d['id'], 'title': d['title_display'], 'published': d['publication_date'], 'file': f, 'truthRefs': k})
    print(f"PLOS ONE: {d['id']} ({k} refs in XML)", flush=True)
    n += 1
    json.dump(manifest, open(MANIFEST, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
manifest['selectionComplete'] = len(manifest['picked']) == 14
json.dump(manifest, open(MANIFEST, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(f"picked {len(manifest['picked'])}, skipped {len(manifest['skipped'])}")
