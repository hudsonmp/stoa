/**
 * PdfAnnotationView — PDF renderer with W3C-anchored highlight overlays.
 *
 * Highlight anchoring (W3C Web Annotation Data Model, Tier 1-3):
 *
 *   At creation:
 *     The selection handler computes three selectors from the pdfjs text layer:
 *       - TextPositionSelector: char offsets within the page's concatenated text
 *       - TextQuoteSelector:    exact + 20-char prefix/suffix context
 *       - FragmentSelector:     page number as "page=N"
 *     All three are stored in highlights.selectors (JSONB).
 *
 *   At render:
 *     Three-tier resolver per highlight:
 *       Tier 1 — TextPositionSelector: walk page spans, count chars, mark the
 *                span run that falls within [start, end]. Fails only if pdfjs
 *                text layer produces different char counts across renders (rare).
 *       Tier 2 — TextQuoteSelector: find the span run whose concatenated text
 *                contains `exact`, anchored by prefix/suffix context. Handles
 *                minor ligature repair drift.
 *       Tier 3 — Substring fallback on highlights.text. Legacy behaviour,
 *                always attempted for highlights that pre-date this migration.
 *
 * Autosave (note editor):
 *   First meaningful content → POST /notes (create).
 *   Subsequent keystrokes → PATCH /notes/:id (update), deduplicated via a
 *   single-flight promise on draftIdRef. No duplicate creates under rapid typing.
 *   10-second timeout on in-flight saves — force-clears if the network hangs.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Highlighter, CheckCircle2, Loader2 } from "lucide-react";
import NoteEditor from "@/components/NoteEditor";
import { updateNote } from "@/lib/api";
import type {
  Highlight,
  Note,
  W3CSelector,
  TextQuoteSelector,
  TextPositionSelector,
  FragmentSelector,
} from "@/lib/supabase";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID;

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (DEV_USER_ID) { h["X-User-Id"] = DEV_USER_ID; return h; }
  const token = localStorage.getItem("stoa_token");
  const uid = localStorage.getItem("stoa_user_id");
  if (token) h["Authorization"] = `Bearer ${token}`;
  else if (uid) h["X-User-Id"] = uid;
  return h;
}

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfAnnotationViewProps {
  pdfUrl: string;
  highlights: Highlight[];
  notes: Note[];
  itemId: string;
  onCreateNote: (content: string, tags: string[], draft_id?: string) => Promise<Note | null>;
  onCreateHighlight?: (data: {
    text: string;
    context?: string;
    page_number?: number;
    selectors?: W3CSelector[];
  }) => Promise<Highlight | null>;
}

// ---------------------------------------------------------------------------
// Text-layer utilities
// ---------------------------------------------------------------------------

/** Collect all text spans in a page's text layer in DOM order. */
function getPageSpans(pageEl: Element): HTMLElement[] {
  const textLayer = pageEl.querySelector(".react-pdf__Page__textContent");
  if (!textLayer) return [];
  return Array.from(textLayer.querySelectorAll<HTMLElement>("span"));
}

/** Normalize for fuzzy matching: collapse whitespace, lowercase. */
function norm(s: string): string {
  return s.replace(/\s+/g, " ").toLowerCase().trim();
}

/**
 * Build a character-position index for a page's spans.
 * Returns {spans, cumLengths} where cumLengths[i] = total chars before span i.
 */
function buildCharIndex(spans: HTMLElement[]): { cumLengths: number[] } {
  const cl: number[] = [];
  let total = 0;
  for (const sp of spans) {
    cl.push(total);
    total += (sp.textContent || "").length;
  }
  return { cumLengths: cl };
}

/**
 * Tier 1 resolver — TextPositionSelector.
 * Marks spans whose character range intersects [start, end] in the page's text.
 */
