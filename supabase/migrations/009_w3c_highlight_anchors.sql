-- W3C Web Annotation Data Model selectors for highlights
-- https://www.w3.org/TR/annotation-model/#selectors
--
-- selectors: jsonb array of W3C selector objects, e.g.:
--   [
--     {"type": "TextQuoteSelector",    "exact": "...", "prefix": "...", "suffix": "..."},
--     {"type": "TextPositionSelector", "start": 42,   "end": 58},
--     {"type": "FragmentSelector",     "value": "page=3"}
--   ]
--
-- The three-tier resolver in the frontend tries TextPositionSelector first
-- (fast, exact offset within page text layer), then TextQuoteSelector
-- (fuzzy context match, handles minor text drift from ligature repair),
-- then falls back to substring match on highlights.text (existing behaviour).
--
-- Migration also adds page_number column if missing (it may not exist on
-- older Supabase projects that were created before the column was added in
-- the application layer).

-- 1. Add selectors column (nullable — existing rows get populated best-effort by client on next render)
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS selectors jsonb;

-- 2. Add page_number column (guards against schema drift on older projects)
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS page_number int;

-- 3. Index the JSONB for future server-side queries (e.g. finding all highlights
--    on page N without scanning the full table)
CREATE INDEX IF NOT EXISTS highlights_page_number_idx ON highlights (item_id, page_number);

-- 4. GIN index on selectors enables @> containment queries if we ever want to
--    find highlights whose TextQuoteSelector.exact matches a given string server-side
CREATE INDEX IF NOT EXISTS highlights_selectors_gin ON highlights USING gin (selectors);
