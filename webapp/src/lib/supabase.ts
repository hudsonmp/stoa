import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types matching our database schema
export interface Person {
  id: string;
  user_id: string;
  name: string;
  bio?: string;
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
  type: "book" | "blog" | "paper" | "podcast" | "page" | "tweet" | "video";
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

export interface Highlight {
  id: string;
  item_id: string;
  user_id: string;
  text: string;
  context?: string;
  css_selector?: string;
  start_offset?: number;
  end_offset?: number;
  color: string;
  note?: string;
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
  cover_image_url?: string;
  created_at: string;
}

export interface Citation {
  id: string;
  item_id: string;
  authors?: { name: string; affiliation?: string }[];
  year?: number;
  venue?: string;
  doi?: string;
  arxiv_id?: string;
  bibtex?: string;
  abstract?: string;
  pdf_storage_path?: string;
  csl_json?: Record<string, unknown>;
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
