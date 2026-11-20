"""Summarize the frozen run and explicitly count unfinished manual reviews. No network or inference.

Run after blind3 has finished. Fill results.json flags' judgement/review, miss_sample.txt JUDGEMENT ("correct" / "missed error"),
and field_sample.json correct fields (true / false / "na") against primary evidence, then rerun.
"""
import json
from pathlib import Path
import re
import statistics
from collections import Counter

ROOT = Path(__file__).resolve().parents[2] / 'data' / 'blind3'
manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
run = json.loads((ROOT / 'results.json').read_text(encoding='utf-8'))
if not run.get('finishedAt') or len(run['papers']) != len(manifest['picked']):
    raise RuntimeError('Run is incomplete; do not report partial papers as the complete audit')
if run['commit'] != manifest['freezeCommit'] or run['srcDirty']:
    raise RuntimeError('Frozen source identity does not match the manifest')

papers = run['papers']
refs = sum(p['refs'] for p in papers)
truth = sum(p['truthRefs'] for p in papers)
counts = {}
for paper in papers:
    for label, count in paper['counts'].items():
        counts[label] = counts.get(label, 0) + count
flags = [f for p in papers for f in p['flags']]
judged = {'real': 0, 'false': 0, 'uncertain': 0, 'pending': 0}
flag_evidence_pending = 0
for flag in flags:
    label = flag.get('judgement', '').strip().lower()
    key = next((k for k in ('real', 'false', 'uncertain') if label.startswith(k)), 'pending')
    judged[key] += 1
    review = flag.get('review', '')
    if not isinstance(review, str) or not re.search(r'https?://\S+', review) or len(review.split()) < 5:
        flag_evidence_pending += 1

field_rows = json.loads((ROOT / 'field_sample.json').read_text(encoding='utf-8'))
expected_fields = {p['file']: min(5, p['refs']) for p in papers if p['refs']}
if dict(Counter(r['file'] for r in field_rows)) != expected_fields or len({(r['file'], r['n']) for r in field_rows}) != len(field_rows):
    raise RuntimeError('Field sample size or unique references do not match the registered sample')
field_evidence_pending = sum(not r.get('pdfPage') or not r.get('expected') for r in field_rows)
fields = {}
for key in ('segmentation', 'title', 'authors', 'year', 'venue', 'identifiers'):
    values = [r['correct'].get(key) for r in field_rows]
    good = sum(v is True for v in values)
    bad = sum(v is False for v in values)
    na = sum(isinstance(v, str) and v.lower() in ('na', 'n/a') for v in values) if key != 'segmentation' else 0
    fields[key] = {'correct': good, 'incorrect': bad, 'notApplicable': na, 'pending': len(values) - good - bad - na,
                   'accuracyAmongReviewedApplicable': good / (good + bad) if good + bad else None}

miss_text = (ROOT / 'miss_sample.txt').read_text(encoding='utf-8')
miss_judgements = [line.split(':', 1)[1].strip() for line in miss_text.splitlines() if line.startswith('JUDGEMENT:')]
expected_misses = {p['file']: min(3, p['counts'].get('verified', 0) + p['counts'].get('verified_minor', 0)) for p in papers}
expected_misses = {k: v for k, v in expected_misses.items() if v}
if dict(Counter(re.findall(r'^## (.+) \[\d+\]', miss_text, re.M))) != expected_misses or len(miss_judgements) != sum(expected_misses.values()):
    raise RuntimeError('Miss sample size does not match the registered verified-reference sample')
miss_pending = sum(not v for v in miss_judgements)
# Explicit labels avoid treating "no error" as a detected error.
missed = sum(v.lower().startswith(('missed error', 'miss:')) for v in miss_judgements)
miss_unclassified = sum(bool(v) and not v.lower().startswith(('correct', 'no error', 'missed error', 'miss:')) for v in miss_judgements)
review_complete = not (judged['pending'] or flag_evidence_pending or field_evidence_pending or miss_pending or miss_unclassified or any(v['pending'] for v in fields.values()))
verified = counts.get('verified', 0) + counts.get('verified_minor', 0)
completeness = sum(min(p['refs'], p['truthRefs']) for p in papers) / truth if truth else None
false_share = judged['false'] / refs if refs and not judged['pending'] else None
times = [(p['parseMs'] + p['verifyMs']) / 1000 for p in papers]
summary = {
    'freezeCommit': run['commit'], 'startedAt': run['startedAt'], 'finishedAt': run['finishedAt'],
    'selectedPDFs': len(manifest['picked']), 'selectionRejectedRecords': len(manifest['skipped']),
    'extractionSuccesses': sum(p['refs'] > 0 for p in papers),
    'extractionSuccessRate': sum(p['refs'] > 0 for p in papers) / len(papers),
    'extractionFailures': [p['file'] for p in papers if not p['refs']],
    'references': refs, 'mainBibliographyTruthCount': truth, 'cappedCountCompleteness': completeness,
    'excessEntries': sum(max(0, p['refs'] - p['truthRefs']) for p in papers),
    'verified': verified, 'verifiedCoverage': verified / refs if refs else None,
    'verifiedCountOverTruthCount': verified / truth if truth else None,
    'unverifiable': counts.get('unverifiable', 0), 'unchecked': counts.get('unchecked', 0),
    'unverifiableShare': counts.get('unverifiable', 0) / refs if refs else None,
    'uncheckedShare': counts.get('unchecked', 0) / refs if refs else None,
    'verdictCounts': counts, 'flags': len(flags), 'flagReview': judged,
    'flagEvidencePending': flag_evidence_pending,
    'flagPrecision': judged['real'] / len(flags) if flags and not judged['pending'] else None,
    'falseAlarmsOverAllReferences': false_share,
    'conditionalFalsePositiveRate': None,  # no independently established all-genuine denominator
    'fieldSampleReferences': len(field_rows), 'fieldEvidencePending': field_evidence_pending, 'fields': fields,
    'missSample': {'selected': len(miss_judgements), 'pending': miss_pending, 'unclassified': miss_unclassified, 'missed': missed},
    'endToEndSeconds': {'median': statistics.median(times), 'min': min(times), 'max': max(times)},
    'parseSeconds': sum(p['parseMs'] for p in papers) / 1000,
    'verifySeconds': sum(p['verifyMs'] for p in papers) / 1000, 'hostStats': run['hostStats'],
    'manualReviewComplete': review_complete,
    'numericTargetsMet': (false_share <= .02 and completeness >= .95) if review_complete and false_share is not None else None,
    'overallAcceptance': 'pending independent review of coverage and abstention; numeric targets alone are insufficient',
    'coverageComparators': {'blind1': 506 / 635, 'blind2': 362 / 465},
    'caveats': ['Selection requires a >=10-entry .bbl or JATS; source availability limits generality.',
                'Node uses the browser core/settings but does not reproduce browser CORS behavior.',
                'Main bibliography only; count completeness does not prove field accuracy.',
                'Uncertain flags remain in precision denominator; no flags means undefined precision.',
                'No sampled misses does not establish zero misses overall.'],
}
(ROOT / 'summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(json.dumps(summary, indent=2, ensure_ascii=False))
