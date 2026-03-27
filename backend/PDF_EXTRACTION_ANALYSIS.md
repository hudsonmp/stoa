# PDF Extraction Quality Analysis: 10 Worked Examples

## Summary Table

| # | Paper | Format | Pages | 2-Col | Text Len | Title OK | Headers | Tables | Score | Key Issues |
|---|-------|--------|-------|-------|----------|----------|---------|--------|-------|------------|
| 1 | algorithmic-thinking | Springer OA | 22 | No | 85,235 | NO (Untitled) | 46 | 123 rows | 3 | No PDF title metadata; 21x running header; ligature breaks |
| 2 | clarifyGPT | ACM DL (wrapper) | 24 | No | 92,231 | Yes | 33 | 63 rows | 3 | ACM DL wrapper page cruft; 23x running footer; PUA chars |
| 3 | cs50-ai-harvard | ACM SIGCSE (2-col) | 7 | Yes | 36,459 | Yes | 29 | 0 | 4 | Author block concatenation (line 9); 6x venue header |
| 4 | defectsSE | Elsevier (2-col) | 15 | Yes | 74,730 | Yes | 38 | 46 rows | 3 | 15x "Specifcation" ligature; table header duplication; 5x title repeat |
| 5 | endUserSoftwareEngineering | ACM DL (wrapper) | 45 | No | 174,684 | Yes | 28 | 42 rows | 3 | ACM DL wrapper; 44x running header; 21x title repeat; PUA chars |
| 6 | gradRE | ACM SIGCSE (2-col) | 5 | Yes | 26,180 | Yes | 17 | 4 rows | 2 | SEVERE reading order; abstract interleaved; Figure 1 merged into single line; broken diacritics |
| 7 | metacognitive-demands | ACM CHI (2-col) | 24 | Yes | 172,485 | Yes | 25 | 89 rows | 4 | 21x "Confdence" ligature; running headers; but good structure overall |
| 8 | prompt-ambiguity | ACM/arXiv (2-col) | 13 | Yes | 63,525 | Yes | 21 | 33 rows | 4 | Minor: 6x running header; figure placeholder |
| 9 | prompt-programming-cmu | ACM PACM (single) | 24 | No | 103,202 | Yes | 31 | 38 rows | 4 | 24x running footer; picture text blocks handled; clean structure |
| 10 | llm-test-validation | IEEE (2-col) | 16 | Yes | 92,422 | Yes | 33 | 105 rows | 3 | Tables have cell content in `<br>` format; 21 image placeholders |


## Detailed Analysis Per Paper

