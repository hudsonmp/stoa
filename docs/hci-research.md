# HCI Research: Reading Tools, Annotation, and Knowledge Management

Literature review for Stoa interaction design. Organized by five research areas with citations, key findings, and design principles.

---

## 1. Active Reading and Annotation UX

### Key Literature

**Marshall, C.C. (1998). "Toward an Ecology of Hypertext Annotation." Proc. ACM Hypertext '98.** (Engelbart Best Paper Award)

Marshall's taxonomy of annotations from studying used textbooks identifies dimensions that remain definitive for digital annotation design:
- **Formal vs. informal**: Structured tags through to personal marginalia
- **Transient vs. permanent**: Useful only during reading vs. valuable to future readers
- **Private vs. published**: Personal processing marks vs. shared annotations
- **Global vs. personal**: Annotations meaningful to anyone vs. tied to individual context

Key finding: Most annotations are *telegraphic* -- shorthand that means something only in context. Annotation tools that force explicitness (structured forms, required fields) fight against natural reading behavior. The most common annotations are marks that signal attention (underlines, vertical bars) rather than articulate thoughts.

Design implication for Stoa: The highlight-first, note-optional flow is correct. But Stoa currently treats all highlights identically -- no distinction between "this caught my eye" and "this is a key argument I need to remember."

**Marshall, C.C. (2010). *Reading and Writing the Electronic Book.* Morgan & Claypool.**

Extends the annotation work to ebooks. Documents how digital reading loses the spatial memory of physical pages -- readers remember *where* on a page something was, and this is a powerful retrieval cue that most digital tools destroy. Also covers annotation portability problems: highlights trapped in vendor silos (Kindle, Apple Books) with no interoperability.

**Sellen, A.J. & Harper, R.H.R. (2002). *The Myth of the Paperless Office.* MIT Press.**

Paper's affordances that digital tools still fail to replicate:
- **Quick, flexible navigation**: Flipping, fanning, spatial memory of page position
- **Simultaneous multi-document reading**: Spreading papers across a desk
- **Interweaving reading and writing**: Annotating in margins without mode-switching
- **Spatial organization**: Piling documents in meaningful arrangements

The authors argue paper succeeds because it supports *lightweight* interaction -- the cognitive cost of marking a margin is near zero. Digital annotation tools that require selection > toolbar > color > confirm impose serial interaction overhead that disrupts reading flow.

**Adler, M.J. & Van Doren, C. (1972). *How to Read a Book.* Simon & Schuster.**

Four levels of reading, each demanding different annotation support:
1. **Elementary**: Basic comprehension (no annotation needed)
2. **Inspectional**: Skimming for structure -- needs structural notes (outline, table of contents annotation)
3. **Analytical**: Deep single-text engagement -- needs conceptual notes (interpretive marginalia, questions, connections)
4. **Syntopical**: Cross-text comparison -- needs dialectical notes (comparing arguments across sources)

Three types of note-making: structural (outlining), conceptual (interpreting), dialectical (debating with text). Most annotation tools support only conceptual notes. Syntopical reading -- comparing multiple sources on a topic -- has almost no tool support.

Design implication for Stoa: The collections feature could map directly to syntopical reading projects. A collection isn't just "articles I liked" -- it's a reading project where you compare and synthesize across sources.

### Tool Analysis: Highlight Creation Flows

**Kindle**: Press-hold > drag > release. Color picker appears post-selection. Note is a separate step (tap highlight > "Add Note"). Friction: two taps to add a note to a highlight. Export is locked down -- Amazon limits copy volume.

**Readwise Reader**: "Auto-highlighting" -- any text selection immediately becomes a highlight, simulating a physical highlighter. No extra click to confirm. Notes attach via inline threaded comments (social-media-style). Keyboard shortcuts for power users. Philosophy: "Highlighting is a first-class feature, not a bolted-on afterthought."

**Hypothesis**: Sidebar drawer model. Selection > toolbar appears inline > highlight or annotate. Annotations are threaded, social (visible to groups/public). Uses W3C Web Annotation standard with three selector types (TextQuoteSelector, TextPositionSelector, RangeSelector) for robust re-anchoring when pages change.