function applyPositionSelector(
  spans: HTMLElement[],
  sel: TextPositionSelector,
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

/**
 * Tier 2 resolver — TextQuoteSelector.
 * Sliding-window substring search; anchors on prefix/suffix if available.
 */
function applyQuoteSelector(
  spans: HTMLElement[],
  sel: TextQuoteSelector,
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
        // Optionally verify context anchors (improves specificity on repeated phrases)
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
            start = end; // skip — context mismatch
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

/**
 * Tier 3 resolver — substring fallback on highlight.text.
 * Identical to the legacy implementation.
 */
function applySubstringFallback(
  spans: HTMLElement[],
  text: string,
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

/**
 * Three-tier resolver. Tries each tier in order, stops at first success.
 */
function resolveHighlight(pageEl: Element, hl: Highlight): boolean {
  const spans = getPageSpans(pageEl);
  if (spans.length === 0) return false;

  // Clear previous marks on this page
  spans.forEach((s) => s.classList.remove("pdf-highlight-mark"));

  const selectors = hl.selectors ?? [];

  // Tier 1 — TextPositionSelector
  const posSelector = selectors.find(
    (s): s is TextPositionSelector => s.type === "TextPositionSelector",
  );
  if (posSelector && applyPositionSelector(spans, posSelector)) return true;

  // Tier 2 — TextQuoteSelector
  const quoteSelector = selectors.find(
    (s): s is TextQuoteSelector => s.type === "TextQuoteSelector",
  );
  if (quoteSelector && applyQuoteSelector(spans, quoteSelector)) return true;

  // Tier 3 — substring fallback
  return applySubstringFallback(spans, hl.text);
}

// ---------------------------------------------------------------------------
// Selector computation at highlight-creation time
// ---------------------------------------------------------------------------

/**
 * Build all three selectors from the DOM selection + page text layer.
 * Called after the user selects text in the PDF viewer.
 */
function computeSelectors(
  pageEl: Element,
  pageNum: number,
  selectedText: string,
): W3CSelector[] {
  const spans = getPageSpans(pageEl);
  if (!spans.length) return [];

  const { cumLengths } = buildCharIndex(spans);
  const needle = norm(selectedText);

  // Find the span range containing the selection
  let matchStart = -1;
  let matchEnd = -1;
  outer: for (let i = 0; i < spans.length; i++) {
    let acc = "";
    for (let j = i; j < spans.length; j++) {
      acc += " " + norm(spans[j].textContent || "");
      if (acc.length >= needle.length && acc.includes(needle)) {
        matchStart = cumLengths[i];
        matchEnd =
          cumLengths[j] + (spans[j].textContent || "").length;
        break outer;
      }
    }
  }

  const selectors: W3CSelector[] = [];

  // TextPositionSelector
  if (matchStart >= 0) {
    selectors.push({
      type: "TextPositionSelector",
      start: matchStart,
      end: matchEnd,
    } satisfies TextPositionSelector);
  }

  // TextQuoteSelector — 20-char prefix/suffix from surrounding spans
  const prefixSpans = matchStart >= 0
    ? spans.filter((_, i) => cumLengths[i] < matchStart).slice(-3)
    : [];
  const suffixSpans = matchEnd >= 0
    ? spans.filter((_, i) => cumLengths[i] >= matchEnd).slice(0, 3)
    : [];
  selectors.push({
    type: "TextQuoteSelector",
    exact: selectedText,
    prefix: prefixSpans.map((s) => s.textContent || "").join("").slice(-20),
    suffix: suffixSpans.map((s) => s.textContent || "").join("").slice(0, 20),
  } satisfies TextQuoteSelector);

  // FragmentSelector — page number
  selectors.push({
    type: "FragmentSelector",
    value: `page=${pageNum}`,
  } satisfies FragmentSelector);

  return selectors;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PdfAnnotationView({
  pdfUrl,
  highlights,
  notes,
  itemId,
  onCreateNote,
  onCreateHighlight,
}: PdfAnnotationViewProps) {
  const [numPages, setNumPages] = useState(0);
  const [noteContent, setNoteContent] = useState("");
  const [pageWidth, setPageWidth] = useState(700);
  const [bookmarkPage, setBookmarkPage] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoJumpRef = useRef(false);

  // Floating selection toolbar state
  const [selectionState, setSelectionState] = useState<{
    text: string;
    pageNumber: number;
    pageEl: Element;
    x: number;
    y: number;
  } | null>(null);

  // Load saved bookmark
  useEffect(() => {
    const saved = localStorage.getItem(`stoa-bookmark:${itemId}`);
    if (saved) setBookmarkPage(parseInt(saved));
  }, [itemId]);

  // Track current page from scroll
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
    const el = scrollRef.current.querySelectorAll(".pdf-page-wrapper")[bookmarkPage - 1];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Responsive page width
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
    [],
  );

  // Auto-resume: jump to bookmark once after pages render
  useEffect(() => {
    if (didAutoJumpRef.current || !bookmarkPage || !numPages || !scrollRef.current) return;
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

  // Compute which page wrapper contains the DOM node of a selection
  const pageElOfNode = useCallback((node: Node | null): { el: Element; num: number } | null => {
    if (!node || !scrollRef.current) return null;
    let el = (node.nodeType === 3 ? node.parentElement : (node as HTMLElement)) as HTMLElement | null;
    while (el && el !== scrollRef.current) {
      if (el.classList?.contains("pdf-page-wrapper")) {
        const els = Array.from(scrollRef.current.querySelectorAll(".pdf-page-wrapper"));
        const num = els.indexOf(el) + 1;
        return { el, num };
      }
      el = el.parentElement;
    }
    return null;
  }, []);

  // Surface floating toolbar on text selection
  useEffect(() => {
    function onMouseUp() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { setSelectionState(null); return; }
      const text = sel.toString().trim();
      if (!text || text.length < 2) { setSelectionState(null); return; }
      const anchor = sel.anchorNode;
      const page = pageElOfNode(anchor);
      if (!page) { setSelectionState(null); return; }
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
    // Compute W3C selectors before clearing the DOM selection
    const selectors = computeSelectors(
      selectionState.pageEl,
      selectionState.pageNumber,
      selectionState.text,
    );
    setSelectionState(null);
    window.getSelection()?.removeAllRanges();
    try {
      await onCreateHighlight({
        text: selectionState.text,
        page_number: selectionState.pageNumber,
        selectors,
      });
    } catch { /* silent */ }
  }, [selectionState, onCreateHighlight]);

  // ---------------------------------------------------------------------------
  // Highlight overlay rendering — three-tier resolver
  // ---------------------------------------------------------------------------

  const highlightsByPage = useMemo(() => {
    const m = new Map<number, Highlight[]>();
    for (const h of highlights) {
      // Infer page from FragmentSelector or page_number field
      let page: number | null = h.page_number ?? null;
      if (!page && h.selectors) {
        const frag = h.selectors.find(
          (s): s is FragmentSelector => s.type === "FragmentSelector",
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
        // Clear all marks first
        pageEl.querySelectorAll(".pdf-highlight-mark").forEach((m) =>
          m.classList.remove("pdf-highlight-mark"),
        );
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

  // ---------------------------------------------------------------------------
  // Note autosave — single-flight lock + 10-second timeout
  // ---------------------------------------------------------------------------

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
  // Single-flight: a pending create is stored as a promise so concurrent
  // keystrokes share the same POST instead of racing to create duplicates.
  const createPromiseRef = useRef<Promise<Note | null> | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const inFlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-session idempotency key sent to POST /notes.  Generated lazily on
  // first create; reset after the note row is confirmed so a fresh edit
  // session (e.g. user clears and retyps) gets a distinct key.
  const sessionDraftIdRef = useRef<string | null>(null);

  useEffect(() => { draftIdRef.current = draftNoteId; }, [draftNoteId]);
  useEffect(() => { latestRef.current = noteContent; }, [noteContent]);

  useEffect(() => {
    const normalized = noteContent.replace(/<br\s*\/?>(\s*)?/gi, "").trim();
    const meaningful = normalized.length > 0 &&
      normalized !== "<p></p>" && normalized !== "<p><br></p>";
    if (!meaningful || noteContent === lastSavedRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    const scheduleSave = (delay: number) => {
      saveTimerRef.current = setTimeout(async () => {
        if (inFlightRef.current) { scheduleSave(250); return; }
        const payload = latestRef.current;
        if (payload === lastSavedRef.current) return;

        inFlightRef.current = true;
        setNoteSync({ kind: "saving" });

        // 10-second timeout guard: if the network hangs, force-clear so
        // the next keystroke can retry rather than stacking up promises.
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
            await updateNote(existingId, { content: payload });
          } else {
            // Single-flight: reuse in-progress create if one is already running
            if (!createPromiseRef.current) {
              // Generate a stable idempotency key for this editing session.
              // A concurrent POST carrying the same key is deduplicated server-side.
              if (!sessionDraftIdRef.current) {
                sessionDraftIdRef.current = crypto.randomUUID();
              }
              createPromiseRef.current = onCreateNote(
                payload,
                ["synthesis", `ref:${itemId}`],
                sessionDraftIdRef.current,
              );
            }
            const created = await createPromiseRef.current;
            createPromiseRef.current = null;
            if (created?.id) {
              draftIdRef.current = created.id;
              setDraftNoteId(created.id);
              // Note confirmed — clear the draft key so a future fresh edit
              // session does not reuse this key (which is now bound to this row).
              sessionDraftIdRef.current = null;
            }
          }
          lastSavedRef.current = payload;
          setNoteSync({ kind: "saved" });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Save failed";
          console.error("[pdf-note autosave]", err);
          setNoteSync({ kind: "error", message });
        } finally {
          clearTimeout(inFlightTimeoutRef.current!);
          inFlightRef.current = false;
          if (latestRef.current !== lastSavedRef.current) scheduleSave(300);
        }
      }, delay);
    };

    scheduleSave(900);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteContent, itemId]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div ref={containerRef} className="pdf-split-view">
      {/* Floating highlight toolbar */}
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

      {/* PDF pages */}
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
              <div key={pageNum} className="pdf-page-wrapper" style={{ position: "relative" }}>
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

      {/* Annotation sidebar */}
      <aside className="pdf-split-sidebar">
        {/* Bookmark bar */}
        <div className="pdf-bookmark-bar">
          <span className="pdf-bookmark-page">Page {currentPage} / {numPages}</span>
          <button onClick={saveBookmark} className="pdf-bookmark-btn" title="Bookmark">
            📌 Bookmark
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
          <NoteEditor
            content={noteContent}
            onChange={setNoteContent}
            placeholder="Add a note about this paper… (autosaves)"
          />
          <div className="pdf-sidebar-sync" aria-live="polite">
            {noteSync.kind === "saving" && (
              <span><Loader2 size={11} className="pdf-sidebar-sync-spin" /> Saving…</span>
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
            <div className="pdf-sidebar-heading">Highlights ({highlights.length})</div>
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
