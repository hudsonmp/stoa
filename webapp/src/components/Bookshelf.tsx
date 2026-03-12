"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Item } from "@/lib/supabase";

interface BookshelfProps {
  books: Item[];
  onSelectBook?: (book: Item) => void;
}

const SPINE_W = 42;
const COVER_W = SPINE_W * 4;
const BOOK_H = 220;
const GAP = 12;

export default function Bookshelf({ books, onSelectBook }: BookshelfProps) {
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [scroll, setScroll] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportW, setViewportW] = useState(0);

  const booksInView = useMemo(
    () => Math.floor(viewportW / (SPINE_W + GAP)),
    [viewportW]
  );

  const maxScroll = useMemo(
    () =>
      Math.max(
        0,
        (SPINE_W + GAP) * (books.length - booksInView) +
          (selectedIdx > -1 ? COVER_W : 0) +
          5
      ),
    [books.length, booksInView, selectedIdx]
  );

  const boundedScroll = useCallback(
    (val: number) => setScroll(Math.max(0, Math.min(maxScroll, val))),
    [maxScroll]
  );

  useEffect(() => {
    if (!viewportRef.current) return;
    const ro = new ResizeObserver((entries) => {
      setViewportW(entries[0].contentRect.width);
    });
    ro.observe(viewportRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (selectedIdx > -1) {
      boundedScroll(
        (selectedIdx - (booksInView - 4.5) / 2) * (SPINE_W + GAP - 1)
      );
    }
  }, [selectedIdx, booksInView, boundedScroll]);

  const scrollBy = (delta: number) => {
    setScroll((s) => Math.max(0, Math.min(maxScroll, s + delta)));
  };

  const defaultColors = [
    "#1a1a2e", "#16213e", "#0f3460", "#533483",
    "#2c3e50", "#34495e", "#1b2631", "#4a235a",
    "#1c2833", "#283747",
  ];

  return (
    <div className="relative">
      {/* Paper texture SVG filter */}
      <svg className="absolute inset-0 invisible" aria-hidden>
        <defs>
          <filter id="paper" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="8"
              result="noise"
            />
            <feDiffuseLighting
              in="noise"
              lightingColor="white"
              surfaceScale="1"
              result="diffLight"
            >
              <feDistantLight azimuth="45" elevation="35" />
            </feDiffuseLighting>
          </filter>
        </defs>
      </svg>

      {/* Scroll left */}
      {scroll > 0 && (
        <button
          onClick={() => scrollBy(-200)}
          className="absolute left-0 top-0 h-full z-10 flex items-center
                     -ml-8 w-8 justify-center rounded-md hover:bg-white/5
                     transition-colors"
        >
          <ChevronLeft size={16} className="text-muted" />
        </button>
      )}

      {/* Books viewport */}
      <div ref={viewportRef} className="overflow-hidden">
        <div className="flex items-center gap-[12px]" style={{ height: BOOK_H }}>
          {books.map((book, i) => {
            const isSelected = i === selectedIdx;
            const spineColor =
              book.spine_color || defaultColors[i % defaultColors.length];
            const textColor = book.text_color || "#e0e0e0";

            return (
              <motion.button
                key={book.id}
                onClick={() => {
                  if (isSelected) {
                    setSelectedIdx(-1);
                  } else {
                    setSelectedIdx(i);
                    onSelectBook?.(book);
                  }
                }}
                className="flex flex-row items-center justify-start
                           outline-none flex-shrink-0"
                style={{ perspective: 1000 }}
                animate={{
                  x: -scroll,
                  width: isSelected ? SPINE_W + COVER_W : SPINE_W,
                }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 25,
                  mass: 0.8,
                }}
              >
                {/* Spine */}
                <motion.div
                  className="flex items-start justify-center flex-shrink-0
                             brightness-80 contrast-200 relative"
                  style={{
                    width: SPINE_W,
                    height: BOOK_H,
                    backgroundColor: spineColor,
                    color: textColor,
                    transformOrigin: "right",
                    transformStyle: "preserve-3d",
                  }}
                  animate={{
                    rotateY: isSelected ? -60 : 0,
                  }}
                  transition={{ duration: 0.5, ease: "easeInOut" }}
                >
                  <span
                    className="pointer-events-none absolute inset-0 z-50 opacity-40"
                    style={{ filter: "url(#paper)" }}
                  />
                  <span
                    className="mt-3 text-xs font-medium select-none
                               overflow-hidden text-ellipsis whitespace-nowrap"
                    style={{
                      writingMode: "vertical-rl",
                      maxHeight: BOOK_H - 24,
                      fontFamily: '"DM Sans", system-ui, sans-serif',
                    }}
                  >
                    {book.title}
                  </span>
                </motion.div>

                {/* Cover */}
                <motion.div
                  className="flex-shrink-0 overflow-hidden relative
                             brightness-80 contrast-200"
                  style={{
                    width: COVER_W,
                    height: BOOK_H,
                    transformOrigin: "left",
                    transformStyle: "preserve-3d",
                  }}
                  animate={{
                    rotateY: isSelected ? 30 : 88.8,
                  }}
                  transition={{ duration: 0.5, ease: "easeInOut" }}
                >
                  <span
                    className="pointer-events-none absolute inset-0 z-50 opacity-40"
                    style={{ filter: "url(#paper)" }}
                  />
                  <span
                    className="pointer-events-none absolute inset-0 z-50"
                    style={{
                      background:
                        "linear-gradient(to right, rgba(255,255,255,0) 2px, rgba(255,255,255,0.5) 3px, rgba(255,255,255,0.25) 4px, rgba(255,255,255,0.25) 6px, transparent 7px, transparent 9px, rgba(255,255,255,0.25) 9px, transparent 12px)",
                    }}
                  />
                  {book.cover_image_url ? (
                    <img
                      src={book.cover_image_url}
                      alt={book.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center
                                 p-4 text-center text-sm"
                      style={{ backgroundColor: spineColor, color: textColor }}
                    >
                      {book.title}
                    </div>
                  )}
                </motion.div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Scroll right */}
      {scroll < maxScroll && (
        <button
          onClick={() => scrollBy(200)}
          className="absolute right-0 top-0 h-full z-10 flex items-center
                     -mr-8 w-8 justify-center rounded-md hover:bg-white/5
                     transition-colors"
        >
          <ChevronRight size={16} className="text-muted" />
        </button>
      )}

      {/* Shelf surface */}
      <div
        className="w-full h-3 rounded-b-sm mt-px"
        style={{
          background:
            "linear-gradient(to bottom, #2a1f14 0%, #1a1510 40%, #0f0d0a 100%)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
      />
    </div>
  );
}
