import { useEffect, useRef } from "react";
import "katex/dist/katex.min.css";

/**
 * Renders HTML content with inline LaTeX math via KaTeX auto-render.
 *
 * Supports: \(...\), \[...\], $$...$$, $...$.
 * Hamming's book (and most scientific writing) uses \(...\) and \[...\] — those are the
 * defaults here. Single-$ is included for Markdown compatibility but risks false positives
 * on prose with dollar amounts; disable via $-delimiters if that becomes a problem.
 *
 * Use as a read-only renderer (e.g. in flashcard view). The TipTap editor shows raw
 * source while editing; this view shows rendered output.
 */
interface MathContentProps {
  html: string;
  className?: string;
}

export default function MathContent({ html, className }: MathContentProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    import("katex/contrib/auto-render")
      .then((mod) => {
        if (cancelled || !ref.current) return;
        const renderMathInElement = mod.default;
        renderMathInElement(ref.current, {
          delimiters: [
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
          ],
          throwOnError: false,
          strict: "ignore",
        });
      })
      .catch(() => {
        // katex not loaded; fall through to raw HTML
      });
    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <div
      ref={ref}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
