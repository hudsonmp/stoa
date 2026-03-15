# Interaction Design Recommendations for Stoa

Grounded in the literature review (`hci-research.md`). Ordered by expected impact on making Stoa feel like a tool designed by a researcher for researchers.

---

## Priority Tier 1: High Impact, Quick Wins

These require no architectural changes -- mostly frontend and extension modifications.

### R1. Auto-Highlight on Selection (Chrome Extension)

**Research basis**: Readwise Reader's auto-highlight is their most praised UX decision. Sellen & Harper (2002) show paper annotation succeeds because the cognitive cost of marking is near zero. Marshall (1998) documents that most annotations are attention signals, not articulated thoughts.

**Current behavior**: User selects text > floating toolbar appears with 5 color buttons > user clicks a color > highlight is created (3 steps).

**Proposed change**: User selects text > text is immediately highlighted in the default color (1 step). The floating toolbar still appears briefly for: changing color, adding a note, or undoing. A settings toggle lets users choose between auto-highlight and the current explicit mode.

**Mockup**: On mouseup after selection of 3+ chars, immediately wrap selection in `stoa-highlight stoa-highlight-yellow`. Show a compact toolbar above the highlight with: [undo] [color dots] [note icon]. Toolbar auto-dismisses after 3 seconds if no interaction. Keyboard shortcut: `Cmd+Shift+H` to highlight current selection in default color.

**Implementation**: Modify `setupSelectionListener()` and `showToolbar()` in `content.js`. Add a `stoa_auto_highlight` preference to `chrome.storage.local`. The highlight save call already handles all persistence -- just trigger it immediately instead of waiting for a color click.

**Expected impact**: 2-3x more highlights captured per reading session. Lower barrier means more raw material for spaced repetition and synthesis.

---

### R2. Add Note to Existing Highlights (Chrome Extension + API)

**Research basis**: Marshall (1998) shows annotation is iterative -- readers return to marks and add meaning over time. Adler & Van Doren's analytical reading level requires conceptual notes that develop during re-reading, not just on first pass.

**Current behavior**: Highlights are immutable after creation. No way to add a note, change color, or delete a highlight.

**Proposed change**: Clicking an existing `stoa-highlight` span shows a contextual menu: [Edit Note] [Change Color] [Delete] [Copy]. The note editor is an inline expandable textarea below the highlight.

**Mockup**: On click of a `.stoa-highlight` element, show a small popover anchored to the highlight with the existing note (if any) in an editable textarea, color dots for changing color, and a trash icon. Changes save on blur or Enter.

**Implementation**: Requires `PATCH /highlights/{id}` and `DELETE /highlights/{id}` endpoints on the backend. The content script needs click handlers on injected highlight spans. The highlight's `id` should be stored in a `data-stoa-id` attribute on the injected span.

**Expected impact**: Transforms highlights from dead marks into living annotations that accumulate meaning over time. Essential for analytical reading.

---

### R3. Keyboard Shortcuts for Webapp Review (Webapp)

**Research basis**: Readwise Reader's keyboard-driven review is their "most beloved feature." Iqbal & Horvitz (2007) show context switches are costly -- mouse-driven review requires constant visual targeting.

**Current behavior**: The `/review` page exists but interaction details are unknown (no webapp source files beyond App.tsx routing). The spaced repetition API exists with 4-point rating.

**Proposed change**: Review page responds to keyboard: `1` = Forgot, `2` = Hard, `3` = Good, `4` = Easy, `Space` = Reveal answer/context, `S` = Skip, `E` = Edit note. The review card shows highlight text first (testing retrieval), then reveals source title, surrounding context, and note on Space.

**Mockup**: Full-screen card centered on page. Large highlight text in serif font. Below: "Press Space to reveal context." After reveal: source title, author, surrounding paragraph text, user's note (if any). Bottom bar: keyboard shortcuts with visual buttons as fallback. Progress indicator showing "3 of 12 due today."

