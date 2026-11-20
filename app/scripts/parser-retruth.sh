#!/bin/bash
# Recompute .bbl ground truth for arXiv entries of data/parser_dev/truth.tsv: the .bbl named after the main .tex
# (the one with \documentclass); otherwise the .bbl with the most entries. Usage: bash scripts/parser-retruth.sh
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; T="$ROOT/data/parser_dev/truth.tsv"; TMP="$(mktemp -d)"
UA="veracite-benchmark/1.0 (research evaluation script)"
# entries only: REVTeX .bbl files also define macros named \bibitemStop / \bibitemNoStop
count() { grep -c -E '[\]bibitem[[:space:]]*([[{]|$)|[\]entry[{]' "$1" </dev/null; }
out="$T.new"; head -1 "$T" > "$out"
# the list is read on fd 3 so nothing inside the loop can swallow it
while IFS=$'\t' read -r -u 3 f cat id k; do
  case "$cat" in pub:*) printf '%s\t%s\t%s\t%s\n' "$f" "$cat" "$id" "$k" >> "$out"; continue;; esac
  rm -rf "$TMP"/* "$TMP"/.[!.]* 2>/dev/null; ok=""
  for t in 1 2 3 4; do curl -sL -A "$UA" -o "$TMP/src" -w '%{http_code}' "https://arxiv.org/e-print/$id" </dev/null | grep -q 200 && { ok=1; break; }; sleep $((20*t)); done
  if [ -z "$ok" ]; then echo "$f fetch failed, kept $k"; printf '%s\t%s\t%s\t%s\n' "$f" "$cat" "$id" "$k" >> "$out"; continue; fi
  ( cd "$TMP" && (tar -xzf src 2>/dev/null || gzip -dc src > main.tex 2>/dev/null) ) </dev/null
  main=$(find "$TMP" -name '*.tex' -exec grep -l '\\documentclass' {} + </dev/null 2>/dev/null | head -1)
  bb=""; [ -n "$main" ] && [ -f "${main%.tex}.bbl" ] && bb="${main%.tex}.bbl"
  if [ -z "$bb" ]; then best=0; while IFS= read -r b; do c=$(count "$b"); [ "$c" -gt "$best" ] && { best=$c; bb="$b"; }; done < <(find "$TMP" -name '*.bbl'); fi
  if [ -n "$bb" ]; then n=$(count "$bb"); else n="$k"; echo "$f no .bbl, kept $k"; fi
  [ "$n" != "$k" ] && echo "$f $k -> $n"
  printf '%s\t%s\t%s\t%s\n' "$f" "$cat" "$id" "$n" >> "$out"; sleep 4
done 3< <(tail -n +2 "$T")
mv "$out" "$T"; rm -rf "$TMP"; echo RETRUTH-DONE
