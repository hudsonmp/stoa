-- Stoa: Milieu Curation & Knowledge System
-- Initial schema migration

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- People (first-class milieu entities)
CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  bio text,
  website_url text,
  twitter_handle text,
  avatar_url text,
  affiliation text,
  role text,
  tags text[],
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Items (all content types)
CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  url text,
  title text NOT NULL,
  type text NOT NULL CHECK (type IN ('book','blog','paper','podcast','page','tweet','video')),
  favicon_url text,
  cover_image_url text,
  spine_color text,
  text_color text,
  domain text,
  scroll_position jsonb,
  reading_status text DEFAULT 'to_read' CHECK (reading_status IN ('to_read','reading','read')),
  metadata jsonb,
  extracted_text text,
  summary text,
  created_at timestamptz DEFAULT now()
);

-- Person-Item relationships
CREATE TABLE person_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid REFERENCES people NOT NULL,
  item_id uuid REFERENCES items NOT NULL,
  relation text NOT NULL CHECK (relation IN ('authored','recommended','mentioned_in','about')),
  UNIQUE(person_id, item_id, relation)
);

-- Person-Person relationships (intellectual lineage)
CREATE TABLE person_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  from_person_id uuid REFERENCES people NOT NULL,
  to_person_id uuid REFERENCES people NOT NULL,
  relation text NOT NULL,
  notes text
);

-- Citations (Zotero-like, for papers)
CREATE TABLE citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES items NOT NULL,
  authors jsonb,
  year int,
  venue text,
  doi text,
  arxiv_id text,
  bibtex text,
  abstract text,
  pdf_storage_path text,
  csl_json jsonb
);

-- Highlights
CREATE TABLE highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES items NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  text text NOT NULL,
  context text,
  css_selector text,
  start_offset int,
  end_offset int,
  color text DEFAULT 'yellow',
  note text,
  created_at timestamptz DEFAULT now()
);

-- Notes
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  item_id uuid REFERENCES items,
  person_id uuid REFERENCES people,
  title text,
  content text NOT NULL,
  tags text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tags
CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  color text,
  UNIQUE(user_id, name)
);

CREATE TABLE item_tags (
  item_id uuid REFERENCES items NOT NULL,
  tag_id uuid REFERENCES tags NOT NULL,
  PRIMARY KEY (item_id, tag_id)
);

-- Collections
CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  description text,
  is_public boolean DEFAULT false,
  cover_image_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE collection_items (
  collection_id uuid REFERENCES collections NOT NULL,
  item_id uuid REFERENCES items NOT NULL,
  sort_order int,
  PRIMARY KEY (collection_id, item_id)
);

-- Tab Groups
CREATE TABLE tab_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  tabs jsonb NOT NULL,
  chrome_group_color text,
  created_at timestamptz DEFAULT now()
);

-- RAG Chunks
CREATE TABLE chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES items NOT NULL,
  chunk_index int NOT NULL,
  chunk_text text NOT NULL,
  embedding vector(1536),
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Spaced Repetition Queue
CREATE TABLE review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  highlight_id uuid REFERENCES highlights NOT NULL,
  next_review_at timestamptz NOT NULL,
  difficulty float DEFAULT 0.3,
  repetitions int DEFAULT 0,
  last_reviewed_at timestamptz
);

-- Social: Follows
CREATE TABLE follows (
  follower_id uuid REFERENCES auth.users NOT NULL,
  following_id uuid REFERENCES auth.users NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (follower_id, following_id)
);

-- Social: Activity Feed
CREATE TABLE activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  action text NOT NULL CHECK (action IN ('save','highlight','note','finish','recommend')),
  item_id uuid REFERENCES items,
  highlight_id uuid REFERENCES highlights,
  is_public boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX chunks_embedding_idx ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX items_user_type_idx ON items (user_id, type);
CREATE INDEX items_user_status_idx ON items (user_id, reading_status);
CREATE INDEX highlights_item_idx ON highlights (item_id);
CREATE INDEX activity_user_idx ON activity (user_id, created_at DESC);
CREATE INDEX person_items_person_idx ON person_items (person_id);
CREATE INDEX person_items_item_idx ON person_items (item_id);

-- Row Level Security
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tab_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can read/write their own data
CREATE POLICY "Users manage own people" ON people FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own items" ON items FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own person_items" ON person_items FOR ALL
  USING (EXISTS (SELECT 1 FROM items WHERE items.id = person_items.item_id AND items.user_id = auth.uid()));
CREATE POLICY "Users manage own person_connections" ON person_connections FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own citations" ON citations FOR ALL
  USING (EXISTS (SELECT 1 FROM items WHERE items.id = citations.item_id AND items.user_id = auth.uid()));
CREATE POLICY "Users manage own highlights" ON highlights FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own notes" ON notes FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own tags" ON tags FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own item_tags" ON item_tags FOR ALL
  USING (EXISTS (SELECT 1 FROM items WHERE items.id = item_tags.item_id AND items.user_id = auth.uid()));
CREATE POLICY "Users manage own collections" ON collections FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users read public collections" ON collections FOR SELECT USING (is_public = true);
CREATE POLICY "Users manage own collection_items" ON collection_items FOR ALL
  USING (EXISTS (SELECT 1 FROM collections WHERE collections.id = collection_items.collection_id AND collections.user_id = auth.uid()));
CREATE POLICY "Users manage own tab_groups" ON tab_groups FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own chunks" ON chunks FOR ALL
  USING (EXISTS (SELECT 1 FROM items WHERE items.id = chunks.item_id AND items.user_id = auth.uid()));
CREATE POLICY "Users manage own review_queue" ON review_queue FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own follows" ON follows FOR ALL USING (auth.uid() = follower_id);
CREATE POLICY "Users manage own activity" ON activity FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users read public activity" ON activity FOR SELECT USING (is_public = true);