**LiquidText** (Tashman & Edwards, CHI 2011): Multitouch environment where excerpts are pulled *out* of documents into a workspace. Annotations link multiple referents across texts. 10/18 study participants used comments to summarize and connect ideas. The key insight: annotation should be *spatial* -- positioned in a workspace, not just attached inline.

**Polar Bookshelf**: "Pagemarks" for tracking reading progress (inspired by SuperMemo incremental reading). Annotations on PDF/web content flow directly into Anki-compatible flashcards via right-click menu. Bridging annotation and spaced repetition in one tool.

**Stoa's current flow**: Selection > floating toolbar with 5 color buttons + "Note" button. Note replaces toolbar with inline text input. Single-step for color highlights, two-step for notes. No keyboard shortcut for highlighting. No way to add a note to an existing highlight. No way to change highlight color after creation.

### Highlight Review and Retrieval

The critical gap in most tools: highlights are easy to create and hard to find again.

**Readwise** solves this with daily email/app review sessions using spaced repetition. Users can weight books/articles up or down. "Themed Reviews" let you create topic-specific review sets pulling from tags across all sources. The algorithm uses a recall probability half-life (not date-based intervals like Anki).

**Kindle**: "My Clippings" file and read.amazon.com. Flat chronological list. No search, no filtering by color, no connection to original context. Widely regarded as inadequate.

**Hypothesis**: Annotations are stored server-side with full-text search. Users can view all their annotations or filter by URL, group, or tag. The social layer means you can also discover others' annotations on the same document.

### Design Principles Extracted

1. **Zero-friction capture**: The moment of insight during reading is fleeting. Every additional click between noticing and marking is a lost annotation. Readwise's auto-highlight is the gold standard.
2. **Progressive depth**: Most annotations should be lightweight (just a mark). A smaller fraction get notes. An even smaller fraction become synthesis. The UI should support this power law without forcing depth.
3. **Spatial context preservation**: Highlights stripped of surrounding context are much harder to recall. Marshall's and Sellen/Harper's work both show spatial memory is a key retrieval cue.
4. **Separation of capture and processing**: Capture during reading should be fast. Processing (adding notes, connecting ideas, synthesizing) should happen in a separate mode/session. Mixing them disrupts reading flow.

---

## 2. Knowledge Management Interaction Patterns

### Key Literature

**The Collector's Fallacy (Tietze, 2014, zettelkasten.de)**

Core argument: "'To know about something' isn't the same as 'knowing something.'" Saving links, bookmarking articles, and downloading PDFs creates an illusion of learning. Digital tools amplify this because the marginal cost of saving is zero. The proposed solution: Research > Read > Assimilate in tight cycles. Process collected material completely before gathering more.

Stoa is particularly vulnerable to this. Its primary interaction is "save to library" -- the ingest pipeline, the Chrome extension, the bookshelf UI all optimize for *acquisition*. There is no corresponding mechanism to surface unprocessed items, prompt engagement, or track whether saved items were actually read and synthesized.

**Luhmann's Zettelkasten (Ahrens, 2017. *How to Take Smart Notes.*)**

The slip-box method's key design principle: *connections* between notes matter more than individual notes. Each note gets a unique ID. Notes link to each other. The structure emerges bottom-up from links, not top-down from categories. Luhmann published 70+ books using this method.

Design implication: Stoa has `notes` table and `person_connections` table but no note-to-note links. No bidirectional linking. No way to surface connections between highlights across different items.

**Forte, T. (2022). *Building a Second Brain.* Atria Books.**

Progressive Summarization technique: highlights are distilled in layers -- Layer 1 (captured passage), Layer 2 (bold the key points), Layer 3 (highlight the bolded), Layer 4 (executive summary), Layer 5 (remix into new work). Each layer is ~20% of the previous. The key insight: distillation should happen *just-in-time* when you need the information, not upfront.

The PARA organizational method: Projects, Areas, Resources, Archive. Actionability determines category, not topic. This is orthogonal to Stoa's current organization (by content type and reading status).

### Spatial vs. Hierarchical Organization