### 1. algorithmic-thinking.pdf (Score: 3/5)
- **Format**: Springer Open Access, single-column
- **Title**: PDF metadata is EMPTY. Falls back to "Untitled PDF" -- unacceptable for a library system.
- **Headers**: Well-extracted (## format). 46 section headers captured.
- **Abstract**: Cleanly separated, readable.
- **Authors**: Extracted on line 11: `Xin Gong , Weiqi Xu and Ailing Qiao[1*]` -- footnote markers partially cleaned but `[1*]` remains in header region because header cleanup only operates on first 800 chars and this is at char ~700.
- **Running headers**: `Gong _et al. International Journal of Educational Technology in Higher Education_ (2025) 22:51` repeated 21x. `Page X of 22` markers 21x. Together ~3% overhead.
- **Tables**: Table 1 renders but with broken column headers (`Generalprompts`, `Advancedprompts` -- no spaces).
- **Ligatures**: 2x "specifc", 3x "efect", 1x "diferent", 1x "efcien" -- words with broken fi/ff/ffi ligatures.
- **What would fix it**: (a) Title fallback to first `##` header; (b) strip running headers; (c) ligature repair regex.

### 2. clarifyGPT.pdf (Score: 3/5)
- **Format**: ACM PACM:FSE, single-column, downloaded from ACM DL (has wrapper page)
- **Title**: Correct from PDF metadata.
- **ACM DL wrapper**: First page is ACM Digital Library metadata page, NOT the paper itself. Lines 1-28 contain ACM DL navigation elements: "Latest updates: hps://...", "PDF Download 3660810.pdf", "Total Citations: 29", "Total Downloads: 3537", Open Access logos, etc. This is pure noise for a research library.
- **Running footers**: `Proc. ACM Softw. Eng., Vol. 1, No. FSE, Article 103. Publication date: July 2024.` 23x. Also `ClarifyGPT: A Framework for Enhancing LLM-Based Code Generation via Requirements Clarification` 11x as running header.
- **PUA characters**: 4 Private Use Area chars (U+E03C, U+E039) from ACM DL font encoding, rendering as invisible chars.
- **Abstract**: Split across two logical pages. First part on DL wrapper, second on page 2. Duplicated.
- **Tables**: Render reasonably but with cell content compressed into `<br>` separated values.

### 3. cs50-ai-harvard.pdf (Score: 4/5)
- **Format**: ACM SIGCSE, two-column
- **Title**: Correct. Clean extraction of title + subtitle.
- **Authors**: Lines 3-7: Individual authors extracted well. BUT line 9 concatenates three column-adjacent authors: `Andrew Holmes Patrick Thornton David J. Malan Harvard University Harvard University Harvard University Cambridge, MA, USA Cambridge, MA, USA Cambridge, MA, USA...` -- this is a reading-order failure for the multi-column author block.
- **Abstract**: Clean, single paragraph, correctly separated.
- **Reading order**: Body text reads correctly -- pymupdf4llm handles CHI/SIGCSE two-column body well.
- **Running headers**: 6x `SIGCSE 2024, March 20-23, 2024, Portland, OR, USA` and 3x `Teaching CS50 with AI` as running headers.
- **Figures**: Image placeholders correctly placed with captions.

### 4. defectsSE.pdf (Score: 3/5)
- **Format**: Elsevier (Alexandria Engineering Journal), two-column
- **Title**: Correct from PDF metadata.
- **Tables**: Table 1 has a DUPLICATED header: `||Table 1<br>Result<br>techniques.|s of the compa|rative analysis|of reading||` -- the table caption text is being treated as table content and broken across cells.
- **Ligatures**: SEVERE. 15x "Specifcation" (should be "Specification"), 5x "refect" (should be "reflect"), 1x "diferent". This is a paper about requirements *specification* -- having the key term broken throughout is particularly bad.
- **Running headers**: 5x `Detecting defects in software requirements specification`.
- **Reading order**: Generally correct for body text, but the two-column layout causes some paragraph breaks at column boundaries.

### 5. endUserSoftwareEngineering.pdf (Score: 3/5)
- **Format**: ACM Computing Surveys, single-column, with ACM DL wrapper page
- **Title**: Correct from metadata.
- **ACM DL wrapper**: Same as clarifyGPT -- first page is ACM DL metadata. "Latest updates: hps://dl.acm.org/...", download stats, Open Access badges, institutional affiliations. Pure noise.
- **Running headers**: `ACM Computing Surveys, Vol. 43, No. 3, Article 21, Publication date: April 2011.` 44x (!). Plus `The State of the Art in End-User Software Engineering` 21x. Combined 7,040 chars = 4% of total text.
- **PUA characters**: 6 PUA chars (U+E039, U+E03C) from ACM DL font. The title on the wrapper page renders as `end-user so[U+E039]ware engineering` ("software" with invisible PUA char for "ft" ligature).
- **Structure**: Good section headers, but this is a 45-page survey -- the overhead from running headers is substantial.

### 6. gradRE.pdf (Score: 2/5)
- **Format**: ACM SIGCSE (2006), two-column, short paper (5 pages)
- **Title**: Correct from metadata.
- **READING ORDER FAILURE**: This is the worst extraction. The ABSTRACT header appears on line 12, but the abstract *text* is from the RIGHT column ("work professionally. These designs were collected...") while the actual abstract is on line 15 ("This paper examines software designs..."). The section "2. BACKGROUND" appears BEFORE "Categories and Subject Descriptors" and "1. INTRODUCTION" because pymupdf4llm processes the blocks in document order, which alternates between columns.
- **Figure 1**: The entire design brief (a full-page figure in the PDF) is collapsed into a SINGLE LINE (line 53) -- 1,800 characters with no line breaks. The section header "4. CATEGORIZATION METHODS" is tacked onto the end of this line.
- **Author block**: Line 4 concatenates two column-adjacent authors with their affiliations: `Robert McCartney Jan Erik Mostr¨om Department of Computer Department of Computing Science and Engineering Science University of Connecticut Ume˚a University Storrs, CT 06269 USA 901 87 Ume˚a, Sweden`.
- **Diacritics**: "Mostr¨om" (should be "Moström") -- U+00A8 diaeresis not handled by current cleanup. "Ume˚a" (should be "Umeå") -- U+02DA ring above not in diacritic map.
- **Table 1**: Renders but with artifacts: `|**1: Number of subjects in **|**scafolding**|` -- table header text is broken, and "scaffolding" has broken "ff" ligature ("scafolding").
- **Unicode garbage**: Line 53 contains `��� �� � �����` -- replacement characters from a figure/image that couldn't be extracted.

### 7. metacognitive-demands.pdf (Score: 4/5)
- **Format**: ACM CHI, two-column
- **Title**: Correct from metadata.
- **Reading order**: EXCELLENT despite two-column. pymupdf4llm handles this CHI paper's layout correctly. All numbered sections (1-4.3) are in correct order.
- **Tables**: Table 1 is a complex multi-row table that renders well in markdown with proper `|` separators. Table 3 also clean.
- **Ligatures**: 21x "Confdence" (should be "Confidence"), 4x "Refective"/"Reective" (should be "Reflective"), 9x "diferent", 7x "efect". This is a paper about *metacognition* and *confidence* -- having "Confdence" broken 21x is problematic for search and readability.
- **Running headers**: 23x `CHI '24, May 11-16, 2024, Honolulu, HI, USA`, 12x `Tankelevitch and Kewenig, et al.`, 11x paper title. Combined ~2,700 chars.
- **Footnotes**: Long footnote [1] (lines 54-55) correctly placed but occupies significant space.

### 8. prompt-ambiguity.pdf (Score: 4/5)
- **Format**: ACM/arXiv style, two-column
- **Title**: Correct (from metadata, truncated at 117 chars but `##` header has full title).
- **Structure**: Clean section numbering, abstract cleanly separated.
- **Reading order**: Correct for body text.
- **Tables**: Some tables have `|---|---|---|---|---|` separators with empty cells (4x), suggesting column count misalignment.
- **Ligatures**: 6x "efect", 1x "diferent" -- moderate.
- **Figures**: Image placeholders with captions correctly placed.
- **Running headers**: 6x venue header.

### 9. prompt-programming-cmu.pdf (Score: 4/5)
- **Format**: ACM PACM:FSE, single-column (no ACM DL wrapper -- direct download)
- **Title**: Correct from metadata.
- **Structure**: Excellent. Clean `##` headers with numbered sections. Figure text blocks extracted via `Start/End of picture text` markers (3 instances).
- **Reading order**: N/A (single-column). Clean flow.
- **Author block**: Clean: `JENNY T. LIANG, Carnegie Mellon University, USA` etc.
- **Running footers**: 24x `Proc. ACM Softw. Eng., Vol. 2, No. FSE, Article FSE072. Publication date: July 2025.` Plus 12x short author header, 11x paper title. ~4,000 chars total.
- **Tables**: Render well.
- **Page markers**: `FSE072:2`, `FSE072:3` etc. on each page -- these are ACM article markers, not standard page numbers, so the current `^\d{1,3}\s*$` regex doesn't catch them.

### 10. llm-test-validation.pdf (Score: 3/5)
- **Format**: IEEE Transactions style, two-column
- **Title**: Correct from metadata (truncated at 91 chars).
- **Tables**: 105 table rows extracted. Tables use `<br>` for multi-line cell content, making them hard to read: `|#Tests<br>VR<br>LC<br>MS<br>pass@1|`. Cell content for side-by-side comparisons gets compressed.
- **Figures**: 21 image placeholders -- this paper has many figures. Fig. 1 table with code examples renders but with broken cell structure (assert statements split across `<br>` tags within cells).
- **Reading order**: Generally correct for body text.
- **Equations**: No LaTeX math extracted. The paper has equations in the body that are rendered as inline text without math notation.
- **Picture text**: 2 blocks of OCR'd figure text, with broken formatting: `0 . 7<br>0 . 43<br>0 . 68` -- numbers from axis labels extracted with spaces around decimal points.


---

## A. Pattern Summary

### Papers that extract well (Score 4+):
- **ACM CHI format** (metacognitive-demands): Modern two-column, well-structured PDF encoding. pymupdf4llm handles reading order correctly.
- **ACM SIGCSE recent** (cs50-ai-harvard): Two-column but recent PDF generation produces correct block ordering.
- **ACM PACM single-column** (prompt-programming-cmu, prompt-ambiguity): Single-column or well-encoded two-column. Clean structure.

### Papers that extract poorly (Score 2-3):
- **Older ACM papers** (gradRE, 2006): Older PDF generators produce blocks in visual order rather than reading order, causing severe column interleaving.
- **ACM DL wrapper pages** (clarifyGPT, endUserSoftwareEngineering): PDFs downloaded from dl.acm.org include a metadata wrapper page that adds noise.
- **Elsevier** (defectsSE): Ligature encoding causes widespread word breakage.
- **IEEE** (llm-test-validation): Complex tables with multi-line cells render poorly.

### Quality predictors:
1. **PDF age/generator**: Post-2015 PDFs from major publishers have better text block ordering.
2. **Column layout**: Single-column always extracts well. Two-column varies by PDF encoding quality.
3. **ACM DL download method**: PDFs from dl.acm.org viewer have wrapper pages; direct PDF downloads don't.
4. **Publisher font encoding**: Elsevier and some ACM fonts use ligatures (fi, fl, ff, ft, ffi) that break on extraction.
5. **Table complexity**: Simple tables (2-3 columns, no spanning) extract well; complex tables with merged cells or multi-line content degrade.


---

## B. Top 5 Fixable Issues (Ranked by Impact)

### 1. Running Headers/Footers (affects 8/10 papers, ~2-4% text overhead)
**What**: Every page's header (venue, author abbreviated, paper title) and footer (page numbers, article IDs) get extracted into the body text.
**Impact**: Clutters reading, breaks text flow, inflates chunk count for embeddings, corrupts search results.
**Fix**: Post-processing regex to strip known patterns:

```python
# Strip ACM running footers
text = re.sub(r'^Proc\. ACM .*?Publication date: \w+ \d{4}\.\s*$', '', text, flags=re.MULTILINE)
# Strip CHI/SIGCSE venue headers
text = re.sub(r'^(CHI|SIGCSE|ICSE|ICER|AIED|NeurIPS|CSCW) .{10,60}(USA|Canada|UK|Germany|Australia)\.?\s*$', '', text, flags=re.MULTILINE)
# Strip author short headers (2-4 words followed by "et al.")
text = re.sub(r'^[A-Z][a-z]+ (?:and )?[A-Z][a-z]+,?\s*et al\.?\s*$', '', text, flags=re.MULTILINE)
# Strip repeated paper title lines (if same line appears 3+ times)
# (programmatic: count line frequencies, remove lines appearing > 2x that are > 20 chars)
# Strip ACM article markers like "FSE072:3", "103:2"
text = re.sub(r'^\w{2,10}:\d+\s*$', '', text, flags=re.MULTILINE)
# Strip "Page X of Y"
text = re.sub(r'^Page \d+ of \d+\s*$', '', text, flags=re.MULTILINE)
```

### 2. Ligature Breakage (affects 7/10 papers, corrupts key terms)
**What**: PDF fonts encode fi, fl, ff, ffi, ffl, ft as ligature glyphs. When extracted, these sometimes get dropped, producing broken words: "specifcation", "efect", "diferent", "Confdence", "refect", "efcien", "soware".
**Impact**: Breaks full-text search (searching "specification" won't find "specifcation"), degrades readability, confuses embeddings.
**Fix**: Post-processing regex to repair common broken words:

```python
# Comprehensive ligature repair
_LIGATURE_FIXES = {
    # fi ligature
    r'specifc': 'specific', r'Specifc': 'Specific',
    r'identif([^i])': r'identifi\1',  # but not "identify"
    r'classifc': 'classific', r'signicant': 'significant',
    r'Confdenc': 'Confidenc', r'confdenc': 'confidenc',
    r'beneft': 'benefit', r'defne': 'define', r'defnit': 'definit',
    r'scientifc': 'scientific',
    # fl ligature
    r'refect': 'reflect', r'Refect': 'Reflect',
    r'confct': 'conflict', r'infuenc': 'influenc',
    # ff ligature
    r'diferent': 'different', r'Diferent': 'Different',
    r'([^d])efect': r'\1effect',  # but not "defect"
    r'afect': 'affect', r'oferr': 'offerr',
    # ffi ligature
    r'efcien': 'efficien', r'Efcien': 'Efficien',
    r'difcult': 'difficult',
    # ft ligature (rare, from ACM DL wrapper)
    r'soware': 'software',
}
# Apply after cleaning PUA characters:
text = re.sub(r'[\uE000-\uF8FF]', '', text)
for pattern, replacement in _LIGATURE_FIXES.items():
    text = re.sub(pattern, replacement, text)
```

### 3. ACM Digital Library Wrapper Pages (affects 2/10 papers, but common pattern)
**What**: PDFs downloaded from dl.acm.org's web viewer include a metadata wrapper page with navigation elements, download stats, citation counts, institutional Open Access badges, etc. This adds 20-40 lines of noise at the start.
**Impact**: Title may appear duplicated, author lists appear twice (DL format + paper format), navigation elements pollute extracted text.
**Fix**: Detect and skip the wrapper page:

```python
def _strip_acm_dl_wrapper(text: str) -> str:
    """Remove ACM Digital Library wrapper page content."""
    markers = ['Latest updates:', 'Total Citations:', 'Total Downloads:',
               'PDF Download', 'Citation in BibTeX format', 'Open Access Support']
    lines = text.split('\n')
    # Find the end of the wrapper section (look for the first ## header that
    # appears AFTER the wrapper markers)
    wrapper_end = 0
    found_marker = False
    for i, line in enumerate(lines):
        if any(m in line for m in markers):
            found_marker = True
        if found_marker and i > 10 and line.startswith('## ') and 'RESEARCH-ARTICLE' not in line:
            # This is likely the real paper title
            # But we need the ACM reference format block too
            # Skip to the first real content section
            wrapper_end = i
            break
    if wrapper_end > 0 and found_marker:
        # Find the duplicate title (paper body starts with same title as wrapper)
        # Keep the body version, drop the wrapper
        return '\n'.join(lines[wrapper_end:])
    return text
```

### 4. Broken Diacritics (affects 1-2/10 papers, but critical for author names)
**What**: Author names with diacritics get broken: "Mostr¨om" (should be "Moström"), "Ume˚a" (should be "Umeå"). The current `_DIACRITIC_MAP` uses ASCII quote characters (`"o`), but actual PDFs use Unicode diacritic marks (U+00A8 diaeresis, U+02DA ring above).
**Impact**: Author names are wrong, which affects people-linking in Stoa.
**Fix**: Expand the diacritic map to include Unicode combining marks:

```python
# Add to _DIACRITIC_MAP:
"\u00A8a": "\u00e4",  # ¨a → ä
"\u00A8e": "\u00eb",  # ¨e → ë
"\u00A8o": "\u00f6",  # ¨o → ö
"\u00A8u": "\u00fc",  # ¨u → ü
"\u00A8A": "\u00c4",  # ¨A → Ä
"\u00A8O": "\u00d6",  # ¨O → Ö
"\u00A8U": "\u00dc",  # ¨U → Ü
"\u02DAa": "\u00e5",  # ˚a → å
"\u02DAA": "\u00c5",  # ˚A → Å
"\u00B4i": "\u00ed",  # ´i → í (acute, different codepoint)
"\u00B4e": "\u00e9",  # ´e → é
"\u00B4a": "\u00e1",  # ´a → á
"\u00B4o": "\u00f3",  # ´o → ó
"\u00B4u": "\u00fa",  # ´u → ú
```

### 5. Title Fallback for PDFs Without Metadata (affects 1/10 but common for Springer/arXiv)
**What**: `algorithmic-thinking.pdf` has no PDF title metadata. The current code falls back to "Untitled PDF", which is useless.
**Impact**: Item appears in library with no meaningful title.
**Fix**: Extract title from first `##` header in the markdown, or from the first non-blank line of text:

```python
def _extract_title_from_text(markdown: str) -> str:
    """Extract paper title from markdown when PDF metadata is missing."""
    for line in markdown.split('\n'):
        line = line.strip()
        # Skip image placeholders
        if 'intentionally omitted' in line or not line:
            continue
        # Skip very short lines (journal name, page markers)
        if len(line) < 10:
            continue
        # Use first substantial ## header as title
        if line.startswith('## '):
            title = line[3:].strip()
            # Skip generic headers like "Open Access", "RESEARCH-ARTICLE"
            if title.upper() not in ('OPEN ACCESS', 'RESEARCH-ARTICLE', 'ORIGINAL ARTICLE'):
                return title
        # Or use first substantial text line
        if len(line) > 20 and not line.startswith(('>', '|', '*', '-', '!')):
            return line[:200]
    return "Untitled PDF"
```


---

## C. Recommended Extraction Strategy

### Current approach: pymupdf4llm for everything
**Verdict**: Adequate for 6/10 papers. Needs post-processing for the other 4.

### Recommendations:

1. **Keep pymupdf4llm as the primary extractor.** It handles modern (post-2015) PDF layouts well, including two-column papers from ACM CHI, SIGCSE, and IEEE. No alternative tool consistently outperforms it for academic papers.

2. **Add a robust post-processing pipeline** (the 5 fixes above). This would raise scores from average 3.3 to estimated 4.0.

3. **Detect and strip ACM DL wrapper pages** before extraction or during post-processing. These are identifiable by the presence of "Latest updates:" and "Total Citations:" in the first page.

4. **For older papers (pre-2010) with two-column layout**, consider a fallback strategy:
   - After pymupdf4llm extraction, check if sections appear out of order (e.g., "2. BACKGROUND" before "1. INTRODUCTION")
   - If detected, re-extract using column-aware splitting: process left column first, then right column, using block x-coordinates
   - This would fix the gradRE-type failures

5. **Do NOT switch to a different tool for specific publishers.** The issues are not publisher-specific but encoding-specific. The same publisher (ACM) produces both good (metacognitive-demands) and poor (gradRE) extractions depending on the PDF generation era.

6. **IEEE tables need special handling.** Consider a table-detection pass that identifies tables with `<br>` in cells and reformats them into cleaner markdown.


---

## D. Specific Regex/Cleanup Rules

### Rules to add to `_clean_pdf_markdown()`:

```python
def _clean_pdf_markdown(text: str) -> str:
    """Clean common artifacts from pymupdf4llm markdown output."""

    # === EXISTING RULES (keep) ===
    # ... (current implementation) ...

    # === NEW RULES ===

    # 1. Strip Private Use Area characters (ACM DL font ligatures)
    text = re.sub(r'[\uE000-\uF8FF]', '', text)

    # 2. Fix ligature-broken words
    _LIGATURE_FIXES = [
        (r'(?i)\bspecifc', lambda m: m.group().replace('specifc', 'specific').replace('Specifc', 'Specific')),
        (r'(?i)\bconfdenc', lambda m: m.group().replace('confdenc', 'confidenc').replace('Confdenc', 'Confidenc')),
        (r'(?i)\brefect', lambda m: m.group().replace('refect', 'reflect').replace('Refect', 'Reflect')),
        (r'(?i)\bdiferent', lambda m: m.group().replace('diferent', 'different').replace('Diferent', 'Different')),
        (r'(?i)\befcien', lambda m: m.group().replace('efcien', 'efficien').replace('Efcien', 'Efficien')),
        (r'(?i)\bsoware', lambda m: m.group().replace('soware', 'software').replace('Soware', 'Software')),
        (r'(?i)\bidentifcat', lambda m: m.group().replace('identifcat', 'identificat')),
        (r'(?i)\bsignicant', lambda m: m.group().replace('signicant', 'significant')),
        (r'(?i)\bscientifc', lambda m: m.group().replace('scientifc', 'scientific')),
    ]
    for pattern, repl in _LIGATURE_FIXES:
        text = re.sub(pattern, repl, text)

    # Simpler approach (string replacement):
    for broken, fixed in [
        ('specifc', 'specific'), ('Specifc', 'Specific'),
        ('confdenc', 'confidenc'), ('Confdenc', 'Confidenc'),
        ('refect', 'reflect'), ('Refect', 'Reflect'),
        ('diferent', 'different'), ('Diferent', 'Different'),
        ('efcien', 'efficien'), ('Efcien', 'Efficien'),
        ('soware', 'software'), ('Soware', 'Software'),
        ('signicant', 'significant'), ('Signicant', 'Significant'),
        ('scientifc', 'scientific'), ('Scientifc', 'Scientific'),
        ('identifcat', 'identificat'), ('classifc', 'classific'),
    ]:
        text = text.replace(broken, fixed)

    # 3. Extended diacritic map (Unicode marks, not just ASCII)
    _EXTENDED_DIACRITICS = {
        "\u00A8a": "\u00e4", "\u00A8e": "\u00eb", "\u00A8o": "\u00f6",
        "\u00A8u": "\u00fc", "\u00A8A": "\u00c4", "\u00A8O": "\u00d6",
        "\u00A8U": "\u00dc", "\u02DAa": "\u00e5", "\u02DAA": "\u00c5",
        "\u00B4a": "\u00e1", "\u00B4e": "\u00e9", "\u00B4i": "\u00ed",
        "\u00B4o": "\u00f3", "\u00B4u": "\u00fa",
    }
    for raw, fixed in _EXTENDED_DIACRITICS.items():
        text = text.replace(raw, fixed)

    # 4. Strip ACM DL wrapper page content
    if 'Latest updates:' in text[:500] or 'Total Citations:' in text[:1000]:
        lines = text.split('\n')
        # Find where the actual paper content starts (second ## header that isn't metadata)
        header_count = 0
        cut_line = 0
        for i, line in enumerate(lines):
            if line.startswith('## ') and line[3:].strip().upper() not in (
                'RESEARCH-ARTICLE', 'ORIGINAL ARTICLE', 'OPEN ACCESS',
                'VIEW ALL', ''
            ):
                header_count += 1
                if header_count == 2:  # Second real header = paper body title
                    cut_line = i
                    break
        if cut_line > 5:
            text = '\n'.join(lines[cut_line:])

    # 5. Strip running headers (deduplicate lines appearing 3+ times, >20 chars)
    lines = text.split('\n')
    line_counts = {}
    for line in lines:
        stripped = line.strip()
        if len(stripped) > 20:
            line_counts[stripped] = line_counts.get(stripped, 0) + 1
    repeated = {k for k, v in line_counts.items() if v >= 3}
    if repeated:
        lines = [l for l in lines if l.strip() not in repeated]
        text = '\n'.join(lines)

    # 6. Strip "Page X of Y" markers
    text = re.sub(r'^Page \d+ of \d+\s*$', '', text, flags=re.MULTILINE)

    # 7. Strip ACM article page markers (e.g., "FSE072:3", "103:2")
    text = re.sub(r'^\w{2,10}:\d{1,3}\s*$', '', text, flags=re.MULTILINE)

    # === EXISTING FINAL CLEANUP (keep) ===
    # Collapse excessive blank lines
    text = re.sub(r'\n{4,}', '\n\n\n', text)
    text = "\n".join(line.rstrip() for line in text.split("\n"))

    return text.strip()
```

### Title fallback rule (modify `extract_from_pdf`):

```python
title = meta.get("title") or _extract_title_from_text(markdown_text)
```
