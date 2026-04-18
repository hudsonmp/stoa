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
import { Highlighter, CheckCircle2, Loader2, Tag as TagIcon, X as XIcon } from "lucide-react";
import ProjectNoteEditor from "@/components/ProjectNoteEditor";
import { updateProjectNote, getProjectHighlightTags } from "@/lib/api";
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
    tags?: string[];
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
  projectId,
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

  // Tag state for new highlights + sidebar filter + autocomplete source.
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [filterTag, setFilterTag] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProjectHighlightTags(projectId)
      .then((data) => {
        if (cancelled) return;
        setKnownTags((data?.tags || []).map((t) => t.tag));
      })
      .catch(() => {
        /* ignore — tag autocomplete is non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, highlights.length]);

  const commitTagDraft = useCallback(() => {
    const raw = tagDraft.trim().replace(/,$/, "").trim();
    if (!raw) return;
    // Allow comma-separated entry: "cite, method" → two tags.
    const parts = raw
      .split(/[,\n]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    setPendingTags((prev) => {
      const next = [...prev];
      for (const t of parts) if (!next.includes(t)) next.push(t);
      return next;
    });
    setTagDraft("");
  }, [tagDraft]);

  const submitHighlight = useCallback(async () => {
    if (!selectionState || !onCreateHighlight) return;
    // Commit any in-progress tag draft before submitting.
    const drafts = tagDraft
      .split(/[,\n]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const tags = Array.from(new Set([...pendingTags, ...drafts]));
    const selectors = computeSelectors(
      selectionState.pageEl,
      selectionState.pageNumber,
      selectionState.text
    );
    setSelectionState(null);
    setPendingTags([]);
    setTagDraft("");
    window.getSelection()?.removeAllRanges();
    try {
      await onCreateHighlight({
        text: selectionState.text,
        page_number: selectionState.pageNumber,
        selectors,
        tags,
      });
    } catch {
      /* silent */
    }
  }, [selectionState, onCreateHighlight, pendingTags, tagDraft]);

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
        <div
          className="pdf-selection-toolbar"
          style={{
            position: "fixed",
            left: selectionState.x,
            top: selectionState.y,
            transform: "translate(-50%, -100%)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: 6,
            minWidth: 260,
            background: "var(--bg-primary, #fff)",
            border: "1px solid var(--border, #e5e5e5)",
            borderRadius: 6,
            boxShadow: "0 4px 18px rgba(0,0,0,.08)",
            zIndex: 50,
          }}
          onMouseDown={(e) => e.preventDefault() /* keep text selection */}
        >
          {/* chip row + input */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            <TagIcon size={11} style={{ opacity: 0.55 }} />
            {pendingTags.map((t) => (
              <span
                key={t}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  fontSize: 11,
                  padding: "1px 6px",
                  background: "var(--bg-secondary, #f0f0f0)",
                  borderRadius: 999,
                }}
              >
                {t}
                <button
                  onClick={() => setPendingTags(pendingTags.filter((x) => x !== t))}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0 }}
                  aria-label={`remove ${t}`}
                >
                  <XIcon size={9} />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (tagDraft.trim()) commitTagDraft();
                  else submitHighlight();
                } else if (e.key === "," || e.key === "Tab") {
                  if (tagDraft.trim()) {
                    e.preventDefault();
                    commitTagDraft();
                  }
                } else if (e.key === "Backspace" && !tagDraft && pendingTags.length) {
                  setPendingTags(pendingTags.slice(0, -1));
                }
              }}
              placeholder={pendingTags.length ? "" : "tag (cite, method, …) — Enter to save"}
              list="highlight-tag-suggestions"
              style={{
                flex: 1,
                minWidth: 80,
                fontSize: 11,
                border: "none",
                outline: "none",
                background: "transparent",
                padding: "2px 4px",
              }}
              autoFocus
            />
            <datalist id="highlight-tag-suggestions">
              {knownTags
                .filter((t) => !pendingTags.includes(t))
                .map((t) => (
                  <option key={t} value={t} />
                ))}
            </datalist>
          </div>
          <button
            onClick={submitHighlight}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              fontSize: 11,
              padding: "3px 8px",
              background: "var(--accent, #1a73e8)",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            <Highlighter size={11} /> Save{pendingTags.length ? ` with ${pendingTags.length} tag${pendingTags.length > 1 ? "s" : ""}` : " highlight"}
          </button>
        </div>
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

        {highlights.length > 0 && (() => {
          // Distinct tags present on this item's highlights; feeds the filter row.
          const localTags = Array.from(
            new Set(highlights.flatMap((h) => h.tags || []))
          );
          const shown = filterTag
            ? highlights.filter((h) => (h.tags || []).includes(filterTag))
            : highlights;
          return (
            <>
              <div className="pdf-sidebar-divider" />
              <div className="pdf-sidebar-heading">
                Highlights ({shown.length}
                {filterTag && shown.length !== highlights.length
                  ? ` of ${highlights.length}`
                  : ""})
              </div>
              {localTags.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 3,
                    padding: "2px 10px 6px",
                  }}
                >
                  <button
                    onClick={() => setFilterTag(null)}
                    style={{
                      fontSize: 10,
                      padding: "1px 7px",
                      borderRadius: 999,
                      border: "1px solid var(--border, #e5e5e5)",
                      background: filterTag === null ? "var(--accent, #1a73e8)" : "transparent",
                      color: filterTag === null ? "#fff" : "var(--text-secondary, #444)",
                      cursor: "pointer",
                    }}
                  >
                    all
                  </button>
                  {localTags.map((t) => (
                    <button
                      key={t}
                      onClick={() => setFilterTag(filterTag === t ? null : t)}
                      style={{
                        fontSize: 10,
                        padding: "1px 7px",
                        borderRadius: 999,
                        border: "1px solid var(--border, #e5e5e5)",
                        background: filterTag === t ? "var(--accent, #1a73e8)" : "transparent",
                        color: filterTag === t ? "#fff" : "var(--text-secondary, #444)",
                        cursor: "pointer",
                      }}
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              )}
              {shown.map((hl) => (
                <div key={hl.id} className="pdf-sidebar-card">
                  <p className="pdf-sidebar-quote">&ldquo;{hl.text}&rdquo;</p>
                  {hl.tags && hl.tags.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 3,
                        marginTop: 2,
                      }}
                    >
                      {hl.tags.map((t) => (
                        <span
                          key={t}
                          onClick={() => setFilterTag(t)}
                          style={{
                            cursor: "pointer",
                            fontSize: 10,
                            padding: "0 6px",
                            borderRadius: 999,
                            background: "var(--bg-secondary, #f3f3f3)",
                            color: "var(--text-secondary, #555)",
                          }}
                          title={`Filter by #${t}`}
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
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
          );
        })()}

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
