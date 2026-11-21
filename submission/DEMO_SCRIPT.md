# Veracite demo video script (target 2:50, limit 4:00)

**Recording needs the owner's approval first** (SKILL.md rule). This is the script only.

Setup before recording:
- Chrome, 1440×900 window, light theme, zoom 100%. Hide bookmarks and extensions.
- Live site: https://cs113062273-bot.github.io/SLAY-HACKS/.
- Open the live site once beforehand so both models are cached; then the claim stage runs at full speed on camera.
- Have one real PDF on the desktop (e.g. a recent arXiv paper you have permission to show) for the drag-and-drop shot.
- Record the screen at 30 fps; record the voice-over separately and lay it over the cut.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:12 | Landing page, zoom on the NeurIPS specimen card: the arXiv ID highlighted, "resolves to" a different paper. | "This reference is from a paper accepted at NeurIPS 2025. The authors are real. The arXiv ID is real. But it points to a completely different paper. Three to five expert reviewers missed it." |
| 0:12–0:28 | Slow scroll over the three statistics. | "In early 2026, one in 277 PubMed Central papers cited at least one fabricated reference. And existing checkers only ask whether a title exists. On a public benchmark they wrongly flag between 20 and 53 of 71 genuine references." |
| 0:28–0:40 | Hover the two mode buttons; click **Full audit**. | "Veracite audits citations the way a careful reviewer would, and it runs entirely in your browser. No account, no upload, no API key." |
| 0:40–1:15 | Click the **NeurIPS 2025 preprint** sample. References stream in. Click a **Fabricated** row, then a **Wrong identifier** row: show the field-by-field table. | "Here is the NeurIPS preprint audited by Badalova and Mayr. Every reference is checked against Crossref, OpenAlex, Semantic Scholar, DataCite and Europe PMC. Title, every author, year, venue and identifier must point to the same record. This one does not exist anywhere. This one has a real arXiv ID that belongs to another paper: the field table shows exactly what differs." |
| 1:15–1:30 | Click a **Metadata error** row, then **Copy BibTeX** on the suggested correction. Toast appears. | "When a reference is real but cited wrongly, Veracite builds the correction from the published record. One click gives you corrected BibTeX." |
| 1:30–2:10 | Open the **Claims** tab. Click a **Supported** claim: citing sentence on top, highlighted evidence passages below. Then click a **Needs review** claim. | "Existence is only half the problem. A real paper can be cited for something it never said. Veracite retrieves relevant passages of the cited work, and a verifier running locally triages the claim. It shows those passages and uses calibrated thresholds; uncertain cases remain inconclusive. The evidence still needs a reader's judgement." |
| 2:10–2:25 | New audit → **Quick check** → drag the PDF onto the drop zone. Results appear; point at the **Check claim support** button. | "In a hurry? Quick check verifies the references without downloading any models and keeps claim support one click away." |
| 2:25–2:42 | Scroll to the benchmark section of the landing page. | "We measured all of this on public benchmarks. On the 104 references the five leading tools were tested on, Veracite reaches an F1 of 0.97; the best of them, 0.64. On the held-out HALLMARK test set it is the strongest system that needs no paid language model. Real papers are harder: in three blind audits of 42 new papers, about one reference in ten still raised a false alarm. That is why every flag shows its evidence." |
| 2:42–2:50 | Footer: "Runs locally. Only reference strings are sent to public scholarly indexes." Then the URL. | "Your paper never leaves your computer. Veracite is free, with source code on GitHub. Try it before you submit." |

Cut list (if over time): drop 2:10–2:25 first, then shorten 0:12–0:28 to one statistic.

On-screen text overlays (small, bottom left):
- 0:40 "Samples replay recorded index responses. Uploads use live lookups."
- 1:30 "Verifier: DeBERTa-v3, 4-bit, 102 MB, WebAssembly"
- 2:25 "Sources: Badalova & Mayr 2026; Reizinger et al. 2026. HALLMARK: historical frozen run."
