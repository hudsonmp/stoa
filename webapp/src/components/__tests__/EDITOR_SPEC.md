# Editor spec — Stoa note editor (TipTap-based)

Living registry of keystroke behaviors and edge cases. Each entry is written as
a **precondition → action → expected outcome** triple so it maps directly to a
test case. "Status" is (P)assing, (F)ailing, (U)ntested, (D)eferred.

This doc is the Role-1 output. Role 2 runs the associated tests. Role 3 derives
requirements from the failures. Role 4 implements. Loop.

---

## A. Blockquote

| id  | precondition                             | action                | expected                                              | status |
| --- | ---------------------------------------- | --------------------- | ----------------------------------------------------- | ------ |
| A1  | Cursor inside blockquote, non-empty line | Enter                 | Inserts newline, stays inside blockquote              | P      |
| A2  | Cursor inside blockquote, empty line     | Enter                 | Lifts paragraph out, exits blockquote                 | P      |
| A3  | Cursor at end of blockquote              | Cmd+Shift+B           | Toggles blockquote off for selection                  | U      |
| A4  | Selection spans blockquote + paragraph   | Cmd+Shift+B           | Merges into blockquote (or exits for all)             | U      |

## B. Link mark

| id  | precondition                     | action                       | expected                                        | status |
| --- | -------------------------------- | ---------------------------- | ----------------------------------------------- | ------ |
| B1  | Word selected                    | Click Link tool, enter URL   | Text becomes link                                | P      |
| B2  | Link just applied                | —                            | Toolbar "Link" button shows NOT active           | P      |
| B3  | Cursor at end of link            | Type character               | Typed char is NOT part of link (inclusive=false) | P      |
| B4  | Cursor inside link               | Click Link tool, clear URL   | Link unset on full mark range                    | U      |
| B5  | URL dropped/pasted on selection  | Default paste                | Selection becomes link to pasted URL (autolink)  | U      |

## C. @-mention

| id  | precondition                              | action                      | expected                                         | status |
| --- | ----------------------------------------- | --------------------------- | ------------------------------------------------ | ------ |
| C1  | Typing "@" in editor                      | —                           | Suggestion popup appears                         | U      |
| C2  | Typing "@prod" with note titled "Product" | —                           | Note shows in suggestions with NOTE badge        | U      |
| C3  | Cache empty, typing "@x"                  | —                           | First keystroke triggers /notes fetch once       | U      |
| C4  | Cache populated, 1 char typed             | —                           | Filter runs in-memory, items fetched in parallel | U      |
| C5  | Item and note share a label substring     | Select item row             | Mention id = "item:<uuid>"                       | U      |
| C6  | Same as C5, select note row               | —                           | Mention id = "note:<uuid>"                       | U      |
| C7  | Mention inserted, user clicks it later    | —                           | Route goes to /notes/<id> or /item/<id> by kind  | U      |
| C8  | Arrow keys while popup open               | Up/Down/Enter               | Cycles selection, Enter commits                  | U      |
| C9  | Popup open, Esc                           | —                           | Popup closes, no mention inserted                | U      |
| C10 | Popup open, type nonsense after @         | —                           | "No results" state, not a stale list             | U      |

## D. Knowledge-type pills

| id  | precondition                        | action                | expected                                         | status |
| --- | ----------------------------------- | --------------------- | ------------------------------------------------ | ------ |
| D1  | Note opens, no kt tag               | Click "declarative"   | Tag becomes `kt:declarative`, pill is active     | U      |
| D2  | Active pill = declarative           | Click same pill       | Tag removed, all pills inactive                  | U      |
| D3  | Active pill = declarative           | Click "idea"          | `kt:declarative` removed, `kt:idea` set          | U      |
| D4  | Pill = declarative                  | Editor swaps         | Shows FlashcardEditor (front/back) not TipTap    | U      |
| D5  | Pill = idea                         | —                     | Shows normal TipTap editor (not flashcard)       | U      |
| D6  | Hover pill                          | —                     | 320px tooltip with label + body                  | U      |
| D7  | Pill = mytake                       | —                     | Shows TipTap editor (not flashcard)              | U      |
| D8  | Pill display label                  | —                     | "mytake" id renders as "my take" in pill + badge | U      |

## E. Links (note→note) UI

