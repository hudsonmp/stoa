"use client";

import { useState, useEffect } from "react";
import { getNextReviews, respondToReview } from "@/lib/api";
import Link from "next/link";
import { ArrowLeft, RotateCcw, ThumbsDown, Minus, ThumbsUp, Zap } from "lucide-react";

interface ReviewItem {
  id: string;
  next_review_at: string;
  difficulty: number;
  repetitions: number;
  highlights: {
    text: string;
    context?: string;
    note?: string;
  };
}

export default function ReviewPage() {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReviews();
  }, []);

  const loadReviews = async () => {
    try {
      // TODO: get real user ID from auth
      const data = await getNextReviews("", 10);
      setReviews((data.reviews as ReviewItem[]) || []);
    } catch {
      // API may not be running
    }
    setLoading(false);
  };

  const handleResponse = async (quality: number) => {
    const review = reviews[currentIdx];
    if (!review) return;

    await respondToReview(review.id, quality);
    setShowAnswer(false);

    if (currentIdx < reviews.length - 1) {
      setCurrentIdx(currentIdx + 1);
    } else {
      loadReviews();
      setCurrentIdx(0);
    }
  };

  const current = reviews[currentIdx];

  return (
    <div className="min-h-screen max-w-2xl mx-auto p-8">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted
                  hover:text-foreground mb-8 transition-colors"
      >
        <ArrowLeft size={16} />
        Library
      </Link>

      <div className="flex items-center gap-3 mb-8">
        <RotateCcw size={20} className="text-accent" />
        <div>
          <h1 className="text-xl font-bold">Review Queue</h1>
          <p className="text-sm text-muted">
            {reviews.length} highlights due for review
          </p>
        </div>
      </div>

      {loading && (
        <div className="text-center py-16 text-muted text-sm">Loading...</div>
      )}

      {!loading && reviews.length === 0 && (
        <div className="text-center py-16">
          <RotateCcw size={32} className="mx-auto mb-3 text-muted/50" />
          <p className="text-muted text-sm">No reviews due right now</p>
          <p className="text-xs text-muted/60 mt-1">
            Highlights you save will appear here for spaced review
          </p>
        </div>
      )}

      {current && (
        <div className="space-y-6">
          {/* Progress */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${((currentIdx + 1) / reviews.length) * 100}%`,
                }}
              />
            </div>
            <span className="text-xs text-muted">
              {currentIdx + 1}/{reviews.length}
            </span>
          </div>

          {/* Card */}
          <div className="rounded-xl border border-border bg-surface p-8">
            {/* Highlight text */}
            <blockquote className="text-lg leading-relaxed border-l-2
                                  border-accent pl-4 mb-6">
              {current.highlights.text}
            </blockquote>

            {/* Context (hidden until reveal) */}
            {!showAnswer ? (
              <button
                onClick={() => setShowAnswer(true)}
                className="w-full py-3 rounded-lg border border-border
                          text-sm text-muted hover:text-foreground
                          hover:bg-surface-2 transition-colors"
              >
                Reveal context
              </button>
            ) : (
              <>
                {current.highlights.context && (
                  <div className="mb-4 p-3 rounded-lg bg-surface-2 text-sm
                                text-muted leading-relaxed">
                    {current.highlights.context}
                  </div>
                )}
                {current.highlights.note && (
                  <div className="mb-4 p-3 rounded-lg bg-accent-dim text-sm
                                text-accent/80">
                    Note: {current.highlights.note}
                  </div>
                )}

                {/* Response buttons */}
                <div className="grid grid-cols-4 gap-2 mt-6">
                  <button
                    onClick={() => handleResponse(0)}
                    className="flex flex-col items-center gap-1 py-3 rounded-lg
                              border border-red-500/30 text-red-400
                              hover:bg-red-500/10 transition-colors text-xs"
                  >
                    <ThumbsDown size={16} />
                    Forgot
                  </button>
                  <button
                    onClick={() => handleResponse(1)}
                    className="flex flex-col items-center gap-1 py-3 rounded-lg
                              border border-amber-500/30 text-amber-400
                              hover:bg-amber-500/10 transition-colors text-xs"
                  >
                    <Minus size={16} />
                    Hard
                  </button>
                  <button
                    onClick={() => handleResponse(2)}
                    className="flex flex-col items-center gap-1 py-3 rounded-lg
                              border border-blue-500/30 text-blue-400
                              hover:bg-blue-500/10 transition-colors text-xs"
                  >
                    <ThumbsUp size={16} />
                    Good
                  </button>
                  <button
                    onClick={() => handleResponse(3)}
                    className="flex flex-col items-center gap-1 py-3 rounded-lg
                              border border-emerald-500/30 text-emerald-400
                              hover:bg-emerald-500/10 transition-colors text-xs"
                  >
                    <Zap size={16} />
                    Easy
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
