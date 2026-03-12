"use client";

import type { Item } from "@/lib/supabase";
import Link from "next/link";
import {
  BookOpen,
  FileText,
  Headphones,
  Globe,
  MessageCircle,
  Video,
  Bookmark,
} from "lucide-react";

const typeIcons: Record<string, typeof BookOpen> = {
  book: BookOpen,
  blog: FileText,
  paper: FileText,
  podcast: Headphones,
  page: Globe,
  tweet: MessageCircle,
  video: Video,
};

const statusColors: Record<string, string> = {
  to_read: "bg-amber-500/20 text-amber-400",
  reading: "bg-blue-500/20 text-blue-400",
  read: "bg-emerald-500/20 text-emerald-400",
};

export default function ItemCard({ item }: { item: Item }) {
  const Icon = typeIcons[item.type] || Bookmark;

  return (
    <Link
      href={`/item/${item.id}`}
      className="group flex items-center gap-3 p-3 rounded-lg
                 hover:bg-surface-2 transition-colors border border-transparent
                 hover:border-border"
    >
      {/* Favicon or type icon */}
      <div className="flex-shrink-0 w-8 h-8 rounded-md bg-surface-2
                      flex items-center justify-center overflow-hidden">
        {item.favicon_url ? (
          <img
            src={item.favicon_url}
            alt=""
            className="w-5 h-5"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <Icon size={16} className="text-muted" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium truncate group-hover:text-accent
                       transition-colors">
          {item.title}
        </h3>
        <div className="flex items-center gap-2 mt-0.5">
          {item.domain && (
            <span className="text-xs text-muted truncate">{item.domain}</span>
          )}
          <span className="text-xs text-muted/50">
            {new Date(item.created_at).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Status badge */}
      <span
        className={`text-[10px] px-2 py-0.5 rounded-full font-medium
                    ${statusColors[item.reading_status]}`}
      >
        {item.reading_status.replace("_", " ")}
      </span>
    </Link>
  );
}
