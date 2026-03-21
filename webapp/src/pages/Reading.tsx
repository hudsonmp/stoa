import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  BookOpen,
  FileText,
  Headphones,
  Globe,
  MessageCircle,
  Video,
  Bookmark,
  PenLine,
  PlayCircle,
} from "lucide-react";
import type { Item } from "@/lib/supabase";
import { useItems } from "@/hooks/useItems";

const typeIcons: Record<string, typeof BookOpen> = {
  book: BookOpen,
  blog: FileText,
  paper: FileText,
  podcast: Headphones,
  page: Globe,
  tweet: MessageCircle,
  video: Video,
  writing: PenLine,
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function getProgress(item: Item): number {
  if (!item.scroll_position) return 0;
  return item.scroll_position.progress || 0;
}

function getReaderLink(item: Item): string {
  // PDFs and arXiv papers go to ItemDetail
  const url = item.url || "";
  const isArxiv = url.includes("arxiv.org");
  const isPdf = url.endsWith(".pdf") || (item.metadata as Record<string, unknown>)?.pdf_storage_path;
  if (isArxiv || isPdf) return `/item/${item.id}`;
  // Everything else goes to the URL reader
  return `/reader/${item.id}`;
}

export default function Reading() {
  const { items, loading } = useItems("reading");

  // Sort by most recently created (proxy for last read since we track scroll)
  const sorted = [...items].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        className="mb-8"
      >
        <h1 className="font-serif text-2xl font-semibold text-text-primary">
          Currently Reading
        </h1>
        <p className="text-sm text-text-tertiary mt-1 font-sans">
          <span className="font-mono text-[12px] tabular-nums">{sorted.length}</span>{" "}
          items in progress
        </p>
      </motion.div>

      {loading && sorted.length === 0 && (
        <div className="text-center py-20">
          <div className="inline-block w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin" />
          <p className="text-sm text-text-tertiary mt-3">Loading...</p>
        </div>
      )}

      {!loading && sorted.length === 0 && (
        <div className="text-center py-20">
          <BookOpen size={32} className="mx-auto mb-4 text-text-tertiary/40" />
          <p className="text-sm font-serif text-text-secondary">
            Nothing in progress
          </p>
          <p className="text-[12px] text-text-tertiary mt-2 max-w-xs mx-auto">
            Start reading an item and it will appear here
          </p>
        </div>
      )}

      <div className="space-y-1">
        {sorted.map((item, i) => {
          const Icon = typeIcons[item.type] || Bookmark;
          const progress = getProgress(item);
          const link = getReaderLink(item);

          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: i * 0.03,
                duration: 0.3,
                ease: [0.23, 1, 0.32, 1],
              }}
            >
              <Link
                to={link}
                className="group flex items-center gap-3 px-3 py-3 rounded-card
                           hover:bg-bg-secondary/70 transition-warm"
              >
                {/* Icon */}
                <div
                  className="flex-shrink-0 w-8 h-8 rounded-[4px] bg-bg-secondary
                             flex items-center justify-center overflow-hidden
                             group-hover:bg-bg-shelf transition-warm"
                >
                  {item.favicon_url ? (
                    <img
                      src={item.favicon_url}
                      alt=""
                      className="w-4 h-4 rounded-sm"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <Icon size={14} className="text-text-tertiary" />
                  )}
                </div>

                {/* Title + meta */}
                <div className="flex-1 min-w-0">
                  <span className="block text-sm font-sans font-medium text-text-primary truncate
                                   group-hover:text-accent transition-warm">
                    {item.title}
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.domain && (
                      <span className="text-[11px] font-serif italic text-text-tertiary">
                        {item.domain}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-text-tertiary">
                      {timeAgo(item.created_at)}
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="flex-shrink-0 flex items-center gap-2">
                  {progress > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="reading-progress-track">
                        <div
                          className="reading-progress-bar"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-text-tertiary tabular-nums w-7 text-right">
                        {progress}%
                      </span>
                    </div>
                  )}
                  <PlayCircle
                    size={16}
                    className="text-text-tertiary group-hover:text-accent transition-warm opacity-0 group-hover:opacity-100"
                  />
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
