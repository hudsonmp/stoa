/**
 * ProjectPdfAnnotationView — project-scoped PDF renderer (fork of
 * PdfAnnotationView's post-merge behaviour).
 *
 * Data targets: /project-highlights for creates, /project-notes for autosave.
 *
 * Highlight anchoring (W3C Web Annotation Data Model, Tier 1-3):
 *   At creation:
 *     - TextPositionSelector: char offsets within the page's text layer
 *     - TextQuoteSelector:    exact + 20-char prefix/suffix context
 *     - FragmentSelector:     "page=N"
 *   At render, three-tier resolver tries position → quote → substring on text.
 *
 * Autosave:
 *   First meaningful content → POST /project-notes (create) with draft_id.
 *   Subsequent keystrokes → PATCH /project-notes/:id (update).
 *   Single-flight promise + 10s timeout fallback.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Highlighter, CheckCircle2, Loader2 } from "lucide-react";
import ProjectNoteEditor from "@/components/ProjectNoteEditor";
import { updateProjectNote } from "@/lib/api";
import type {
  Highlight,
  Note,
  W3CSelector,
  TextQuoteSelector,
  TextPositionSelector,
  FragmentSelector,
} from "@/lib/supabase";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface ProjectPdfAnnotationViewProps {
  pdfUrl: string;
  highlights: Highlight[];
  notes: Note[];
  itemId: string;
  projectId?: string;
  folderId?: string;
  onCreateNote: (
    content: string,
    tags: string[],
    draft_id?: string
  ) => Promise<Note | null>;
  onCreateHighlight?: (data: {
    text: string;
    context?: string;
    page_number?: number;
    selectors?: W3CSelector[];
  }) => Promise<Highlight | null>;
}

// ── text layer utilities ────────────────────────────────────────────────────

function getPageSpans(pageEl: Element): HTMLElement[] {
  const textLayer = pageEl.querySelector(".react-pdf__Page__textContent");
  if (!textLayer) return [];
  return Array.from(textLayer.querySelectorAll<HTMLElement>("span"));
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").toLowerCase().trim();
}

function buildCharIndex(spans: HTMLElement[]): { cumLengths: number[] } {
  const cl: number[] = [];
  let total = 0;
  for (const sp of spans) {
    cl.push(total);
    total += (sp.textContent || "").length;
  }
  return { cumLengths: cl };
}

function applyPositionSelector(
  spans: HTMLElement[],
  sel: TextPositionSelector
): boolean {
  const { cumLengths } = buildCharIndex(spans);
  let marked = false;
  for (let i = 0; i < spans.length; i++) {
    const spanStart = cumLengths[i];
    const spanEnd = spanStart + (spans[i].textContent || "").length;
    if (spanEnd > sel.start && spanStart < sel.end) {
      spans[i].classList.add("pdf-highlight-mark");
      marked = true;
    }
  }
  return marked;
}

function applyQuoteSelector(
  spans: HTMLElement[],
  sel: TextQuoteSelector
): boolean {
  const needle = norm(sel.exact);
  if (!needle) return false;
  const prefix = sel.prefix ? norm(sel.prefix) : null;
  const suffix = sel.suffix ? norm(sel.suffix) : null;

  for (let start = 0; start < spans.length; start++) {
    let acc = "";
    for (let end = start; end < spans.length; end++) {
      acc += " " + norm(spans[end].textContent || "");
      if (acc.length >= needle.length && acc.includes(needle)) {
        if (prefix || suffix) {
          const before = spans
            .slice(Math.max(0, start - 3), start)
            .map((s) => norm(s.textContent || ""))
            .join(" ");
          const after = spans
            .slice(end + 1, end + 4)
            .map((s) => norm(s.textContent || ""))
            .join(" ");
          if (prefix && !before.includes(prefix)) {
            start = end;
            break;
          }
          if (suffix && !after.includes(suffix)) {
            start = end;
            break;
          }
        }
        for (let k = start; k <= end; k++) {
          spans[k].classList.add("pdf-highlight-mark");
        }
        return true;
      }
    }
  }
  return false;
}

function applySubstringFallback(
  spans: HTMLElement[],
  text: string
): boolean {
  const needle = norm(text);
  if (!needle) return false;
  for (let start = 0; start < spans.length; start++) {
    let acc = "";
    for (let end = start; end < spans.length; end++) {
      acc += " " + norm(spans[end].textContent || "");
      if (acc.length >= needle.length && acc.includes(needle)) {
        for (let k = start; k <= end; k++) {
          spans[k].classList.add("pdf-highlight-mark");
        }
        start = end;
        return true;
      }
    }
  }
  return false;
}

function resolveHighlight(pageEl: Element, hl: Highlight): boolean {
  const spans = getPageSpans(pageEl);
  if (spans.length === 0) return false;
  spans.forEach((s) => s.classList.remove("pdf-highlight-mark"));

  const selectors = hl.selectors ?? [];

  const posSelector = selectors.find(
    (s): s is TextPositionSelector => s.type === "TextPositionSelector"
  );
  if (posSelector && applyPositionSelector(spans, posSelector)) return true;

  const quoteSelector = selectors.find(
    (s): s is TextQuoteSelector => s.type === "TextQuoteSelector"
  );
  if (quoteSelector && applyQuoteSelector(spans, quoteSelector)) return true;

  return applySubstringFallback(spans, hl.text);
}

function computeSelectors(
  pageEl: Element,
  pageNum: number,
  selectedText: string
): W3CSelector[] {
  const spans = getPageSpans(pageEl);
  if (!spans.length) return [];

  const { cumLengths } = buildCharIndex(spans);
  const needle = norm(selectedText);

  let matchStart = -1;
  let matchEnd = -1;
  outer: for (let i = 0; i < spans.length; i++) {
    let acc = "";
    for (let j = i; j < spans.length; j++) {
      acc += " " + norm(spans[j].textContent || "");
      if (acc.length >= needle.length && acc.includes(needle)) {
        matchStart = cumLengths[i];
        matchEnd = cumLengths[j] + (spans[j].textContent || "").length;
        break outer;
      }
    }
  }

  const selectors: W3CSelector[] = [];

  if (matchStart >= 0) {
    selectors.push({
      type: "TextPositionSelector",
      start: matchStart,
      end: matchEnd,
    } satisfies TextPositionSelector);
  }

  const prefixSpans =
    matchStart >= 0
      ? spans.filter((_, i) => cumLengths[i] < matchStart).slice(-3)
      : [];
  const suffixSpans =
    matchEnd >= 0
      ? spans.filter((_, i) => cumLengths[i] >= matchEnd).slice(0, 3)
      : [];
  selectors.push({
    type: "TextQuoteSelector",
    exact: selectedText,
    prefix: prefixSpans.map((s) => s.textContent || "").join("").slice(-20),
    suffix: suffixSpans.map((s) => s.textContent || "").join("").slice(0, 20),
  } satisfies TextQuoteSelector);

  selectors.push({
    type: "FragmentSelector",
    value: `page=${pageNum}`,
  } satisfies FragmentSelector);

  return selectors;
}

// ── component ──────────────────────────────────────────────────────────────

export default function ProjectPdfAnnotationView({
  pdfUrl,
  highlights,
  notes,
  itemId,
  onCreateNote,
  onCreateHighlight,
}: ProjectPdfAnnotationViewProps) {
  const [numPages, setNumPages] = useState(0);
  const [noteContent, setNoteContent] = useState("");
  const [pageWidth, setPageWidth] = useState(700);
  const [bookmarkPage, setBookmarkPage] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoJumpRef = useRef(false);

  const [selectionState, setSelectionState] = useState<{
    text: string;
    pageNumber: number;
    pageEl: Element;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(`stoa-bookmark:${itemId}`);
    if (saved) setBookmarkPage(parseInt(saved));
  }, [itemId]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const handleScroll = () => {
      const pageEls = scrollEl.querySelectorAll(".pdf-page-wrapper");
      const scrollTop = scrollEl.scrollTop + scrollEl.clientHeight / 3;
      for (let i = pageEls.length - 1; i >= 0; i--) {
        if ((pageEls[i] as HTMLElement).offsetTop <= scrollTop) {
          setCurrentPage(i + 1);
          break;
        }
      }
    };
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [numPages]);

  const saveBookmark = () => {
    setBookmarkPage(currentPage);
    localStorage.setItem(`stoa-bookmark:${itemId}`, String(currentPage));
  };

  const jumpToBookmark = () => {
    if (!bookmarkPage || !scrollRef.current) return;
    const el = scrollRef.current.querySelectorAll(".pdf-page-wrapper")[
      bookmarkPage - 1
    ];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const available = containerRef.current.clientWidth - 300;
        setPageWidth(Math.min(Math.max(available - 40, 400), 900));
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: n }: { numPages: number }) => setNumPages(n),
    []
  );

  useEffect(() => {
    if (didAutoJumpRef.current || !bookmarkPage || !numPages || !scrollRef.current)
      return;
    const t = setTimeout(() => {
      const els = scrollRef.current?.querySelectorAll(".pdf-page-wrapper");
      const target = els && els[bookmarkPage - 1];
      if (target) {
        (target as HTMLElement).scrollIntoView({ behavior: "auto", block: "start" });
        didAutoJumpRef.current = true;
      }
    }, 250);
    return () => clearTimeout(t);
  }, [bookmarkPage, numPages]);

  const pageElOfNode = useCallback(
    (node: Node | null): { el: Element; num: number } | null => {
      if (!node || !scrollRef.current) return null;
      let el = (node.nodeType === 3
        ? node.parentElement
        : (node as HTMLElement)) as HTMLElement | null;
      while (el && el !== scrollRef.current) {
        if (el.classList?.contains("pdf-page-wrapper")) {
          const els = Array.from(
            scrollRef.current.querySelectorAll(".pdf-page-wrapper")
          );
          const num = els.indexOf(el) + 1;
          return { el, num };
        }
        el = el.parentElement;
      }
      return null;
    },
    []
  );

  useEffect(() => {
    function onMouseUp() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelectionState(null);
        return;
      }
      const text = sel.toString().trim();
      if (!text || text.length < 2) {
        setSelectionState(null);
        return;
      }
      const anchor = sel.anchorNode;
      const page = pageElOfNode(anchor);
      if (!page) {
        setSelectionState(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelectionState({
        text,
        pageNumber: page.num,
        pageEl: page.el,
        x: Math.max(8, rect.left + rect.width / 2),
        y: Math.max(40, rect.top - 8),
      });
    }
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [pageElOfNode]);

  const submitHighlight = useCallback(async () => {
    if (!selectionState || !onCreateHighlight) return;
    const selectors = computeSelectors(
      selectionState.pageEl,
      selectionState.pageNumber,
      selectionState.text
    );
    setSelectionState(null);
    window.getSelection()?.removeAllRanges();
    try {
      await onCreateHighlight({
        text: selectionState.text,
        page_number: selectionState.pageNumber,
        selectors,
      });
    } catch {
      /* silent */
    }
  }, [selectionState, onCreateHighlight]);

  // ── overlay rendering ────────────────────────────────────────────────────

  const highlightsByPage = useMemo(() => {
    const m = new Map<number, Highlight[]>();
    for (const h of highlights) {
      let page: number | null = h.page_number ?? null;
      if (!page && h.selectors) {
        const frag = h.selectors.find(
          (s): s is FragmentSelector => s.type === "FragmentSelector"
        );
        if (frag) {
          const m2 = frag.value.match(/page=(\d+)/);
          if (m2) page = parseInt(m2[1]);
        }
      }
      if (!page) continue;
      if (!m.has(page)) m.set(page, []);
      m.get(page)!.push(h);
    }
    return m;
  }, [highlights]);

  useEffect(() => {
    if (!scrollRef.current || !numPages) return;
    const rafId = requestAnimationFrame(() => {
      const pageEls = scrollRef.current?.querySelectorAll(".pdf-page-wrapper");
      if (!pageEls) return;
      pageEls.forEach((pageEl, i) => {
        const pageNum = i + 1;
        pageEl
          .querySelectorAll(".pdf-highlight-mark")
          .forEach((m) => m.classList.remove("pdf-highlight-mark"));
        const hls = highlightsByPage.get(pageNum);
        if (!hls || hls.length === 0) return;
        const textLayer = pageEl.querySelector(".react-pdf__Page__textContent");
        if (!textLayer) return;
        for (const hl of hls) {
          resolveHighlight(pageEl, hl);
        }
      });
    });
    return () => cancelAnimationFrame(rafId);
  }, [highlightsByPage, numPages, pageWidth]);

  // ── autosave (project_notes) ─────────────────────────────────────────────

  const [draftNoteId, setDraftNoteId] = useState<string | null>(null);
  const [noteSync, setNoteSync] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const lastSavedRef = useRef<string>("");
  const latestRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createPromiseRef = useRef<Promise<Note | null> | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const inFlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionDraftIdRef = useRef<string | null>(null);

  useEffect(() => {
    draftIdRef.current = draftNoteId;
  }, [draftNoteId]);
  useEffect(() => {
    latestRef.current = noteContent;
  }, [noteContent]);

  useEffect(() => {
    const normalized = noteContent.replace(/<br\s*\/?>(\s*)?/gi, "").trim();
    const meaningful =
      normalized.length > 0 &&
      normalized !== "<p></p>" &&
      normalized !== "<p><br></p>";
    if (!meaningful || noteContent === lastSavedRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    const scheduleSave = (delay: number) => {
      saveTimerRef.current = setTimeout(async () => {
        if (inFlightRef.current) {
          scheduleSave(250);
          return;
        }
        const payload = latestRef.current;
        if (payload === lastSavedRef.current) return;

        inFlightRef.current = true;
        setNoteSync({ kind: "saving" });

        inFlightTimeoutRef.current = setTimeout(() => {
          if (inFlightRef.current) {
            inFlightRef.current = false;
            createPromiseRef.current = null;
            setNoteSync({ kind: "error", message: "Save timed out — retrying" });
            scheduleSave(300);
          }
        }, 10_000);

        try {
          const existingId = draftIdRef.current;
          if (existingId) {
            await updateProjectNote(existingId, { content: payload });
          } else {
            if (!createPromiseRef.current) {
              if (!sessionDraftIdRef.current) {
                sessionDraftIdRef.current = crypto.randomUUID();
              }
              createPromiseRef.current = onCreateNote(
                payload,
                ["synthesis", `ref:${itemId}`],
                sessionDraftIdRef.current
              );
            }
            const created = await createPromiseRef.current;
            createPromiseRef.current = null;
            if (created?.id) {
              draftIdRef.current = created.id;
              setDraftNoteId(created.id);
              sessionDraftIdRef.current = null;
            }
          }
          lastSavedRef.current = payload;
          setNoteSync({ kind: "saved" });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Save failed";
          console.error("[project-pdf-note autosave]", err);
          setNoteSync({ kind: "error", message });
        } finally {
          if (inFlightTimeoutRef.current) {
            clearTimeout(inFlightTimeoutRef.current);
          }
          inFlightRef.current = false;
          if (latestRef.current !== lastSavedRef.current) scheduleSave(300);
        }
      }, delay);
    };

    scheduleSave(900);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteContent, itemId]);

  return (
    <div ref={containerRef} className="pdf-split-view">
      {selectionState && onCreateHighlight && (
        <button
          onClick={submitHighlight}
          className="pdf-selection-toolbar"
          style={{
            position: "fixed",
            left: selectionState.x,
            top: selectionState.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <Highlighter size={12} /> Highlight
        </button>
      )}

      <div ref={scrollRef} className="pdf-pages-scroll">
        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={<div className="pdf-page-loading">Loading PDF…</div>}
          error={<div className="pdf-page-loading">Failed to load PDF</div>}
        >
          {Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1;
            return (
              <div
                key={pageNum}
                className="pdf-page-wrapper"
                style={{ position: "relative" }}
              >
                <Page
                  pageNumber={pageNum}
                  width={pageWidth}
                  renderTextLayer={true}
                  renderAnnotationLayer={false}
                />
                <div className="pdf-page-num">{pageNum}</div>
              </div>
            );
          })}
        </Document>
      </div>

      <aside className="pdf-split-sidebar">
        <div className="pdf-bookmark-bar">
          <span className="pdf-bookmark-page">
            Page {currentPage} / {numPages}
          </span>
          <button
            onClick={saveBookmark}
            className="pdf-bookmark-btn"
            title="Bookmark"
          >
            Bookmark
          </button>
          {bookmarkPage && (
            <button onClick={jumpToBookmark} className="pdf-bookmark-jump">
              → p.{bookmarkPage}
            </button>
          )}
        </div>

        <div className="pdf-sidebar-divider" />
        <div className="pdf-sidebar-heading">Notes</div>

        <div className="pdf-sidebar-input">
          <ProjectNoteEditor
            content={noteContent}
            onSave={setNoteContent}
            placeholder="Add a note about this paper… (autosaves)"
            projectNoteId={draftNoteId ?? undefined}
          />
          <div className="pdf-sidebar-sync" aria-live="polite">
            {noteSync.kind === "saving" && (
              <span>
                <Loader2 size={11} className="pdf-sidebar-sync-spin" /> Saving…
              </span>
            )}
            {noteSync.kind === "saved" && (
              <span className="pdf-sidebar-sync-ok">
                <CheckCircle2 size={11} /> Saved
              </span>
            )}
            {noteSync.kind === "error" && (
              <span className="pdf-sidebar-sync-err" title={noteSync.message}>
                ⚠ {noteSync.message}
              </span>
            )}
            {noteSync.kind === "idle" && <span>&nbsp;</span>}
          </div>
        </div>

        {highlights.length > 0 && (
          <>
            <div className="pdf-sidebar-divider" />
            <div className="pdf-sidebar-heading">
              Highlights ({highlights.length})
            </div>
            {highlights.map((hl) => (
              <div key={hl.id} className="pdf-sidebar-card">
                <p className="pdf-sidebar-quote">&ldquo;{hl.text}&rdquo;</p>
                {hl.note && <p className="pdf-sidebar-note">{hl.note}</p>}
                <span className="pdf-sidebar-time">
                  {new Date(hl.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            ))}
          </>
        )}

        {notes.length > 0 && (
          <>
            <div className="pdf-sidebar-divider" />
            <div className="pdf-sidebar-heading">Notes ({notes.length})</div>
            {notes.map((n) => (
              <div key={n.id} className="pdf-sidebar-card">
                <div
                  className="pdf-sidebar-note-content"
                  dangerouslySetInnerHTML={{ __html: n.content }}
                />
                <span className="pdf-sidebar-time">
                  {new Date(n.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            ))}
          </>
        )}

        {highlights.length === 0 && notes.length === 0 && (
          <p className="pdf-sidebar-empty">No annotations yet.</p>
        )}
      </aside>
    </div>
  );
}

// Note: the note autosave `noteSync` state is rendered above via a derived
// React state object. The editor uses noteContent + setNoteContent to bridge.
