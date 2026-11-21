"""Merge manual review records (data/blind3/reviews.json) into the frozen run's outputs for summarize-blind3.py.

Only judgement/review fields, field-sample review fields and miss-sample JUDGEMENT lines are written; parsed
references, verdicts and counts produced by the frozen run are never changed. Run after the run has finished.
"""
import json
import re
from pathlib import Path

B = Path(__file__).resolve().parents[2] / 'data' / 'blind3'
rev = json.loads((B / 'reviews.json').read_text(encoding='utf-8'))
run = json.loads((B / 'results.json').read_text(encoding='utf-8'))
if not run.get('finishedAt'):
    raise RuntimeError('Run not finished')

used = set()
for paper in run['papers']:
    for flag in paper['flags']:
        key = f"{paper['file']}#{flag['n']}"
        if key in rev['flags']:
            flag['judgement'] = rev['flags'][key]['judgement']
            flag['review'] = rev['flags'][key]['review']
            used.add(('flag', key))
(B / 'results.json').write_text(json.dumps(run, indent=1, ensure_ascii=False), encoding='utf-8')

rows = json.loads((B / 'field_sample.json').read_text(encoding='utf-8'))
for row in rows:
    key = f"{row['file']}#{row['n']}"
    if key in rev['fields']:
        r = rev['fields'][key]
        row['pdfPage'], row['expected'], row['correct'], row['note'] = r['pdfPage'], r['expected'], r['correct'], r.get('note', '')
        used.add(('field', key))
(B / 'field_sample.json').write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding='utf-8')

out, current = [], None
for line in (B / 'miss_sample.txt').read_text(encoding='utf-8').splitlines():
    m = re.match(r'^## (.+) \[(\d+)\]', line)
    if m:
        current = f'{m[1]}#{m[2]}'
    if line.startswith('JUDGEMENT:') and current in rev['misses']:
        line = f"JUDGEMENT: {rev['misses'][current]}"
        used.add(('miss', current))
    out.append(line)
(B / 'miss_sample.txt').write_text('\n'.join(out), encoding='utf-8')

unused = [k for kind in ('flags', 'fields', 'misses') for k in rev[kind] if (kind[:-1] if kind != 'misses' else 'miss', k) not in used]
print(f'merged {len(used)} review records; unmatched keys: {unused}')