| id  | precondition                            | action                | expected                                          | status |
| --- | --------------------------------------- | --------------------- | ------------------------------------------------- | ------ |
| E1  | Active note, click "+ link"             | —                     | Picker opens, focus in search                     | U      |
| E2  | Picker open, Esc                        | —                     | Picker closes, query cleared                      | U      |
| E3  | Picker open, click outside              | —                     | Picker closes                                     | U      |
| E4  | Pick candidate                          | —                     | Candidate appears as a link chip                  | U      |
| E5  | Note body contains @mention to note B   | Load note             | Note B appears in Links row even without link tag | U      |
| E6  | Synthesis note with <2 links            | Save                  | Orphan warning appears under links row            | U      |
| E7  | Click × on a link chip                  | —                     | Link removed, chip gone                           | U      |

## F. Folder / collection

| id  | precondition                             | action                  | expected                                        | status |
| --- | ---------------------------------------- | ----------------------- | ----------------------------------------------- | ------ |
| F1  | Folder dropdown collapsed, click trigger | —                       | Dropdown opens                                  | U      |
| F2  | Dropdown open, click outside             | —                       | Dropdown closes                                 | U      |
| F3  | Notes list filtered to folder X          | Click "New Note"        | Created note has `col:X` tag                    | U      |
| F4  | Search "Hamming" matches folder "Hamming"| —                       | All notes in Hamming folder surface             | U      |
| F5  | Folder picker on note, pick new folder   | —                       | Adds col:<id> tag, folder chip appears on note  | U      |
| F6  | Remove folder via × on chip              | —                       | Removes tag, chip disappears                    | U      |

## G. Flashcard editor (declarative only)

| id  | precondition                             | action                 | expected                                        | status |
| --- | ---------------------------------------- | ---------------------- | ----------------------------------------------- | ------ |
| G1  | kt=declarative, fields empty             | Type into Front        | Preview appears on blur, renders `\(x\)` via KaTeX | U   |
| G2  | Blur field                               | —                      | Debounced save after ~900ms → Stoa update      | U      |
| G3  | After Stoa save                          | —                      | Attempts Anki push via AnkiConnect              | P      |
| G4  | Anki unreachable                         | —                      | Badge: "Anki sync failed · retry" + error text  | P      |
| G5  | Error matches CORS pattern               | —                      | Hint shown with remediation instructions        | U      |
| G6  | Re-save a note with existing anki:<id>   | —                      | updateNoteFields (not addNote) fires            | P      |
| G7  | Existing Anki note deleted server-side   | Re-save                | Falls back to addNote cleanly                   | P      |
| G8  | Deck "42" missing                        | First save             | ensureDeck creates it before addNote            | P      |

## H. Keyboard shortcuts (global)

