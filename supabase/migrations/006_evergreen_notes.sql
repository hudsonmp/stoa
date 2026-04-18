-- Evergreen notes: atomic, densely-linked, cross-referenced notes
-- (Matuschak-style evergreen + Zotero-style source anchoring)

-- ── notes additions ─────────────────────────────────────────────────────────

-- Per-note evergreen toggle. Non-evergreen notes stay marginalia: tied to a
-- single item with no cross-linking affordance.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS evergreen boolean NOT NULL DEFAULT false;

-- W3C Web Annotation selectors for passage anchoring.
-- Mirrors the shape that feat/pdf-foundation writes to highlights.selectors.
-- Shape: { "type": "TextQuoteSelector"|"TextPositionSelector"|"CssSelector", ... }
ALTER TABLE notes ADD COLUMN IF NOT EXISTS anchor_selectors jsonb;

-- Passages the user explicitly flagged ("mark-and-return") during writing.
-- Array of highlight UUIDs. No FK here: highlights may not exist yet on first
-- save, and notes must survive highlight deletion. App code filters stale ids.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS anchored_highlight_ids uuid[];

-- ── note_links ───────────────────────────────────────────────────────────────
-- Records every @mention from a note to another note, item, person, or folder.
-- source_note_id is the note that contains the @mention.
-- mention_offset is the character offset of @ in the source note HTML content;
-- used to scroll/highlight the mention in the editor on navigate-back.

CREATE TABLE IF NOT EXISTS note_links (
  source_note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_ref_type text NOT NULL CHECK (target_ref_type IN ('note','item','person','folder')),
  target_ref_id   uuid NOT NULL,
  mention_offset  int,  -- character offset of @ in source note content (0 if unspecified)
  created_at      timestamptz DEFAULT now(),
  PRIMARY KEY (source_note_id, target_ref_type, target_ref_id, mention_offset)
);

-- Fast backlinks lookup: "what @mentions this entity?"
CREATE INDEX IF NOT EXISTS idx_note_links_target
  ON note_links (target_ref_type, target_ref_id);

-- Fast outlinks lookup (composite PK already covers source_note_id, but explicit)
CREATE INDEX IF NOT EXISTS idx_note_links_source
  ON note_links (source_note_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Users can fully manage links sourced from their own notes.

ALTER TABLE note_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own note_links"
  ON note_links FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM notes
      WHERE notes.id = note_links.source_note_id
        AND notes.user_id = auth.uid()
    )
  );
