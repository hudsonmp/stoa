-- Add page_number to highlights for physical book quotes
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS page_number integer;

-- Update items type constraint to include new types.
-- The inline CHECK gets an auto-generated name; find and drop it dynamically.
DO $$
DECLARE
    cname text;
BEGIN
    SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'items'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%type%';

    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE items DROP CONSTRAINT %I', cname);
    END IF;
END $$;

ALTER TABLE items ADD CONSTRAINT items_type_check
  CHECK (type IN ('book', 'blog', 'paper', 'podcast', 'page', 'tweet', 'video', 'writing', 'essay', 'person', 'organization'));