**Implementation**: Add `onKeyDown` handler to the Review page component. Restructure the card to have a "front" (highlight only) and "back" (full context) state. This implements Bjork's desirable difficulty principle -- retrieval before context.

**Expected impact**: Makes review sessions feel fast and game-like instead of tedious. The retrieval-first pattern strengthens memory per Bjork.

---

### R4. Engagement Pipeline Visibility (Webapp)

**Research basis**: The collector's fallacy (Tietze 2014). Stoa currently optimizes for acquisition with no mechanism to surface the save > read > highlight > synthesize pipeline.

**Current behavior**: Library shows items filtered by reading status (to_read / reading / read). No visibility into how deeply each item has been engaged with.

**Proposed change**: Each item card in the library shows engagement indicators: a small progress bar or icon set showing [saved] [opened] [highlighted] [noted] [reviewed]. The library can be sorted/filtered by engagement depth. A "Stale Items" view surfaces things saved 2+ weeks ago with no engagement.

**Mockup**: Item card in library grid gets a subtle row of 4 dots below the title. Dots fill in as engagement deepens: gray (saved only) > half-filled (opened/scrolled) > filled (highlighted) > ringed (noted/reviewed). A "Needs Attention" filter in the sidebar shows items with 0 highlights that have been saved for 14+ days.

**Implementation**: Aggregate data from existing tables: `items.reading_status`, `highlights` count per item, `notes` count per item, `review_queue` for whether highlights have been reviewed. Add a computed `engagement_depth` field or view.

**Expected impact**: Makes the gap between saving and understanding visible. Addresses the core product risk that Stoa becomes a digital graveyard.

---

### R5. Offline Highlight Queue (Chrome Extension)

**Research basis**: Standard practice in production tools. Stoa's feature-gaps.md already identifies this: "highlights are created in the DOM but the saveHighlight function fails silently. When the user navigates away, it's lost."

**Current behavior**: If the API is unreachable, `saveHighlight()` catches the error and logs it. The DOM highlight is visible but never persisted.

**Proposed change**: All highlight operations queue to `chrome.storage.local` first, then sync to the API. A sync manager retries failed operations with exponential backoff. Visual indicator in the extension popup shows sync status.

**Implementation**: Modify `_saveHighlightData()` to write to local queue first, then attempt API sync. Add a `syncPendingHighlights()` function triggered on extension startup and periodically. Store pending items with timestamps for conflict resolution.

**Expected impact**: Eliminates data loss. Enables annotation on planes, in cafes with bad wifi, etc.

---

## Priority Tier 2: High Impact, Moderate Effort

These require backend changes or significant frontend work.

### R6. Multi-Strategy Highlight Anchoring (Chrome Extension)

**Research basis**: Hypothesis's fuzzy anchoring system (W3C Web Annotation standard) uses three selector types with four fallback strategies. Stoa's single CSS selector approach fails on any DOM change.

**Current behavior**: `getCSSSelector()` builds a path like `article > div:nth-of-type(2) > p:nth-of-type(3)`. `injectHighlight()` uses `document.querySelector()` with the stored selector, then walks text nodes to find the exact string. If the CSS selector is invalid or the DOM has changed, the highlight silently disappears.

**Proposed change**: Store three selectors per highlight:
1. **TextQuoteSelector**: `{ prefix, exact, suffix }` -- 50 chars of text before and after the highlight
2. **TextPositionSelector**: `{ start, end }` -- character offsets in the full document text
3. **RangeSelector**: Current CSS selector approach (renamed)

Re-injection tries strategies in order:
1. CSS selector + text verification
2. Character offset positioning
3. Fuzzy text search (prefix/exact/suffix with edit distance tolerance)
4. Full-document text search (last resort)

**Schema change**: Add `text_quote_prefix`, `text_quote_suffix`, `text_position_start`, `text_position_end` columns to `highlights` table. Or store as JSON in a `selectors` column.

