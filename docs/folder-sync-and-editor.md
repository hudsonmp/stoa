# Editor ↔ Folder-Sync Coordination

Two agents touch the same `.md` format: the editor (NoteEditorV2) renders and
writes TipTap HTML that serialises to markdown; the sync engine reads/writes
`.md` files in the user's vault and reconciles them with `project_notes`.
This document is the contract between the two.

## Source of truth

- **Frontend serializer** — `webapp/src/lib/note-serializer.ts`. Tested in
  `webapp/src/lib/__tests__/note-serializer.test.ts`. Canonical for
  `toMarkdown(note) -> string` + `fromMarkdown(text) -> note`.
- **Backend serializer** — `backend/services/note_markdown.py`. Mirrors the
  frontend module. Used by the `/project-notes/{id}/markdown` endpoint and
  (eventually) by `services/folder_sync`.

Both sides emit identical YAML frontmatter in the same key order:

```yaml
---
id: <uuid>
item_id: <uuid | null>
project_id: <uuid | null>
folder_id: <uuid | null>
evergreen: <bool>
tags: [list]
anchor_selectors: <jsonb | null>
links_out: [uuid list]
created_at: <iso8601>
updated_at: <iso8601>
content_hash: <sha256>
---
```

## Markdown subset supported

Both directions invert exactly this subset:

- Paragraphs (blank-line-separated)
- Headings `#`–`####`
- Bold `**x**`, italic `_x_`, inline code `` `x` ``
- Fenced code blocks with optional language
- Blockquotes `> x`
- Unordered (`-`, `*`), ordered (`1.`), and task lists (`- [ ]` / `- [x]`)
- Hard breaks (two trailing spaces + newline)
- Horizontal rules `---`
- Links `[text](href)` and images `![alt](src)`
- Tables (GFM minimal: `| h | h |` + `| --- | --- |` + body rows)
- Inline math `$latex$` → `<span data-type="math-inline" data-latex="latex">`
- Display math `$$latex$$` → `<div data-type="math-block" data-latex="latex">`
- Wikilinks `[[Title]]` → inline node (resolution happens at render time)
- Footnotes: `[^id]` inline and `[^id]: body` at end-of-document

Anything outside this subset is either preserved as raw HTML on
round-trip (via TipTap's HTML fallback) or stripped. The authoritative test
cases are in `note-serializer.test.ts` — add a case before adding a feature.

## Not in `.md`

- **Comments** (`note_comments` table) live at
  `.stoa/comments/note-<id>.json`, keyed by `range_selector`. The sync
  engine MUST preserve these on every write and not try to encode them in
  frontmatter.
- **Embedded base64 images** are replaced with `stoa://image-<id>`
  placeholders during serialisation. Vault-portable assets need a separate
  pipeline (out of scope for both agents currently).

## Hash semantics

`content_hash` hashes the markdown body (after frontmatter, before writing).
The sync engine reads the body hash, compares against `sync_manifest.content_hash`,
and only triggers a write when they diverge. The frontend serializer
exposes `contentHashOf(body) -> Promise<string>` for clients that need it.

## Changing this contract

If you add a new markdown construct or frontmatter key:

1. Add a test case in `note-serializer.test.ts` (round-trip preservation).
2. Mirror the change in `backend/services/note_markdown.py`.
3. Update this doc.
4. If the addition is a breaking change, bump a schema version in the
   frontmatter (`schema_version: 2`) and handle the old version in both
   parsers.

Drive-by edits that touch only one side are not allowed.