**Pak et al. (2007). "Information Organization and Retrieval: A Comparison of Taxonomical and Tagging Systems." Clemson University.**

Hierarchical folder structures leverage spatial and episodic memory but impose cognitive load when hierarchies are deep. Tagging systems are less demanding of working memory and spatial ability because they're non-hierarchical. However, tags accumulate without structure and become unwieldy.

**Hybrid approach (empirically supported)**: Use folders for high-level categories and tags for cross-cutting associations. This maps to how memory works -- both hierarchical (semantic memory) and associative (episodic memory).

Stoa currently has: content type (book/blog/paper/podcast/etc.), reading status (to_read/reading/read), tags, collections, and people. The people-as-organization dimension is distinctive -- but there's no UI for navigating by tag, and collections have no API.

### Bidirectional Linking and Transclusion

**Roam Research** pioneered block-level bidirectional links in consumer tools. Every `[[page reference]]` automatically creates a backlink on the target page. Block-level transclusion (embedding a bullet from one page into another) supports non-linear writing.

**Obsidian** stores notes as local Markdown with `[[wiki-links]]`. Graph visualization of connections. Plugin ecosystem for customization. Key advantage: data ownership (local files, no vendor lock-in).

Design implication for Stoa: The `notes` table could support bidirectional links between notes and between notes and highlights. The `person_items` and `person_connections` tables already provide a graph structure -- but the webapp has no graph visualization to exploit this.

### Key Figures

**Andy Matuschak**: Researcher on tools for thought. Key contribution: the "mnemonic medium" (with Michael Nielsen) embedding spaced repetition into narrative prose. His public working notes (notes.andymatuschak.org) are themselves a demonstration of networked knowledge. Key insight: "The critical thing to optimize in spaced repetition memory systems is emotional connection to the review session and its contents."

**Michael Nielsen**: Co-creator of Quantum Country. Key contribution: arguing that *culture* matters more than *tools* for memory system adoption. "Tool-building companies have a strong incentive to claim they invented the magic secret sauce, when actually tools are downstream of cultural development." Recommends building communities of practice before building better software.

**Bret Victor**: "Explorable Explanations" (2011). Key argument: reading should be *active* -- text enriched with interactive handles that let the reader play with the author's assumptions. "Reactive documents" integrate spreadsheet-like models into authored text. The reader's "line of thought remains internal and invisible" in conventional reading -- tools should make thinking external and manipulable.

### Design Principles Extracted

1. **Surface unprocessed items**: The save > process > synthesize pipeline needs explicit UI stages. Items saved but never highlighted, highlighted but never noted, noted but never connected -- each represents a different level of engagement that should be visible.
2. **Connections over collections**: The value of a knowledge base grows with the density of connections, not the volume of items. Link highlights to highlights, notes to notes, people to ideas.
3. **Just-in-time processing**: Don't force users to fully process everything on capture. But do surface items for processing at appropriate moments (spaced repetition for highlights, "you saved this 2 weeks ago and haven't opened it" nudges).
4. **Hybrid organization**: Support both hierarchical (collections, projects) and associative (tags, people, links) navigation.

---

## 3. Spaced Repetition UX

### Key Literature

**Bjork, R.A. & Bjork, E.L. (1992, 2011). "Desirable Difficulties in Learning."**

