"""Publisher PDFs for the parser development corpus (never used for blind tests).

For each publisher below, the newest open-access articles indexed by Europe PMC (published 2026-10-01..20, so
their full-text XML exists). Ground truth = number of <ref> elements in the JATS XML; the PDF is the
deposited PDF as rendered by Europe PMC (the publisher's typeset PDF). Appends to data/parser_dev/truth.tsv; PDFs go to data/pdfs/parser_dev/.
Usage: python -I scripts/parser-corpus-pmc.py   (PUBS=Nature,PLOS to limit publishers; PER=n per publisher)
"""
import json, os, re, time, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'data'))
OUT = os.path.join(ROOT, 'pdfs', 'parser_dev')
TRUTH = os.path.join(ROOT, 'parser_dev', 'truth.tsv')
UA = {'User-Agent': 'Mozilla/5.0 (veracite-benchmark research evaluation script)'}
PER = int(os.environ.get('PER', 2))
PUBS = [x for x in os.environ.get('PUBS', '').split(',') if x]


def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
        return (data, r.headers.get('content-type', ''), r.geturl()) if binary else data.decode('utf-8', 'replace')


QUERY = {
    'Frontiers': 'PUBLISHER:"Frontiers"',
    'MDPI': 'PUBLISHER:"MDPI"',
    'BMC': 'PUBLISHER:"BMC"',
    'Springer': 'PUBLISHER:"Springer" NOT PUBLISHER:"BMC"',
    'Nature': 'JOURNAL:"Sci Rep"',
    'PLOS': '(JOURNAL:"PLoS Comput Biol" OR JOURNAL:"PLoS Biol" OR JOURNAL:"PLoS Med" OR JOURNAL:"PLoS Genet")',
    'eLife': 'JOURNAL:"eLife"',
    'Elsevier': 'JOURNAL:"Heliyon"',
    'Wiley': 'PUBLISHER:"Wiley"',
    'OUP': 'JOURNAL:"Nucleic Acids Res"',
    'ACS': 'JOURNAL:"ACS Omega"',
    'Cell': 'JOURNAL:"Cell Rep"',
    'BMJ': 'JOURNAL:"BMJ Open"',
    'Taylor': 'PUBLISHER:"Taylor"',
}
# most publisher sites refuse scripted downloads (403 / challenge pages); Europe PMC serves the deposited PDF
PDF_URL = {k: (lambda pmcid: f'https://europepmc.org/articles/{pmcid}?pdf=render') for k in QUERY}

done = open(TRUTH, encoding='utf-8').read() if os.path.exists(TRUTH) else 'file\tcat\tid\tbibitems\n'
if not os.path.exists(TRUTH):
    open(TRUTH, 'w', encoding='utf-8').write(done)
for pub, q in QUERY.items():
    if PUBS and pub not in PUBS: continue
    url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?' + urllib.parse.urlencode({
        'query': f'{q} AND OPEN_ACCESS:y AND FIRST_PDATE:[2026-10-01 TO 2026-10-20]', 'format': 'json', 'pageSize': 15, 'resultType': 'core'})
    try:
        res = json.loads(get(url))['resultList']['result']
    except Exception as e:
        print(pub, 'search failed', e); continue
    n = 0
    for r in res:
        if n >= PER: break
        pmcid, doi = r.get('pmcid'), r.get('doi')
        if not pmcid or not doi: continue
        f = f'pub-{pub}_{pmcid}.pdf'
        if f in done: n += 1; continue
        try:
            xml = get(f'https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML')
            k = len(re.findall(r'<ref[ >]', xml))
            if k < 5: continue
            data, ctype, _ = get(PDF_URL[pub](pmcid), binary=True)
            if not data.startswith(b'%PDF'): print(pub, doi, 'not a PDF', ctype); continue
            open(os.path.join(OUT, f), 'wb').write(data)
            open(TRUTH, 'a', encoding='utf-8').write(f'{f}\tpub:{pub}\t{doi}\t{k}\n')
            print(f, k); n += 1
        except Exception as e:
            print(pub, doi, 'failed', str(e)[:80])
        time.sleep(2)
