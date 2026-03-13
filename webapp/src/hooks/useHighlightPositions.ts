/**
 * useHighlightPositions — Computes vertical positions for margin annotation cards
 * that align with their corresponding <mark> elements in the reader.
 *
 * Design principle (Curius pattern): Annotations should appear at the same
 * vertical position as the text they reference. When highlights are close together,
 * cards stack with a minimum gap to prevent overlap.
 *
 * Returns a Map<highlightId, topOffset> relative to the margin container.
 */

import { useState, useEffect, useCallback, useRef } from "react";

const MIN_CARD_GAP = 8; // Minimum px between stacked cards
const CARD_MIN_HEIGHT = 64; // Estimated minimum card height in px

interface PositionMap {
  [highlightId: string]: number;
}

export function useHighlightPositions(
  highlightIds: string[],
  /** Ref to the scrollable reader page container */
  scrollContainerRef: React.RefObject<HTMLElement | null>,
  /** Ref to the margin aside element */
  marginRef: React.RefObject<HTMLElement | null>,
  /** Dependency trigger — increment to force recalc (e.g., after highlight list changes) */
  version: number
): PositionMap {
  const [positions, setPositions] = useState<PositionMap>({});
  const rafRef = useRef<number>(0);

  const compute = useCallback(() => {
    const scrollEl = scrollContainerRef.current;
    const marginEl = marginRef.current;
    if (!scrollEl || !marginEl || highlightIds.length === 0) {
      setPositions({});
      return;
    }

    const marginRect = marginEl.getBoundingClientRect();
    // The offset from the top of the margin to where positioned cards start
    // (after the "Annotations" heading + note input, approximately)
    const marginTopPadding = 0;

    const raw: { id: string; top: number }[] = [];

    for (const hlId of highlightIds) {
      const markEl = document.getElementById(`hl-${hlId}`);
      if (!markEl) continue;

      const markRect = markEl.getBoundingClientRect();
      // Position relative to the margin container
      const relativeTop = markRect.top - marginRect.top + marginTopPadding;
      raw.push({ id: hlId, top: relativeTop });
    }

    if (raw.length === 0) {
      setPositions({});
      return;
    }

    // Sort by vertical position
    raw.sort((a, b) => a.top - b.top);

    // Collision avoidance: push overlapping cards down
    const resolved: PositionMap = {};
    let lastBottom = -Infinity;

    for (const entry of raw) {
      let top = entry.top;
      // Ensure minimum gap from previous card
      if (top < lastBottom + MIN_CARD_GAP) {
        top = lastBottom + MIN_CARD_GAP;
      }
      resolved[entry.id] = top;
      lastBottom = top + CARD_MIN_HEIGHT;
    }

    setPositions(resolved);
  }, [highlightIds, scrollContainerRef, marginRef]);

  // Recompute on mount, scroll, resize, and version changes
  useEffect(() => {
    compute();

    const scrollEl = scrollContainerRef.current;
    const handleScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    };

    scrollEl?.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      scrollEl?.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [compute, scrollContainerRef, version]);

  return positions;
}