**Implementation**: Modify `highlightSelection()` to compute and store all three selector types. Rewrite `injectHighlight()` with the four-strategy cascade. Use a simple Levenshtein or longest-common-subsequence match for fuzzy search.

**Expected impact**: Dramatically improves highlight persistence on dynamic pages (news sites, blogs with layout changes, pages with A/B tests). Without this, users lose trust in the system when highlights disappear.

---

### R7. Themed Review Sessions (Backend + Webapp)

**Research basis**: Readwise's Themed Reviews are their key differentiator for serious users. A researcher reviewing for a literature review needs different highlights than during general review. Forte's progressive summarization works because distillation is just-in-time for a specific purpose.

**Current behavior**: `POST /review/next` returns the next N highlights due for review, globally. No filtering by source, topic, tag, collection, or person.

**Proposed change**: The review endpoint accepts optional filters: `collection_id`, `tag`, `person_id`, `item_id`, `item_type`. The webapp review page lets users create named "Review Themes" that save filter configurations. Default theme: "All Due."

**Mockup**: Review page header shows a dropdown: "Reviewing: [All Due v]". Options include saved themes plus "Create Theme..." which opens a filter builder with checkboxes for collections, tags, people, and content types.

**Implementation**: Extend `POST /review/next` with optional filter parameters. Add joins to filter by item tags, collections, person_items. Add a `review_themes` table (or store in user preferences JSON) for saved filter configs.

**Expected impact**: Transforms review from generic flashcard drill into a research tool. A user writing a paper on "desirable difficulties" can review only highlights from their SR literature collection.

---

### R8. Highlight-to-Highlight Links (Backend + Webapp)

**Research basis**: Zettelkasten's core principle -- connections between notes matter more than individual notes. Obsidian and Roam demonstrate that bidirectional linking creates emergent structure. Currently Stoa has no way to connect insights across sources.

**Current behavior**: Highlights are isolated records attached to items. No linking between highlights, no linking between notes, no cross-item connections except through the people graph.

**Proposed change**: Add a `highlight_links` table: `(highlight_id_from, highlight_id_to, link_type, note)`. Link types: `supports`, `contradicts`, `extends`, `related`. In the webapp, when viewing a highlight, show linked highlights with one-click navigation. In the review flow, after reviewing a highlight, suggest related highlights (using embedding similarity) as potential links.

**Schema change**: New `highlight_links` table. Use the existing embedding infrastructure to compute similarity between highlights for suggestions.

**Mockup**: On the ItemDetail page, each highlight has a small "link" icon. Clicking it opens a search panel: "Link this to..." with semantic search across all highlights. Results show highlight text, source title, and similarity score. After linking, both highlights show their connections.

**Implementation**: New table, new API endpoints, similarity search using the existing `match_chunks` RPC (adapted for highlights instead of chunks), and a linking UI component.

**Expected impact**: This is the feature that transforms Stoa from a bookmarking app into a knowledge system. Linked highlights across sources are the raw material for synthesis -- exactly what Adler & Van Doren's syntopical reading requires.

---

### R9. Milieu Graph Visualization (Webapp)

**Research basis**: Kumu.io's "Mapping Thinkers" project demonstrates intellectual influence as a graph. Stoa's `people`, `person_connections`, and `person_items` tables already encode this graph -- but there's no visualization.

**Current behavior**: `/people` route exists. `/people/:id` route exists. The data model supports person-to-person connections with relation types and notes. But the webapp apparently renders these as lists, not as a graph.

**Proposed change**: The `/people` page renders an interactive force-directed graph. Nodes are people (sized by number of connected items). Edges are connections (labeled with relation type). Clicking a node shows their items and connections. Double-clicking navigates to PersonDetail. The graph is filterable by connection type.

