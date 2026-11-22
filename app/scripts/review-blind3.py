"""Print blind3 review material: each field-sample reference's parsed fields beside an independent poppler
(pdftotext) excerpt and its PDF page, plus each flag's raw text. Offline; no network. Usage:
  python -I app/scripts/review-blind3.py fields|flags [file-substring]
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
B = ROOT / 'data' / ('blind' + __import__('os').environ.get('BLIND_SET', '3'))
PDFS = ROOT / 'data' / 'pdfs' / B.name
sys.stdout.reconfigure(encoding='utf-8')
mode = sys.argv[1]
only = sys.argv[2] if len(sys.argv) > 2 else ''
_pages = {}


def pages(file):
    if file not in _pages:
        out = subprocess.run(['pdftotext', '-enc', 'UTF-8', str(PDFS / file), '-'], capture_output=True).stdout.decode('utf-8', 'replace')
        _pages[file] = out.split('\f')
    return _pages[file]


def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def locate(file, title, raw):
    probe = norm(title or raw)[:40] or norm(raw)[:40]
    for k, text in enumerate(pages(file)):
        keep = [i for i, ch in enumerate(text) if re.match(r'[A-Za-z0-9]', ch)]
        flat = ''.join(text[i] for i in keep).lower()
        at = flat.find(probe)
        if at >= 0:
            start = keep[at]
            return k + 1, re.sub(r'\s+', ' ', text[max(0, start - 250): start + 450])
    return None, ''


if mode == 'fields':
    rows = json.loads((B / 'field_sample.json').read_text(encoding='utf-8'))
    for r in rows:
        if only not in r['file']:
            continue
        p = r['parsed']
        page, excerpt = locate(r['file'], p.get('title'), p['raw'])
        print(f"=== {r['file']} [{r['n']}] page {page}")
        print('RAW   :', p['raw'])
        print('TITLE :', p.get('title'))
        print('AUTH  :', '; '.join(f"{a.get('family')}, {a.get('given', '')}" for a in p.get('authors', [])), '| etAl' if p.get('etAl') else '')
        print('YEAR  :', p.get('year'), '| VENUE:', p.get('venue'))
        print('IDS   :', p.get('dois'), p.get('arxivIds'), p.get('urls'))
        print('--- poppler:\n' + excerpt + '\n')
else:
    run = json.loads((B / 'results.json').read_text(encoding='utf-8'))
    for paper in run['papers']:
        if only not in paper['file']:
            continue
        for f in paper['flags']:
            print(f"=== {paper['file']} [{f['n']}] {f['verdict']}")
            print('RAW   :', f['raw'])
            print('ISSUES:', ' | '.join(f['issues']))
            m = f.get('match')
            if m:
                print('MATCH :', m.get('title'), '|', ', '.join(m.get('authors', [])[:8]), '|', m.get('years'), '|', m.get('venue'), '|', m.get('doi') or m.get('arxivId') or '')
            print()
