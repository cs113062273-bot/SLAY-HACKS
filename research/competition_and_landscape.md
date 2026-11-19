# SLAY HACKS 2026: research notes (gathered 2026-11-18)

## Competition facts (source: slayy-hacks.devpost.com, /rules, /resources)
- Online, Devpost-hosted global AI hackathon. Nov 7 – **Dec 7, 2026 5:00pm EST** submission deadline. Judging Dec 8–14, winners Dec 16.
- Eligibility: above age of majority, **students only**, companies excluded. Teams or individuals.
- Prizes: Grand $2,000 · Runner-up $1,200 · 3rd $800 · Best Beginner $500 (first-time hackathon teams only).
- 364 participants at time of research. Gallery unpublished. Devpost host handle: "cite & slayy". Tags: Beginner Friendly, Open Ended, ML/AI.
- Theme: any original project that uses AI meaningfully for a real problem (education, healthcare, sustainability, productivity, GenAI, agents, responsible AI…).
- Two rubrics are published (both should be satisfied):
  - Overview/rules: Innovation & Originality 25 · Technical Implementation 25 · Real-World Impact 20 · AI Integration & Responsible Use 15 · UX & Presentation 15.
  - Devpost judging criteria widget: Innovation & Creativity 30 · Technical Execution & Complexity 30 · Design & UX 20 · Presentation & Impact 20 (incl. "Is the project fully deployable and practical for end-users?").
- Submission must include: name+overview, problem & solution, AI implementation (models/frameworks), **working demo link** (+access instructions), screenshots, **source repo with docs/setup**, 2–4 min video (recommended).
- Rules: disclose significant limitations & external dependencies; descriptions must accurately represent functionality (misrepresentation = DQ); third-party APIs/OSS/models allowed under licenses.
- Organizer-listed resources: OpenAI, HF, Google AI Studio, PyTorch, TF, LangChain, LlamaIndex, CrewAI, Semantic Kernel, Vercel, Netlify, Streamlit, Figma… No free credits offered → zero-budget means local/in-browser/open models only.

## Judge
- Only listed judge: "Dr. Aliza Bano — Researcher and Educator". Best public match: PhD scholar/researcher (Jaipur, India) working on AI (ML, NLP, anomaly detection) + permissioned blockchain for forensic-accounting fraud detection; building "Azora AI" to "make research less overwhelming and more intelligent".
- Implications: values research workflows, fraud/anomaly detection framing, explainability/evidence, educational use. Host handle "cite & slayy" also hints at a citation/research culture.

## Why citation integrity (decision rationale)
- Real, measured, worsening problem: Topaz et al. (Lancet) — papers with ≥1 fabricated reference rose 1/2,828 (2023) → 1/458 (2025) → 1/277 (early 2026). GPTZero: 100 fabricated citations in 53 accepted NeurIPS 2025 papers; 50+ in ICLR 2026 submissions; ACL 2026 >100 accepted papers with nonexistent citations; Deloitte AU refunded AUD 98k; MAHA report.
- Fits the judge (researcher+educator, anti-fraud anomaly detection), host name, and all rubric lines (impact, responsible AI = "AI auditing AI", technical depth).

## Competitor landscape & their measured weaknesses
### Existence/metadata checkers — Badalova & Mayr, arXiv:2607.22693 (Zenodo 10.5281/zenodo.21457492; 104 refs, 33 problematic)
| Tool | TP | FN | FP | TN | Recall | Spec | Prec | F1 |
|---|---|---|---|---|---|---|---|---|
| CheckIfExist | 31 | 2 | 34 | 37 | .939 | .521 | .477 | .633 |
| HalluCiteChecker | 18 | 15 | 20 | 51 | .545 | .718 | .474 | .507 |
| Hallucinator | 29 | 4 | 28 | 43 | .879 | .606 | .509 | .644 |
| HalRef | 24 | 9 | 53 | 18 | .727 | .254 | .312 | .436 |
| RefChecker | 32 | 1 | 36 | 35 | .970 | .493 | .471 | .634 |
- Failure causes: bad PDF reference extraction, BibTeX formatting sensitivity, limited DB coverage, API limits, setup burden (GROBID), **false positives on valid refs (software, standards, websites, unindexed works)**.
- HalluCiteChecker: title-only fuzzy match (RapidFuzz ≥0.9) over local ACL/arXiv/DBLP; no field checks, no claim support.
- GPTZero Hallucination Check: commercial, web search + DB lookup; third-party benchmark claims 62.8% recall (disputed). Paid tiers.
- Others: RefChecker (Russinovich; LLM-assisted, "advisory only"), CheckIfExist, Hallucinator, HalRef, CiteSleuth (Rust), CiteTrue, CiteStamp, AiCitationChecker, Acurio (existence+retraction+support, commercial), citefact (PyPI; LLM claim check costs per source), CiteGuard (npm), scite (smart citations), Anara/Manusights (claim vs supplied passages).

### Fabrication taxonomy — Ansari, arXiv:2602.05930 (100 NeurIPS 2025 fabrications)
- Primary: Total Fabrication 66%, Partial Attribute Corruption 27%, Identifier Hijacking 4%, Placeholder 2%, Semantic 1%.
- **100% compound**: secondary = Semantic plausibility 63%, Identifier Hijacking 29% (valid arXiv ID/DOI pointing to a different real paper).
- ⇒ Must cross-verify title+authors+venue+year+identifier all resolve to the SAME record. Contamination Inheritance: fabricated refs copied from other papers' v1.

### Claim-support (content-level) verification
- Sarol et al. 2024 Bioinformatics (Citation-Integrity corpus, github ScienceNLP-Lab/Citation-Integrity): 3,063 citations to 100 PMC OA articles; 39% erroneous. Labels collapsed to ACCURATE / NOT_ACCURATE / IRRELEVANT. Best MultiVerS (top-20 BM25+MonoT5 sentences) micro .59 / **macro .52**; GPT-4 ICL micro .65 / macro .45 (N_ACC F1 only .09). Retrieval R@20 = .55 (bottleneck). Oracle evidence → macro .78.
- He et al. arXiv:2608.30145 "Claim normalization" (CNCV): normalize citing claim (scope, perspective, proposition entanglement) before retrieval → +12% macro-F1 encoders, +10% LLMs; evidence quality is the dominant factor.
- SemanticCite dataset (HF sebsigma, 1,111 pairs, 4 labels, CC-BY-NC, LLM-labelled).
- MiniCheck (Tang, Laban, Durrett EMNLP'24): small grounded fact-checkers (Flan-T5-L 770M ≈ GPT-4 on LLM-AggreFact; also RoBERTa-L / DeBERTa-L variants).

## Free infrastructure (CORS checked 2026-11-18)
- CORS OK: Crossref (reliable), Semantic Scholar (anonymous → frequent 429), OpenAlex (singleton by DOI fine; anonymous search paused under load; free key available), Europe PMC, NCBI eutils (3 rps), doi.org handles API, **arxiv.org/pdf (ACAO *)**, Unpaywall (needs email param).
- No CORS: export.arxiv.org API, DBLP.
- Local HW: RTX 3060 Laptop 6 GB, i7-12700H, 16 GB RAM; Python 3.11 + torch 2.7.1; Node 24.
