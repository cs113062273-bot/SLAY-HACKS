#!/bin/bash
# Recompute .bbl ground truth for arXiv entries of data/parser_dev/truth.tsv: the .bbl named after the main .tex
# (the one with \documentclass); otherwise the .bbl with the most entries. Usage: bash scripts/parser-retruth.sh
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; T="$ROOT/data/parser_dev/truth.tsv"; TMP="$(mktemp -d)"
UA="veracite-benchmark/1.0 (research evaluation script)"
out="$T.new"; head -1 "$T" > "$out"
tail -n +2 "$T" | while IFS=$'\t' read -r f cat id k; do
  case "$cat" in pub:*) printf '%s\t%s\t%s\t%s\n' "$f" "$cat" "$id" "$k" >> "$out"; continue;; esac
  rm -rf "$TMP"/*; for t in 1 2 3 4; do curl -sL -A "$UA" -o "$TMP/src" -w '%{http_code}' "https://arxiv.org/e-print/$id" | grep -q 200 && break; sleep $((20*t)); done
  ( cd "$TMP" && (tar -xzf src 2>/dev/null || gzip -dc src > main.tex 2>/dev/null) )
  main=$(grep -l '\documentclass' $(find "$TMP" -name '*.tex' | tr '\n' ' ') 2>/dev/null | head -1)
  bb=""; [ -n "$main" ] && [ -f "${main%.tex}.bbl" ] && bb="${main%.tex}.bbl"
  if [ -z "$bb" ]; then best=0; while IFS= read -r b; do c=$(grep -c -F -e '\bibitem' -e '\entry{' "$b"); [ "$c" -gt "$best" ] && { best=$c; bb="$b"; }; done < <(find "$TMP" -name '*.bbl'); fi
  n=$([ -n "$bb" ] && grep -c -F -e '\bibitem' -e '\entry{' "$bb" || echo "$k")
  [ "$n" != "$k" ] && echo "$f $k -> $n"
  printf '%s\t%s\t%s\t%s\n' "$f" "$cat" "$id" "$n" >> "$out"; sleep 4
done
mv "$out" "$T"; rm -rf "$TMP"
