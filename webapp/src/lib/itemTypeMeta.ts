// Shared item-type metadata — used by Finder, AddItemModal, and ItemDetail.
// Kept in sync across feat/projects and feat/multi-content branches.

import { BookOpen, FileText, Globe, Headphones, Image, Mail, MessageSquare, Github, Twitter, Video, PenLine } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ItemType =
  | "book"
  | "blog"
  | "paper"
  | "podcast"
  | "page"
  | "tweet"
  | "video"
  | "writing"
  | "gdoc"
  | "email_thread"
  | "github_repo"
  | "image";

export interface ItemTypeMeta {
  icon: LucideIcon;
  label: string;
  pill: string;
  urlInput: boolean;
  color: string;
}

export const ITEM_TYPE_META: Record<ItemType, ItemTypeMeta> = {
  book:        { icon: BookOpen,     label: "Book",          pill: "book",        urlInput: true,  color: "#8B4513" },
  blog:        { icon: Globe,        label: "Blog Post",     pill: "blog",        urlInput: true,  color: "#2563EB" },
  paper:       { icon: FileText,     label: "Paper",         pill: "paper",       urlInput: true,  color: "#7C3AED" },
  podcast:     { icon: Headphones,   label: "Podcast",       pill: "podcast",     urlInput: true,  color: "#DB2777" },
  page:        { icon: Globe,        label: "Web Page",      pill: "page",        urlInput: true,  color: "#059669" },
  tweet:       { icon: Twitter,      label: "Tweet",         pill: "tweet",       urlInput: true,  color: "#0EA5E9" },
  video:       { icon: Video,        label: "Video",         pill: "video",       urlInput: true,  color: "#DC2626" },
  writing:     { icon: PenLine,      label: "Writing",       pill: "writing",     urlInput: false, color: "#78350F" },
  gdoc:        { icon: FileText,     label: "Google Doc",    pill: "gdoc",        urlInput: true,  color: "#1A73E8" },
  email_thread: { icon: Mail,        label: "Email Thread",  pill: "email",       urlInput: false, color: "#EA4335" },
  github_repo: { icon: Github,       label: "GitHub Repo",   pill: "github",      urlInput: true,  color: "#24292F" },
  image:       { icon: Image,        label: "Image",         pill: "image",       urlInput: false, color: "#6366F1" },
};

export const URL_INGESTIBLE_TYPES: ItemType[] = Object.entries(ITEM_TYPE_META)
  .filter(([, m]) => m.urlInput)
  .map(([k]) => k as ItemType);

export const ALL_ITEM_TYPES: ItemType[] = Object.keys(ITEM_TYPE_META) as ItemType[];