The foundational framework. Distinguishes storage strength (how deeply information is encoded) from retrieval strength (how easily it's accessed now). Desirable difficulties *reduce* retrieval strength to increase storage strength. Implications:
- Spacing: 10-30% better retention than massed practice
- Retrieval practice: 50% better long-term recall vs. restudying
- Interleaving: Mixing topics during review improves transfer
- Variation: Changing the format/context of review strengthens encoding

UI implication: Making review *too easy* (showing the highlight with full context, author, date) reduces learning. Some friction is pedagogically valuable. But too much friction causes abandonment. The design challenge is calibrating difficulty.

**Matuschak, A. & Nielsen, M. (2019). "How can we develop transformative tools for thought?"**

The "mnemonic medium" embeds spaced repetition prompts directly into reading material. Key findings from Quantum Country:
- Expert-authored prompts remove the burden of prompt-writing (biggest adoption barrier)
- Interleaved prompts push readers to read more slowly and attentively
- Prompts create a "feeling of safety" -- readers know review sessions will arrive to solidify understanding
- Knowledge appears "brittle" -- doesn't transfer well to novel contexts
- Cloze deletions produce less understanding than question-answer pairs in non-technical texts
- The medium is "implicitly authoritarian" -- assumes the author knows what's worth remembering

Open question: Should Stoa auto-generate review prompts from highlights, or require user-authored prompts? The mnemonic medium research suggests expert-authored prompts are better, but Stoa's highlights are user-selected, which provides some intent signal.

**Matuschak, A. (2020). "How to write good prompts: using spaced repetition to create understanding."**

Prompt quality taxonomy:
- **Focused**: One discrete concept per prompt
- **Precise**: Unambiguous expected answer
- **Consistent**: Same retrieval path each time
- **Tractable**: ~90% accuracy target
- **Effortful**: Requires genuine memory retrieval, not trivial inference

Prompt types: factual recall, conceptual understanding (attributes, similarities/differences, causes/effects, significance), open lists, salience prompts ("keep ideas top of mind until they connect to your life").

Anti-patterns: Yes/no questions, orphan prompts disconnected from context, excessive scope per prompt, cloze deletions in non-technical content.

### Tool Analysis: Review Card Presentation

**Anki**: Minimalist card-flip interface. Front > think > reveal back > rate (Again/Hard/Good/Easy). FSRS algorithm (replacing SM-2) uses machine learning to predict optimal intervals. Scheduling is transparent -- users can see next review dates, interval lengths, card statistics. The interface "looks like it hasn't been updated since 2012" -- but the algorithm is state-of-the-art.

**RemNote**: Notes and flashcards are the same objects. Highlighting key concepts in notes auto-generates flashcards. Knowledge is organized hierarchically with interlinks. FSRS support added. Key UX advantage: no context switch between note-taking and review.

**Readwise**: Daily Review surfaces highlights with feedback buttons (Later/Soon/Eventually). Themed Reviews allow topic-specific sessions. The algorithm uses recall probability half-life rather than fixed intervals. Users can weight sources up/down. Philosophy: review should feel like "re-encountering" material, not studying.

**Quantum Country (Matuschak & Nielsen)**: Review prompts embedded inline in the essay. Users answer while reading. Subsequent review sessions pull from all essays read. The medium generates "exponential returns in memory stability" -- 2 years of data showing this. But adoption remains limited.

**Content-Aware SR (Morandin, 2024)**: Uses embeddings to identify semantically similar cards and incorporate their review histories into predictions. Key insight: reviewing related material reinforces understanding of interconnected concepts ("priming effect"). This decouples review from fixed card IDs -- cards can be edited without disrupting scheduling history.

**Stoa's current implementation**: Half-power law scheduler with fixed base intervals [1, 6, 24, 72, 168, 720, 2160 hours]. 4-point rating (forgot/hard/good/easy). Auto-enqueues every highlight for review at 24h. No prompt generation -- the review card is presumably the raw highlight text. No themed reviews. No weighting. No integration with reading flow.

### Scheduling Transparency

Should users see the algorithm? Research suggests a middle ground:
- **Anki/FSRS**: Full transparency. Users see interval history, next review date, card statistics. Power users optimize their parameters. But this creates anxiety ("am I doing it right?") and cognitive overhead.
- **Readwise**: Minimal transparency. Users see feedback buttons, not scheduling math. The system "just works." Lower anxiety, higher compliance, but less user agency.
- **Quantum Country**: Zero transparency. Prompts appear; users answer. No scheduling UI at all. Lowest friction, but users have no sense of control.

Design implication for Stoa: Given the target user (researchers), moderate transparency is appropriate. Show *when* a card is next due and *why* (difficulty level, review count), but don't expose the scheduling formula.

### Design Principles Extracted

1. **Desirable difficulty, not arbitrary difficulty**: Show the highlight text without context first. Reveal context (source, surrounding paragraph, author) only after the user attempts recall. This applies Bjork's retrieval practice principle.
2. **Integration over separation**: Review shouldn't feel like a separate chore. Embed review prompts into the reading/browsing experience where possible (e.g., show a review card when opening the library).
3. **Themed review**: Let users create topic-specific review sessions pulling from collections, tags, or people. A researcher reviewing for a literature review needs different highlights surfaced than during general browsing.
4. **Content-aware scheduling**: Use Stoa's existing embeddings to identify semantically related highlights and adjust scheduling based on review of related material.

---

## 4. Social Reading

### Key Literature

**Zhu et al. (2024). "Examining the Role of Peer Acknowledgements on Social Annotations." CHI 2024.**

Digital social annotation has evolved into a dynamic arena for CSCL (computer-supported collaborative learning). Peer acknowledgments (likes, replies on annotations) significantly affect annotation behavior. Students with higher overall motivation preferred social annotation over quizzes.

**Cui et al. (2024). "Empowering Active Learning: A Social Annotation Tool for Improving Student Engagement." British Journal of Educational Technology.**

Pre-class social annotations positively impact post-class assessment performance. The social visibility of annotations creates accountability and deeper engagement than private annotation.

**Perusall Research (Miller et al., various)**

Social annotation platform findings:
- Students read more carefully when they know peers will see their annotations
- The "social pressure" of visible annotations improves reading completion rates
- Annotation threading (replies to annotations) creates deeper discussion than standalone comments
- Privacy concerns: some students self-censor when annotations are public

### Tool Analysis: Social Layers

**Curius**: Browser extension that surfaces links saved by people you follow. Self-selected community of "inquisitive minds" -- network effects from word-of-mouth rather than growth hacking. Users search Curius before Google because the content is pre-filtered by trusted intellectual peers. Key interaction: seeing *what your friends are reading right now* as a new-tab page.

**Goodreads**: 140M+ users. Bookshelves, reviews, reading challenges. Social features are extensive (groups, discussions, messaging) but the UX is "stuck in the 00s." The rating system (1-5 stars) is too coarse for serious readers.

**StoryGraph**: Modern alternative to Goodreads. Quarter-star ratings, mood/pace tracking, detailed analytics. Deliberately less social -- no groups, no messaging. Prioritizes safety (anti-harassment measures) over engagement. Three-person team. Design critique (Pratt IxD, 2024): poor discoverability of past reads, non-functional tag elements that violate affordance conventions, incomplete mental model for marking books as read.

**Literal**: Social reading focused on literary fiction community. Clean design. Book clubs as first-class feature. Smaller, more curated community than Goodreads.

**Hypothesis**: Public/private/group annotation layers. Threaded discussions on annotations. The "social annotation" model: you can see what others highlighted on the same page. Privacy gradient: private > group-only > public.

### Intellectual Milieu as UI Concept

Stoa's distinctive feature: people and intellectual lineages as first-class entities.

**Kumu.io "Mapping Thinkers" project**: Interactive force-directed graph of Western philosophy showing influence relationships. Connection thickness represents agreement/disagreement levels. Demonstrates that intellectual influence is inherently a *graph* problem.

Stoa has the data model for this (`people`, `person_connections`, `person_items` tables) but no visualization. The webapp has a `/people` route but the graph connections aren't rendered as a graph.

### Privacy Gradients

Social reading tools generally implement 3-4 privacy levels:
- **Private**: Only the user sees their highlights/activity
- **Friends/Followers**: Visible to approved connections
- **Group**: Visible within specific collections or reading groups
- **Public**: Visible to anyone

Stoa has `is_public` on collections and activity, and a `follows` table, but no API endpoints for social features. The Chrome extension references a "social overlay" (badge showing friends who saved a page) but this isn't implemented.

### Design Principles Extracted

1. **Social pressure improves reading depth**: When users know others might see their annotations, they read more carefully and annotate more thoughtfully. But forced publicity causes self-censorship.
2. **Network as filter**: Curius's key insight -- your intellectual network is a better content filter than algorithms. Stoa's milieu graph could serve this function.
3. **Privacy gradients are essential**: Default to private, with explicit opt-in to share. Per-item or per-collection visibility controls.
4. **The milieu graph IS the social feature**: For researchers, "who influences whom" matters more than follower counts. Stoa should lean into the intellectual lineage graph as its primary social interface, not replicate Goodreads.

---

## 5. Browser Extension Interaction Patterns

### Key Literature

No substantial academic literature on browser extension UX specifically. The relevant research is on information capture patterns and interruption costs.

**Iqbal, S.T. & Horvitz, E. (2007). "Disruption and Recovery of Computing Tasks." CHI 2007.**

Context switches are costly -- users take an average of 25 minutes to resume a task after interruption. Annotation tools that pull the user out of their reading flow (popup windows, new tabs, modal dialogs) impose high interruption costs. In-page tools (floating toolbars, sidebars) minimize context switching.

### Tool Analysis: Save Patterns

**Pocket**: One-click save via toolbar icon or Ctrl+Shift+S. Saved to inbox with auto-extracted title/image. Tags optional. Minimal friction. No annotation at save time.

**Instapaper**: One-click save. Distinguishes itself with reading time estimates and folder organization (vs. Pocket's tag-only system). Content is parsed for distraction-free reading.

**Curius**: Save + highlight in one gesture. The save action itself is social -- your friends see what you saved. The extension overlays friend activity on any page you visit.

**Readwise Reader**: Unique bidirectional sync -- highlights made via the extension appear in the Reader app, and vice versa. The extension is a *reader* itself, not just a clipper. Users can highlight on the original page or in the parsed view.

**Stoa's current extension**: Popup with save button, type selector (blog/paper/podcast/video), tag input. Keyboard shortcut Cmd+Shift+S for quick save. Content script provides floating highlight toolbar. No bidirectional sync with webapp. Save goes to API; highlights go to API. Tab group saving (local only, stub API). Context menu "Save to Stoa" and "Save link to Stoa."

### Annotation Persistence (Re-injection)

The hardest technical problem in web annotation: re-applying highlights when a user revisits a page that may have changed.

**Hypothesis approach** (W3C Web Annotation standard):

Three selector types stored per annotation:
1. **TextQuoteSelector**: prefix + exact text + suffix
2. **TextPositionSelector**: character offsets in full document text
3. **RangeSelector**: XPath + offsets pointing to DOM elements

Four re-attachment strategies, tried in order:
1. Apply XPath from RangeSelector, verify text matches TextQuoteSelector
2. Use global character offsets from TextPositionSelector (handles DOM structure changes)
3. Fuzzy search around expected position using prefix/suffix (handles content changes)
4. Search entire document for exact text match (last resort)

This multi-strategy approach lets annotations "withstand document changes in both structure and content."

**Stoa's current approach**: Single CSS selector + text string matching. `getCSSSelector()` builds a selector using tag names, IDs, and `:nth-of-type()`. `injectHighlight()` finds the element via `document.querySelector()`, then uses a TreeWalker to locate and wrap the matching text.

Failure modes:
- Any DOM structure change breaks CSS selectors (ads loaded, layout shifts, A/B tests)
- No fuzzy matching -- if even one character differs, the highlight is lost
- No fallback strategy -- if the CSS selector fails, the highlight silently disappears
- Cross-element highlights (spanning multiple paragraphs) may fail in the `surroundContents` try/catch

### Tab Management as Knowledge Management

**Arc Browser**: Replaced bookmarks with pinned tabs. Spaces for context switching (work/personal/project). Vertical sidebar for tab organization. Easels for visual note-taking linked to tabs. Key insight: *your open tabs are your working memory*. Tab management IS knowledge management.

**Workona**: Tab groups that persist across sessions. "Workspaces" tied to projects. Integrates with cloud docs.

Stoa has tab group saving in the extension (Cmd+Shift+G) but it's stored only in `chrome.storage.local` -- never synced to the backend. The `tab_groups` table in the schema is unused.

### Design Principles Extracted

1. **Capture speed is paramount**: Every millisecond between intent and saved state is a potential abandonment point. One-click or one-shortcut saving with no required fields.
2. **Multi-strategy anchoring**: Stoa's single-CSS-selector approach will fail on dynamic pages. Adopt Hypothesis's multi-selector strategy (text quote + position + range) with fuzzy matching fallback.
3. **Bidirectional sync**: Highlights made in the extension should appear in the webapp and vice versa. Readwise Reader demonstrates this is a killer feature.
4. **Save now, organize later**: Don't force categorization at capture time. Type/tag/collection assignment should be optional during save and easy to add later in the webapp.

---

## What the Best Tools Do That Stoa Doesn't Yet

| Capability | Best-in-class tool | Stoa status |
|---|---|---|
| Auto-highlight (select = highlight) | Readwise Reader | Requires clicking a color button |
| Add note to existing highlight | All major tools | Not supported |
| Change highlight color after creation | Kindle, Readwise | Not supported |
| Fuzzy re-anchoring of annotations | Hypothesis (4 strategies) | Single CSS selector, no fallback |
| Themed/filtered review sessions | Readwise | All highlights in one queue |
| Content-aware scheduling | KARL (Morandin 2024) | Fixed interval schedule |
| Progressive summarization layers | Forte's method / Readwise | Single highlight layer only |
| Bidirectional linking between notes | Obsidian, Roam | No note-to-note links |
| Bidirectional extension-webapp sync | Readwise Reader | One-directional (extension > API) |
| Milieu/influence graph visualization | Kumu.io | Data model exists, no visualization |
| Social overlay on pages | Curius | Commented in code but not implemented |
| Reading progress tracking in webapp | Readwise Reader, Polar | Scroll position tracked but not surfaced |
| Engagement pipeline visibility | None (novel opportunity) | No save > read > highlight > synthesize tracking |
| Keyboard-driven reading/review | Readwise Reader | No keyboard shortcuts in webapp |
| Offline highlight queuing | Standard practice | Highlights lost if API unreachable |

---

## References

- Adler, M.J. & Van Doren, C. (1972). *How to Read a Book.* Simon & Schuster.
- Ahrens, S. (2017). *How to Take Smart Notes.* Soenke Ahrens.
- Bjork, R.A. & Bjork, E.L. (2011). "Making things hard on yourself, but in a good way: Creating desirable difficulties to enhance learning." In *Psychology and the real world.*
- Cui, L., et al. (2024). "Empowering active learning: A social annotation tool for improving student engagement." *British Journal of Educational Technology.*
- Forte, T. (2022). *Building a Second Brain.* Atria Books.
- Iqbal, S.T. & Horvitz, E. (2007). "Disruption and Recovery of Computing Tasks." *Proc. CHI 2007.*
- Marshall, C.C. (1998). "Toward an Ecology of Hypertext Annotation." *Proc. ACM Hypertext '98.*
- Marshall, C.C. (2010). *Reading and Writing the Electronic Book.* Morgan & Claypool.
- Matuschak, A. (2020). "How to write good prompts: using spaced repetition to create understanding." https://andymatuschak.org/prompts/
- Matuschak, A. & Nielsen, M. (2019). "How can we develop transformative tools for thought?" https://numinous.productions/ttft/
- Morandin, G. (2024). "Content-aware Spaced Repetition." https://www.giacomoran.com/blog/content-aware-sr/
- Nielsen, M. (2024). "How to make memory systems widespread?" https://michaelnotebook.com/mmsw/
- Pak, R., et al. (2007). "Information Organization and Retrieval: A Comparison of Taxonomical and Tagging Systems." Clemson University.
- Sellen, A.J. & Harper, R.H.R. (2002). *The Myth of the Paperless Office.* MIT Press.
- Tashman, C.S. & Edwards, W.K. (2011). "LiquidText: A Flexible, Multitouch Environment to Support Active Reading." *Proc. CHI 2011.*
- Tietze, C. (2014). "The Collector's Fallacy." https://zettelkasten.de/posts/collectors-fallacy/
- Victor, B. (2011). "Explorable Explanations." https://worrydream.com/ExplorableExplanations/
- Zhu, M., et al. (2024). "Examining the Role of Peer Acknowledgements on Social Annotations." *Proc. CHI 2024.*
