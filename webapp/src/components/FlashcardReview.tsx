import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, RotateCw, Shuffle } from "lucide-react";
import { getFlashcards, type Flashcard } from "@/lib/api";
import MathContent from "./MathContent";

/**
 * Anki-like flashcard review for kt:declarative notes.
 *
 * v1: linear deck, no SRS scheduling. Front = note title, back = note content.
 * Rendered via MathContent so \(...\) and \[...\] are KaTeX'd. If the user wants
 * SRS scheduling, the natural extension is a note_reviews table keyed by note_id
 * that reuses the existing services/spaced_rep.next_review function.
 */
interface FlashcardReviewProps {
  collectionId?: string;
  collectionName?: string;
  onClose: () => void;
}

export default function FlashcardReview({
  collectionId,
  collectionName,
  onClose,
}: FlashcardReviewProps) {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [cursor, setCursor] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getFlashcards(collectionId)
      .then((res) => {
        if (cancelled) return;
        setCards(res.cards);
        setOrder(res.cards.map((_, i) => i));
        setCursor(0);
        setFlipped(false);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load flashcards");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const active = useMemo(() => {
    if (!cards.length) return null;
    const idx = order[cursor];
    return cards[idx] ?? null;
  }, [cards, order, cursor]);

  function next() {
    setFlipped(false);
    setCursor((c) => Math.min(c + 1, Math.max(order.length - 1, 0)));
  }
  function prev() {
    setFlipped(false);
    setCursor((c) => Math.max(c - 1, 0));
  }
  function shuffle() {
    setOrder((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    });
    setCursor(0);
    setFlipped(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-bg-primary rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-text-tertiary">
              Flashcards · declarative
            </div>
            <div className="text-sm font-medium text-text-primary mt-0.5">
              {collectionName || "All declarative notes"}
              {cards.length > 0 && (
                <span className="text-text-tertiary font-normal ml-2">
                  {cursor + 1} / {cards.length}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={shuffle}
              title="Shuffle"
              className="p-1.5 rounded text-text-tertiary hover:text-accent hover:bg-bg-secondary transition-warm"
            >
              <Shuffle size={14} />
            </button>
            <button
              onClick={onClose}
              title="Close"
              className="p-1.5 rounded text-text-tertiary hover:text-red-500 hover:bg-bg-secondary transition-warm"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Card */}
        <div className="p-6 min-h-[360px] flex flex-col">
          {loading && (
            <div className="flex-1 flex items-center justify-center text-text-tertiary">
              Loading…
            </div>
          )}
          {error && (
            <div className="flex-1 flex items-center justify-center text-red-500 text-sm">
              {error}
            </div>
          )}
          {!loading && !error && !active && (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="text-sm text-text-secondary">
                No declarative notes yet.
              </div>
              <div className="text-xs text-text-tertiary mt-2 max-w-sm">
                Mark a synthesis note with the <span className="font-mono">declarative</span>
                {" "}pill to add it to the deck. Notes destined for other memory systems
                (procedural, conceptual, episodic, stylistic) don't belong here.
              </div>
            </div>
          )}
          {!loading && !error && active && (
            <button
              onClick={() => setFlipped((f) => !f)}
              className="flex-1 flex flex-col justify-center text-left cursor-pointer
                         rounded-lg hover:bg-bg-secondary/40 p-4 transition-warm"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={flipped ? "back" : "front"}
                  initial={{ rotateY: flipped ? -90 : 90, opacity: 0 }}
                  animate={{ rotateY: 0, opacity: 1 }}
                  exit={{ rotateY: flipped ? 90 : -90, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="w-full"
                >
                  {!flipped && (
                    <>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-text-tertiary mb-3">
                        Front · click or space to flip
                      </div>
                      <MathContent
                        html={active.front}
                        className="text-xl font-serif text-text-primary leading-snug"
                      />
                    </>
                  )}
                  {flipped && (
                    <>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-accent mb-3">
                        Back
                      </div>
                      <MathContent
                        html={active.back}
                        className="prose prose-sm max-w-none text-text-primary leading-relaxed"
                      />
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </button>
          )}
        </div>

        {/* Footer controls */}
        {!loading && !error && active && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-bg-secondary/30">
            <button
              onClick={prev}
              disabled={cursor === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-sm
                         text-text-secondary hover:text-text-primary hover:bg-bg-primary
                         disabled:opacity-40 disabled:cursor-not-allowed transition-warm"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              onClick={() => setFlipped((f) => !f)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs
                         bg-accent text-white hover:bg-accent-hover transition-warm"
            >
              <RotateCw size={12} /> Flip
            </button>
            <button
              onClick={next}
              disabled={cursor >= order.length - 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-sm
                         text-text-secondary hover:text-text-primary hover:bg-bg-primary
                         disabled:opacity-40 disabled:cursor-not-allowed transition-warm"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
