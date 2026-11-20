#!/bin/bash
# Parser development corpus (never used for blind tests): the 2 newest primary-category arXiv papers in each
# category below, excluding any paper in a blind manifest. Ground truth = number of \bibitem / \entry in the
# paper's own .bbl (arXiv source). Writes data/parser_dev/truth.tsv and PDFs to data/pdfs/parser_dev/.
# Usage: bash scripts/parser-corpus.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/data/pdfs/parser_dev"; TMP="$ROOT/data/pdfs/parser_dev/_src"; mkdir -p "$OUT" "$TMP"
UA="veracite-benchmark/1.0 (research evaluation script)"
CATS="cs.LG cs.AI cs.IR cs.NI cs.DS math.CO math.NT math.OC physics.flu-dyn physics.bio-ph cond-mat.soft cond-mat.str-el astro-ph.CO astro-ph.SR nucl-th hep-th q-bio.QM q-fin.ST stat.CO eess.IV eess.AS econ.TH physics.ao-ph physics.ed-ph"
SEEN=$(cat "$ROOT"/data/blind*/manifest.json | grep -o '"id": "[^"]*"' | cut -d'"' -f4)
# arXiv answers "Rate exceeded" (HTTP 429) to bursts: retry politely
get() { for t in 1 2 3 4 5 6; do curl -sL -A "$UA" -o "$2" -w '%{http_code}' "$1" | grep -q '^200$' && return 0; sleep $((30 * t)); done; return 1; }
TRUTH="$ROOT/data/parser_dev/truth.tsv"; [ -f "$TRUTH" ] || printf 'file\tcat\tid\tbibitems\n' > "$TRUTH"
for cat in $CATS; do
  get "https://export.arxiv.org/api/query?search_query=cat:$cat&sortBy=submittedDate&sortOrder=descending&max_results=15" "$TMP/list.xml" || continue
  ids=$(tr -d '\n' < "$TMP/list.xml" | sed 's/<entry>/\n<entry>/g' | grep '<entry>' | while read -r e; do
      id=$(echo "$e" | grep -o '<id>http://arxiv.org/abs/[^<]*' | sed 's#.*/abs/##'); pc=$(echo "$e" | grep -o 'primary_category[^>]*term="[^"]*"' | sed 's/.*term="//;s/"//'); [ "$pc" = "$cat" ] && echo "$id"; done)
  sleep 5; n=0
  for id in $ids; do
    [ $n -ge 2 ] && break
    echo "$SEEN" | grep -qx "$id" && continue
    f="${cat}_${id}.pdf"; grep -q "^$f" "$TRUTH" && { n=$((n+1)); continue; }
    rm -rf "$TMP"/*; get "https://arxiv.org/e-print/$id" "$TMP/src" || continue; sleep 5
    ( cd "$TMP" && (tar -xzf src 2>/dev/null || (gzip -dc src > main.tex 2>/dev/null)) )
    bb=$(find "$TMP" -name '*.bbl' | head -5)
    [ -z "$bb" ] && continue   # no .bbl in source: no ground truth, skip
    k=$(cat $bb | grep -c -E '\bibitem|\entry\{')
    [ "$k" -lt 5 ] && continue
    get "https://arxiv.org/pdf/$id" "$OUT/$f" || continue; sleep 5
    printf '%s\t%s\t%s\t%s\n' "$f" "$cat" "$id" "$k" >> "$TRUTH"; echo "$f $k"; n=$((n+1))
  done
done
rm -rf "$TMP"
