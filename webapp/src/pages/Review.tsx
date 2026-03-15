import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCcw, ChevronRight, Check, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Highlight } from "@/lib/supabase";

interface ReviewCard {
  id: string;
  highlight: Highlight;
  next_review_at: string;
  difficulty: number;
  repetitions: number;
}

export default function Review() {
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReviews();
  }, []);

  const loadReviews = async () => {
    setLoading(true);
    const now = new Date().toISOString();
    const { data } = await supabase
      .from("review_queue")
      .select("*, highlights(*)")
      .lte("next_review_at", now)
      .order("next_review_at")
      .limit(10);

    if (data) {
      setCards(
        data.map((d: any) => ({
          id: d.id,
          highlight: d.highlights as Highlight,
          next_review_at: d.next_review_at,
          difficulty: d.difficulty,
          repetitions: d.repetitions,
        }))
      );
    }
    setLoading(false);
  };

  const respondToCard = async (quality: number) => {
    const card = cards[currentIdx];
    if (!card) return;

    // Simple SM-2 update
    const newReps = quality >= 3 ? card.repetitions + 1 : 0;
    const intervalDays =
      newReps === 0 ? 1 : newReps === 1 ? 1 : newReps === 2 ? 6 : Math.round(card.difficulty * 6 * newReps);
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + intervalDays);

    await supabase
      .from("review_queue")
      .update({
        repetitions: newReps,
        difficulty: Math.max(1.3, card.difficulty + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))),
        next_review_at: nextReview.toISOString(),
        last_reviewed_at: new Date().toISOString(),
      })
      .eq("id", card.id);

    setRevealed(false);
    setCurrentIdx((i) => i + 1);
  };

  const current = cards[currentIdx];

  return (
    <div className="max-w-2xl mx-auto px-8 py-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3 mb-8">
          <RotateCcw size={20} className="text-accent" />
          <div>
            <h1 className="font-serif text-2xl font-semibold text-text-primary">
              Review Queue
            </h1>
            <p className="text-sm text-text-tertiary mt-1">
              {cards.length - currentIdx} cards due
            </p>
          </div>
        </div>

        {loading && (
          <p className="text-center py-20 text-sm text-text-tertiary">
            Loading...
          </p>
        )}

        {!loading && !current && (
          <div className="text-center py-20">
            <Check size={32} className="mx-auto mb-4 text-accent-green" />
            <p className="font-serif text-lg text-text-secondary">
              All caught up
            </p>
            <p className="text-sm text-text-tertiary mt-2">
              No highlights due for review right now
            </p>
          </div>
        )}

        {/* Card */}
        <AnimatePresence mode="wait">
          {current && (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
              className="bg-bg-primary border border-border rounded-modal
                         shadow-warm-lg p-8"
            >
              {/* Question side */}
              <div className="mb-6">
                <p className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-3">
                  What do you recall about this?
                </p>
                <p className="font-serif text-lg text-text-primary leading-relaxed italic">
                  &ldquo;{current.highlight.text.slice(0, 100)}
                  {current.highlight.text.length > 100 ? "..." : ""}&rdquo;
                </p>
              </div>

              {/* Reveal */}
              {!revealed ? (
                <button
                  onClick={() => setRevealed(true)}
                  className="flex items-center gap-2 text-sm text-accent
                             hover:text-accent-hover transition-warm font-medium"
                >
                  Show full highlight
                  <ChevronRight size={14} />
                </button>
              ) : (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                >
                  <div className="p-4 bg-bg-secondary rounded-card mb-6">
                    <p className="font-serif text-sm text-text-primary leading-relaxed italic">
                      &ldquo;{current.highlight.text}&rdquo;
                    </p>
                    {current.highlight.note && (
                      <p className="mt-2 text-[12px] text-text-secondary">
                        Note: {current.highlight.note}
                      </p>
                    )}
                  </div>

                  {/* Quality buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => respondToCard(1)}
                      className="flex-1 py-2.5 rounded-card bg-red-50 text-red-700
                                 text-sm font-medium hover:bg-red-100 transition-warm"
                    >
                      Again
                    </button>
                    <button
                      onClick={() => respondToCard(3)}
                      className="flex-1 py-2.5 rounded-card bg-accent-amber/10 text-accent-amber
                                 text-sm font-medium hover:bg-accent-amber/20 transition-warm"
                    >
                      Hard
                    </button>
                    <button
                      onClick={() => respondToCard(4)}
                      className="flex-1 py-2.5 rounded-card bg-accent-green/10 text-accent-green
                                 text-sm font-medium hover:bg-accent-green/20 transition-warm"
                    >
                      Good
                    </button>
                    <button
                      onClick={() => respondToCard(5)}
                      className="flex-1 py-2.5 rounded-card bg-accent/10 text-accent
                                 text-sm font-medium hover:bg-accent/20 transition-warm"
                    >
                      Easy
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Progress */}
              <div className="mt-6 flex items-center gap-2">
                {cards.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-warm ${
                      i < currentIdx
                        ? "bg-accent-green"
                        : i === currentIdx
                        ? "bg-accent"
                        : "bg-border"
                    }`}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
