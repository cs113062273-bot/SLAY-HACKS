"""Reference counts from an arXiv source archive (shared by blind-truth.py and pick-blind3.py).

count_refs(src) -> (n, how): n = entries in the .bbl named after the main .tex (else the largest .bbl); without a
.bbl (arXiv now runs BibTeX itself), the distinct keys cited with \\cite-like commands that exist in the .bib files
(all .bib entries if \\nocite{*}). how = 'bbl' | 'cite' | None.
Validate the fallback with: python -I scripts/texrefs.py <arXiv id> ...  (prints both counts when a .bbl exists)
"""
import gzip, io, re, sys, tarfile, time, urllib.request

UA = {'User-Agent': 'veracite-benchmark/1.0 (research evaluation script)'}
# entries only: REVTeX .bbl files also define macros named \bibitemStop / \bibitemNoStop
BBL_ENTRY = re.compile(r'[\\]bibitem\s*(?:[\[{]|$)|[\\]entry\{', re.M)
CITE = re.compile(r'[\\](?:no)?cite[a-zA-Z]*\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]*)\}')
BIB_KEY = re.compile(r'@\s*(?!comment|string|preamble)[a-zA-Z]+\s*\{\s*([^,\s]+)\s*,', re.I)


def files_of(src):
    files = {}
    try:
        with tarfile.open(fileobj=io.BytesIO(src), mode='r:gz') as tf:
            for m in tf.getmembers():
                if m.isfile() and m.name.endswith(('.tex', '.bbl', '.bib')):
                    files[m.name] = tf.extractfile(m).read().decode('utf-8', 'replace')
    except tarfile.TarError:
        try: files['main.tex'] = gzip.decompress(src).decode('utf-8', 'replace')
        except Exception: pass
    return files


def from_bbl(files):
    main = next((n for n, s in files.items() if n.endswith('.tex') and '\\documentclass' in s), None)
    if main and main[:-4] + '.bbl' in files: return len(BBL_ENTRY.findall(files[main[:-4] + '.bbl']))
    bbls = [len(BBL_ENTRY.findall(s)) for n, s in files.items() if n.endswith('.bbl')]
    return max(bbls) if bbls else None


def from_cites(files):
    tex = '\n'.join(re.sub(r'(?<!\\)%.*', '', s) for n, s in files.items() if n.endswith('.tex'))
    bib = set(k for n, s in files.items() if n.endswith('.bib') for k in BIB_KEY.findall(s))
    if not bib: return None
    keys = set(k.strip() for grp in CITE.findall(tex) for k in grp.split(',') if k.strip())
    if '*' in keys: return len(bib)
    return len(keys & bib) or None


def count_refs(src):
    files = files_of(src)
    n = from_bbl(files)
    if n is not None: return n, 'bbl'
    n = from_cites(files)
    return (n, 'cite') if n is not None else (None, None)


def get(url, tries=5):
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return r.read()
        except Exception:
            time.sleep(20 * (t + 1))
    raise RuntimeError('fetch failed: ' + url)


if __name__ == '__main__':
    for aid in sys.argv[1:]:
        fs = files_of(get(f'https://arxiv.org/e-print/{aid}'))
        print(aid, 'bbl', from_bbl(fs), 'cite', from_cites(fs), flush=True)
        time.sleep(4)
