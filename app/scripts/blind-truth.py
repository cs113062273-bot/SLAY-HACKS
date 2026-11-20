"""Ground-truth reference counts for the papers of a blind set (after its frozen run), so reference extraction can
be scored. arXiv: entries in the paper's .bbl ("bbl", exact), or without a .bbl the distinct cited keys found in the
.bib files ("cite", approximate: it agreed exactly with the .bbl on 8 of 10 parser-corpus papers that have both).
PLOS ONE: <ref> elements in the article XML ("jats"). Writes data/<set>/truth.json.
Usage: python -I scripts/blind-truth.py 2     (1 for data/blind/)
"""
import json, os, re, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texrefs import count_refs, get  # noqa: E402

SET = sys.argv[1] if len(sys.argv) > 1 else '1'
B = 'blind' if SET == '1' else f'blind{SET}'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'data'))

m = json.load(open(os.path.join(ROOT, B, 'manifest.json'), encoding='utf-8'))
out = {}
for p in m['picked']:
    if p['source'] == 'arXiv':
        n, how = count_refs(get(f"https://arxiv.org/e-print/{p['id']}"))
    else:
        xml = get(f"https://journals.plos.org/plosone/article/file?id={p['id']}&type=manuscript").decode('utf-8', 'replace')
        n, how = len(re.findall(r'<ref[ >]', xml)), 'jats'
    out[p['file']] = {'n': n, 'how': how}
    print(p['file'], n, how, flush=True)
    time.sleep(4)
json.dump(out, open(os.path.join(ROOT, B, 'truth.json'), 'w', encoding='utf-8'), indent=1)
