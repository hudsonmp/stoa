import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ExternalLink } from "lucide-react";
import type { Item } from "@/lib/supabase";
import BookSpine from "./BookSpine";
import { Link } from "react-router-dom";

interface BookshelfProps {
  books: Item[];
}

export default function Bookshelf({ books }: BookshelfProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const expandedBook = expandedIdx !== null ? books[expandedIdx] : null;

  return (
    <div className="space-y-0">
      {/* Books row with 3D perspective */}
      <div className="bookshelf-perspective">
        <div
          className="flex items-end gap-[3px] px-6 pb-0"
          style={{ minHeight: 230 }}
        >
          {books.map((book, i) => (
            <BookSpine
              key={book.id}
              book={book}
              index={i}
              isExpanded={expandedIdx === i}
              onToggle={() =>
                setExpandedIdx(expandedIdx === i ? null : i)
              }
            />
          ))}
        </div>
      </div>

      {/* Shelf surface */}
      <div className="relative mx-2">
        <div className="shelf-ledge h-[10px] rounded-b-sm relative" />
      </div>

      {/* Expanded book detail panel */}
      <AnimatePresence>
        {expandedBook && (
          <motion.div
            key={expandedBook.id}
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{
              duration: 0.35,
              ease: [0.23, 1, 0.32, 1],
            }}
            className="overflow-hidden"
          >
            <div className="pt-6 pb-2 px-6">
              <div className="flex items-start gap-6">
                {/* Cover thumbnail */}
                {expandedBook.cover_image_url && (
                  <img
                    src={expandedBook.cover_image_url}
                    alt={expandedBook.title}
                    className="w-20 h-28 object-cover rounded-card shadow-warm-md flex-shrink-0"
                  />
                )}

                <div className="flex-1 min-w-0">
                  <h3 className="font-serif text-xl font-medium text-text-primary leading-snug">
                    {expandedBook.title}
                  </h3>

                  <div className="flex items-center gap-3 mt-2 text-sm text-text-secondary">
                    {expandedBook.domain && (
                      <span className="font-mono text-[11px] text-text-tertiary">
                        {expandedBook.domain}
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-text-tertiary capitalize">
                      {expandedBook.reading_status.replace("_", " ")}
                    </span>
                  </div>

                  {expandedBook.summary && (
                    <p className="mt-3 text-sm text-text-secondary leading-relaxed line-clamp-3">
                      {expandedBook.summary}
                    </p>
                  )}

                  <div className="flex items-center gap-3 mt-4">
                    <Link
                      to={`/item/${expandedBook.id}`}
                      className="inline-flex items-center gap-1.5 text-sm text-accent
                                 hover:text-accent-hover transition-warm font-medium"
                    >
                      View details
                      <ChevronRight size={14} />
                    </Link>
                    {expandedBook.url && (
                      <a
                        href={expandedBook.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-text-tertiary
                                   hover:text-text-secondary transition-warm"
                      >
                        Open
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