**Implementation**: Use a library like `d3-force`, `react-force-graph`, or `vis-network`. The data is already structured correctly -- just needs a graph visualization layer. Person nodes get avatars; connection edges get labels. Add physics simulation with drag, zoom, and hover tooltips.

**Expected impact**: This is Stoa's signature feature -- the thing no other reading tool does. Visualizing intellectual lineage makes the milieu concept tangible and navigable. It's the feature that would make someone choose Stoa over Readwise or Pocket.

---

### R10. Content-Aware Spaced Repetition (Backend)

**Research basis**: Morandin (2024) demonstrates that incorporating semantic embeddings into scheduling produces measurable improvements through a "priming effect" -- reviewing related material reinforces interconnected concepts. Stoa already has embeddings for all chunks.

**Current behavior**: Fixed half-power-law scheduler with base intervals. Each highlight is scheduled independently based only on its own review history. No awareness of content relationships.

**Proposed change**: When calculating the next review interval, factor in recent reviews of semantically similar highlights. If the user recently reviewed a related highlight successfully, extend the interval slightly (priming effect). If they failed a related highlight, bring this one forward.

**Implementation**: After a review response, compute embedding similarity between the reviewed highlight and other highlights in the queue. Adjust `next_review_at` for similar highlights (within a threshold). This uses the existing embedding infrastructure -- compute highlight embeddings once (as with chunk embeddings) and use cosine similarity.

**Expected impact**: Smarter scheduling that reflects how memory actually works -- related concepts reinforce each other. Reduces total review time while maintaining retention.

---

## Priority Tier 3: High Impact, Architectural

These require significant new systems or redesigns.

### R11. Progressive Engagement Pipeline (Full Stack)

**Research basis**: Forte's progressive summarization (5 layers of distillation). The collector's fallacy. Matuschak's insight that capture and processing should be separated.

**Current behavior**: Items have `reading_status` (to_read/reading/read) but no API to update it. No tracking of engagement depth beyond binary "has highlights" / "doesn't."

**Proposed change**: Formalize the engagement pipeline as a first-class concept:

| Stage | Signal | UI |
|---|---|---|
| Saved | Item ingested | Gray in library |
| Opened | Scroll position > 0 | Partially filled indicator |
| Highlighted | 1+ highlights | Filled indicator |
| Annotated | 1+ notes on highlights | Ringed indicator |
| Connected | Highlight linked to other highlights | Star indicator |
| Synthesized | Note written that references 2+ items | Diamond indicator |

Each stage surfaces different prompts: "You saved this 2 weeks ago -- want to skim it?" (Saved), "You highlighted 5 passages -- any connections to other reading?" (Highlighted), "3 highlights from this are linked to your SR paper -- ready to draft?" (Connected).

**Implementation**: This is a product-level reconceptualization. Requires: reading status API endpoint, engagement depth computation, notification/prompt system, and UI for the pipeline visualization.

**Expected impact**: Addresses the deepest product risk -- that Stoa becomes another digital graveyard. Makes the path from saving to understanding explicit and supported.

---

### R12. Social Milieu Overlay (Chrome Extension + Backend)

**Research basis**: Curius's core feature -- seeing what your intellectual peers are reading. Perusall research shows social visibility improves reading depth. Zhu et al. (CHI 2024) demonstrate peer acknowledgments affect annotation behavior.

**Current behavior**: The Chrome extension's content script references a "social overlay (badge showing friends who saved this page)" in comments but nothing is implemented. The `follows` and `activity` tables exist but have no API.

**Proposed change**: When visiting a page, the extension queries the API for friends who have also saved/highlighted this page. A subtle badge appears in the corner: "2 friends saved this." Clicking shows their public highlights overlaid on the page (in a different color) and their notes. Privacy controls: users choose per-item or globally whether their activity is visible to followers.

**Implementation**: Requires: social API endpoints (follows CRUD, activity feed, public highlights query), privacy settings UI, extension badge rendering, and the social highlight overlay in the content script. Significant backend and extension work.

