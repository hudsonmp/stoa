-- Deduplicate match_chunks overloads.
--
-- Migration 002 created `match_chunks(vector, float, int, uuid)`.
-- Migration 003 created `match_chunks(vector, float, int, uuid, text)` via
-- CREATE OR REPLACE, which in Postgres creates a NEW overload when the
-- signature differs. As a result both versions coexist, and PostgREST
-- returns PGRST203 "could not choose the best candidate" when a client
-- calls the RPC with exactly four arguments.
--
-- Fix: drop the 4-arg variant; the 5-arg version (filter_type DEFAULT NULL)
-- accepts all call sites.

DROP FUNCTION IF EXISTS public.match_chunks(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  filter_user_id uuid
);