| id  | precondition          | action          | expected                                                      | status |
| --- | --------------------- | --------------- | ------------------------------------------------------------- | ------ |
| H1  | Any page, not typing  | ⌘K              | New note created, navigate to /notes/<id>                     | U      |
| H2  | Typing in editor      | ⌘K              | No-op (don't hijack typing)                                   | U      |
| H3  | ⌘N / ⌘Y               | —               | Browser-reserved accelerators; unusable from webpage          | D      |

## L. PDF annotation (uploaded PDFs via ItemDetail)

| id  | precondition                         | action                        | expected                                                  | status |
| --- | ------------------------------------ | ----------------------------- | --------------------------------------------------------- | ------ |
| L1  | PDF open in ItemDetail               | Select text                   | Floating "Highlight" button appears; click → POST /highlights with page_number | P |
| L2  | Highlight exists for this PDF        | Load page containing it       | Text-layer spans matching highlight.text get yellow tint  | P      |
| L3  | Take a note on PDF                   | Type in notepad               | Autosave (≤900ms debounce) creates/PATCHes draft — no Send button | P |
| L4  | Save bookmark (current page = 7)     | Reload                        | PdfAnnotationView auto-jumps to page 7 once pages render  | P      |
| L5  | PDF view open with ≥1 collection     | —                             | Folder chip picker reachable from inside the PDF sidebar  | P      |
| L6  | Highlight on page 5, scroll to page 5| —                             | Yellow tint visible on matched spans (amber highlighter)  | P      |
| L7  | Create highlight then note           | —                             | Note shows linked-to-highlight indicator in sidebar       | U      |
| L8  | Select text spanning 2 pages         | Highlight                     | Page number = page of anchor span; graceful degrade       | P      |
| L9  | Autosave fires while typing fast     | Keep typing after save        | Subsequent edits PATCH same draft note (no duplicate)     | P      |

## K. Graph view (/graph)

| id  | precondition                         | action                      | expected                                                       | status |
| --- | ------------------------------------ | --------------------------- | -------------------------------------------------------------- | ------ |
| K1  | Graph page open                      | —                           | Force-directed layout settles within ~3s                       | U      |
| K2  | Note with ≥2 links                   | —                           | Node rendered larger than single-link nodes (log scale)        | U      |
| K3  | Synthesis note with <2 links         | —                           | Red ring halo visible (orphan signal)                          | U      |
| K4  | Notes in same folder                 | —                           | Soft hull polygon drawn behind them (hash-derived tint)        | U      |
| K5  | Hover a node                         | —                           | Non-neighbors fade to 0.15 opacity, label shows on hovered     | U      |
| K6  | Click a node                         | —                           | Navigate to /notes/<id>                                        | U      |
| K7  | Declarative note                     | —                           | Rendered in #3b82f6 (blue)                                     | U      |
| K8  | Note with no knowledge_type          | —                           | Rendered in slate grey (unencoded fallback)                    | U      |
| K9  | Edge backed by `link:<id>` tag       | —                           | Drawn solid with arrow (directed)                              | U      |
| K10 | Edge from body-parsed @mention only  | —                           | Drawn dashed, no arrow                                         | U      |
| K11 | No notes yet                         | —                           | Empty-state message prompts ⌘K                                 | U      |

## I. Math rendering

| id  | precondition                        | action | expected                                                 | status |
| --- | ----------------------------------- | ------ | -------------------------------------------------------- | ------ |
| I1  | Flashcard preview contains `\(x\)`  | —      | Renders via KaTeX inline                                 | U      |
| I2  | Flashcard preview contains `\[x\]`  | —      | Renders via KaTeX in display mode                        | U      |
| I3  | Invalid LaTeX                       | —      | Falls through (no crash), shows raw source               | U      |

---

## Known failure modes (hypotheses, pending test evidence)

1. **H3**: ⌘N intercepted by Chrome, cannot be overridden. Deferred (documented, no fix path).
2. **C3**: If cache request is slow on first keystroke, popup may briefly show no results before filling. Needs measurement.
3. **E5 was failing pre-fix** (body links weren't counted) — backend union shipped 2026-04-15, needs E2E verification.
4. **B2 was failing pre-fix** (inclusive=true) — shipped 2026-04-15.
5. **A2 was failing pre-fix** (no double-Enter exit) — shipped 2026-04-15.

## Workflow

1. Role 1 (this doc) — add a row with status U for every new edge case.
2. Role 2 (tests in `__tests__/`) — implement the test for each U row.
3. Role 3 — any F runs through a "requirements" block below, named by id.
4. Role 4 — implement, rerun, flip to P.

## Open requirements derived from failures (Role 3)

### REQ-01 (2026-04-15): Atomic anki-id tag mutation
Originating failure: *"⌘K seemed to delete folder links."* Root cause: a
debounced FlashcardEditor autosave wrote back a stale `tags` array captured in
a React closure BEFORE the user added `col:<id>` via the folder picker. The
write silently dropped `col:`/`link:`/`kt:` tags that existed only in server
state or in a later React render.

**Requirement.** Any surface that mutates a single tag-prefix family MUST
either (a) use a dedicated server endpoint that reads tags fresh and mutates
only its own prefix, or (b) refetch the note via `GET /notes/{id}` immediately
before the write. Direct `PATCH /notes/{id}` with a fully-reconstructed `tags`
array from a React closure is banned for partial mutations.

Status: **P** — `POST /notes/{id}/anki-id` shipped; FlashcardEditor migrated.

### REQ-02 (2026-04-15): Global shortcut folder inheritance
`⌘K` (and any future global new-note shortcut) MUST create the note in the
currently-active folder filter. Implemented via `localStorage` key
`stoa_active_folder_filter`, written by Notes.tsx on filter change, read by
Layout.tsx on shortcut fire.

Status: **P**.

### REQ-03 (2026-04-15): Per-note linked-creation
A note must be able to spawn a new note that is auto-linked back to it, so
dense-linking doesn't require two clicks. Implemented as "+ linked note"
button next to "+ link". Inherits folder from active filter.

Status: **P**.

### REQ-04 (2026-04-15): Outgoing-link inheritance for linked-note spawn
When "+ linked note" creates B from A, B inherits every note A currently
links to (A's outgoing link set). Mental model: B is a sibling/child in
A's concept neighborhood and starts with the same referents. Does NOT
inject backrefs FROM inherited notes to B (that would pollute their graphs
without consent). Implemented in handleCreateLinkedNote via parallel
linkNoteToNote calls over linkedNotes[].id.

Status: **P**.