**Expected impact**: This is the feature that makes Stoa a *network* rather than a solo tool. For researchers, seeing that your advisor highlighted the same passage you did -- or a different one -- is enormously valuable.

---

### R13. Bidirectional Extension-Webapp Highlight Sync

**Research basis**: Readwise Reader's bidirectional sync is a unique differentiator. Highlights made on the original page appear in the app view, and vice versa.

**Current behavior**: The Chrome extension sends highlights to the API. The webapp reads highlights from the API. But the webapp and extension don't share a real-time sync channel -- there's no way for a highlight added in the webapp to appear in the extension when revisiting the page (unless the page is reloaded and highlights are re-fetched).

**Proposed change**: True bidirectional sync: (1) Extension highlights sync to API immediately (current behavior). (2) Webapp-created highlights sync to extension via service worker polling or WebSocket. (3) When revisiting a page, the extension fetches *all* highlights for that URL, including those created from the webapp's reader view.

**Implementation**: The extension already calls `restoreHighlights()` on page load, which fetches from the API. The gap is that webapp-created highlights need the same `css_selector` / anchoring data. If the webapp allows highlighting in a reader view, it needs to compute anchoring selectors compatible with the original page's DOM. This is architecturally hard -- may require storing the original page HTML.

**Expected impact**: Eliminates the split between "highlights I made while reading" and "highlights I made while reviewing." Creates a unified highlight layer across all contexts.

---

## Summary Matrix

| # | Recommendation | Effort | Impact | Research Basis |
|---|---|---|---|---|
| R1 | Auto-highlight on selection | Low | High | Readwise, Sellen & Harper, Marshall |
| R2 | Edit existing highlights | Low | High | Marshall, Adler & Van Doren |
| R3 | Keyboard shortcuts for review | Low | High | Readwise Reader, Iqbal & Horvitz |
| R4 | Engagement pipeline visibility | Low | High | Collector's fallacy, Forte |
| R5 | Offline highlight queue | Low | Medium | Standard practice, feature-gaps.md |
| R6 | Multi-strategy anchoring | Medium | High | Hypothesis/W3C, fuzzy anchoring |
| R7 | Themed review sessions | Medium | High | Readwise, Forte |
| R8 | Highlight-to-highlight links | Medium | Very High | Zettelkasten, Obsidian, Roam |
| R9 | Milieu graph visualization | Medium | Very High | Kumu.io, unique to Stoa |
| R10 | Content-aware SR scheduling | Medium | Medium | Morandin 2024, KARL |
| R11 | Progressive engagement pipeline | High | Very High | Forte, collector's fallacy, Matuschak |
| R12 | Social milieu overlay | High | High | Curius, Perusall, CHI 2024 |
| R13 | Bidirectional highlight sync | High | Medium | Readwise Reader |

---

## What Makes This "For Researchers"

The recommendations above aren't generic productivity features. They're designed around how researchers actually work:

1. **Syntopical reading support** (R7, R8): Researchers don't read one thing at a time. They read across a literature, comparing claims. Themed reviews and cross-highlight linking directly support Adler's syntopical reading level.

2. **Intellectual lineage as navigation** (R9, R12): Researchers think in terms of "who said what" and "who influenced whom." The milieu graph and social overlay make these relationships navigable.

3. **Desirable difficulty in review** (R3, R10): Researchers need to *understand*, not just *remember*. The retrieval-first review pattern and content-aware scheduling optimize for comprehension, not rote recall.

4. **Anti-hoarding design** (R4, R11): Researchers are particularly susceptible to the collector's fallacy -- downloading every paper from a reference list. The engagement pipeline makes the gap between saving and understanding impossible to ignore.

5. **Robust annotation persistence** (R6): Researchers annotate papers and articles they revisit over months or years. If highlights disappear because a blog reorganized its DOM, trust is destroyed. Multi-strategy anchoring is not optional for a serious tool.
