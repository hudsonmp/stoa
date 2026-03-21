import { useState } from "react";
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
  Trash2,
} from "lucide-react";
import { deleteItem } from "@/lib/api";
import type { Item } from "@/lib/supabase";

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

interface ItemRowProps {
  item: Item;
  index?: number;
  onDeleted?: () => void;
}

export default function ItemRow({ item, index = 0, onDeleted }: ItemRowProps) {
  const Icon = typeIcons[item.type] || Bookmark;
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteItem(item.id);
      onDeleted?.();
    } catch {
      setDeleting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: deleting ? 0.3 : 1, y: 0 }}
      transition={{
        delay: index * 0.03,
        duration: 0.3,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      <Link
        to={`/item/${item.id}`}
        className="group flex items-center gap-3 px-3 py-2.5 rounded-card
                   hover:bg-bg-secondary/70 hover:translate-x-0.5
                   transition-warm"
      >
        {/* Favicon or type icon */}
        <div
          className="flex-shrink-0 w-7 h-7 rounded-[4px] bg-bg-secondary
                     flex items-center justify-center overflow-hidden
                     group-hover:bg-bg-shelf transition-warm"
        >
          {item.favicon_url ? (
            <img
              src={item.favicon_url}
              alt=""
              className="w-4 h-4 rounded-sm"
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.style.display = "none";
                el.nextElementSibling?.classList.remove("hidden");
              }}
            />
          ) : null}
          <Icon
            size={14}
            className={`text-text-tertiary group-hover:text-text-secondary transition-warm ${
              item.favicon_url ? "hidden" : ""
            }`}
          />
        </div>

        {/* Title */}
        <span
          className="flex-1 min-w-0 text-sm font-sans font-medium text-text-primary
                     truncate group-hover:text-accent transition-warm"
        >
          {item.title}
        </span>

        {/* Resume reading indicator */}
        {item.scroll_position && item.scroll_position.progress > 0 && item.scroll_position.progress < 100 && (
          <span className="flex-shrink-0 flex items-center gap-1" title={`${item.scroll_position.progress}% read`}>
            <div className="reading-progress-track">
              <div
                className="reading-progress-bar"
                style={{ width: `${item.scroll_position.progress}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-text-tertiary tabular-nums">
              {item.scroll_position.progress}%
            </span>
          </span>
        )}

        {/* Domain in italic serif */}
        {item.domain && (
          <span className="flex-shrink-0 text-[12px] font-serif italic text-text-tertiary">
            {item.domain}
          </span>
        )}

        {/* Delete button — visible on hover */}
        <button
          onClick={handleDelete}
          className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100
                     hover:bg-red-50 hover:text-red-500 text-text-tertiary
                     transition-warm"
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
      </Link>
    </motion.div>
  );
}
