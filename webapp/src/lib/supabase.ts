import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "placeholder";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ----------------------------------------------------------------
// Database types matching Supabase schema
// ----------------------------------------------------------------

export interface Person {
  id: string;
  user_id: string;
  name: string;
  bio?: string;
  email?: string;
  website_url?: string;
  twitter_handle?: string;
  avatar_url?: string;
  affiliation?: string;
  role?: string;
  tags?: string[];
  notes?: string;
  created_at: string;
}

export interface Item {
  id: string;
  user_id: string;
  url?: string;
  title: string;
  type: "book" | "blog" | "paper" | "podcast" | "page" | "tweet" | "video" | "writing";
  favicon_url?: string;
  cover_image_url?: string;
  spine_color?: string;
  text_color?: string;
  domain?: string;
  scroll_position?: { x: number; y: number; progress: number };
  reading_status: "to_read" | "reading" | "read";
  metadata?: Record<string, unknown>;
  extracted_text?: string;
  summary?: string;
  created_at: string;
}

// W3C Web Annotation Data Model selectors
// https://www.w3.org/TR/annotation-model/#selectors
export interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface TextPositionSelector {
  type: "TextPositionSelector";
  start: number;
  end: number;
}

export interface FragmentSelector {
  type: "FragmentSelector";
  value: string; // e.g. "page=3"
}

export type W3CSelector = TextQuoteSelector | TextPositionSelector | FragmentSelector;

export interface Highlight {
  id: string;
  item_id: string;
  user_id: string;
  text: string;
  context?: string;
  color: string;
  note?: string;
  page_number?: number | null;
  // W3C Web Annotation selectors — three-tier anchor for reliable re-rendering.
  // Tier 1: TextPositionSelector (fast, exact offset in page text layer).
  // Tier 2: TextQuoteSelector (fuzzy context match, survives minor text drift).
  // Tier 3: substring fallback on highlights.text (legacy behaviour).
  selectors?: W3CSelector[] | null;
  created_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  item_id?: string;
  person_id?: string;
  title?: string;
  content: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface Collection {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  is_public: boolean;
  created_at: string;
}

export interface Citation {
  id: string;
  item_id: string;
  authors?: { name: string }[];
  year?: number;
  venue?: string;
  doi?: string;
  arxiv_id?: string;
  abstract?: string;
}

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color?: string;
}

export interface Activity {
  id: string;
  user_id: string;
  action: "save" | "highlight" | "note" | "finish" | "recommend";
  item_id?: string;
  highlight_id?: string;
  is_public: boolean;
  created_at: string;
}
