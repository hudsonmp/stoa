/**
 * PdfAnnotationView — Custom PDF renderer with highlight creation + overlays.
 *
 * Features (and why):
 *  - Selection → floating highlight button → POST /highlights with page_number.
 *  - Highlight overlays: on every text-layer render, find matching spans by
 *    substring and apply a yellow tint. Pragmatic v1 — exact text match, OK
 *    for single-line highlights; brittle across line breaks (documented as L8).
 *  - Auto-jump on mount: if localStorage has a bookmark for this item, scroll
 *    to that page once the PDF finishes loading.
 *  - Collection picker embedded in the sidebar — no need to leave PDF view to
 *    file the item.
 *  - Notes & highlights list cards in the sidebar, ordered by recency.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Folder, Highlighter, CheckCircle2, Loader2 } from "lucide-react";
import NoteEditor from "@/components/NoteEditor";
import { updateNote } from "@/lib/api";
import type { Highlight, Note } from "@/lib/supabase";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Collection {
  id: string;
  name: string;
}

interface PdfAnnotationViewProps {
  pdfUrl: string;
  highlights: Highlight[];
  notes: Note[];
  itemId: string;
  // Must return the created Note so we can PATCH subsequent edits instead of
  // creating a new note on every keystroke. Returning null skips autosave tracking.
  onCreateNote: (content: string, tags: string[]) => Promise<Note | null>;
  onCreateHighlight?: (data: {
    text: string;
    context?: string;
    page_number?: number;
  }) => Promise<Highlight | null>;
  collections?: Collection[];
  activeCollectionIds?: string[];
  onAddToCollection?: (collectionId: string) => void | Promise<void>;
}

export default function PdfAnnotationView({
  pdfUrl,
  highlights,
  notes,
  itemId,
  onCreateNote,
  onCreateHighlight,
  collections = [],
  activeCollectionIds = [],
  onAddToCollection,
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
    x: number;
    y: number;
  } | null>(null);
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);

  // Load saved bookmark
  useEffect(() => {
    const saved = localStorage.getItem(`stoa-bookmark:${itemId}`);
    if (saved) setBookmarkPage(parseInt(saved));
  }, [itemId]);

  // Track current page from scroll position
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
    const pageEl = scrollRef.current.querySelectorAll(".pdf-page-wrapper")[bookmarkPage - 1];
    if (pageEl) pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Responsive page width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const available = containerRef.current.clientWidth - 300; // sidebar width
        setPageWidth(Math.min(Math.max(available - 40, 400), 900));
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const onDocumentLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
  }, []);

  // Auto-resume: after pages render, jump to bookmark once (Shneiderman context-preservation).
  useEffect(() => {
    if (didAutoJumpRef.current) return;
    if (!bookmarkPage || !numPages || !scrollRef.current) return;
    // Give the pages a tick to mount before scrolling. onRenderSuccess would be
    // cleaner but react-pdf doesn't emit a "all pages rendered" event we can hook.
    const t = setTimeout(() => {
      const pageEls = scrollRef.current?.querySelectorAll(".pdf-page-wrapper");
      const target = pageEls && pageEls[bookmarkPage - 1];
      if (target) {
        (target as HTMLElement).scrollIntoView({ behavior: "auto", block: "start" });
        didAutoJumpRef.current = true;
      }
    }, 250);
    return () => clearTimeout(t);
  }, [bookmarkPage, numPages]);

  // Compute which page wrapper currently contains the DOM selection.
  const pageNumberOfNode = useCallback((node: Node | null): number | null => {
    if (!node || !scrollRef.current) return null;
    let el = (node.nodeType === 3 ? node.parentElement : (node as HTMLElement)) as HTMLElement | null;
    while (el && el !== scrollRef.current) {
      if (el.classList?.contains("pdf-page-wrapper")) {
        const pageEls = Array.from(
          scrollRef.current.querySelectorAll(".pdf-page-wrapper")
        );
        return pageEls.indexOf(el) + 1;
      }
      el = el.parentElement;
    }
    return null;
  }, []);

  // Surface a floating highlight button on text selection.
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
      const pageNum = pageNumberOfNode(anchor);
      if (!pageNum) {
        setSelectionState(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      // Position the toolbar above the selection, clamped to viewport.
      const x = Math.max(8, rect.left + rect.width / 2);
      const y = Math.max(40, rect.top - 8);
      setSelectionState({ text, pageNumber: pageNum, x, y });
    }
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [pageNumberOfNode]);

  const submitHighlight = useCallback(async () => {
    if (!selectionState || !onCreateHighlight) return;
    try {
      await onCreateHighlight({
        text: selectionState.text,
        page_number: selectionState.pageNumber,
      });
      setSelectionState(null);
      // Clear the native selection so the user isn't left with a stale range.
      window.getSelection()?.removeAllRanges();
    } catch {
      /* silent */
    }
  }, [selectionState, onCreateHighlight]);

  // Overlay existing highlights onto their pages. Pragmatic text-match:
  // find the page wrapper, walk its text-layer spans, and mark the shortest
  // contiguous run whose concatenated text contains the highlight text.
  // Runs whenever highlights / numPages / pageWidth change (re-render debounced).
  const highlightsByPage = useMemo(() => {
    const m = new Map<number, Highlight[]>();
    for (const h of highlights) {
      if (!h.page_number) continue;
      if (!m.has(h.page_number)) m.set(h.page_number, []);
      m.get(h.page_number)!.push(h);
    }
    return m;
  }, [highlights]);

  useEffect(() => {
    if (!scrollRef.current || !numPages) return;
    const rafId = requestAnimationFrame(() => {
      const pageEls = scrollRef.current?.querySelectorAll(".pdf-page-wrapper");
      if (!pageEls) return;
      pageEls.forEach((el, i) => {
        const pageNum = i + 1;
        const hls = highlightsByPage.get(pageNum);
        // Clear any previously-applied highlight marks on this page.
        el.querySelectorAll(".pdf-highlight-mark").forEach((m) =>
          m.classList.remove("pdf-highlight-mark")
        );
        if (!hls || hls.length === 0) return;
        const textLayer = el.querySelector(
          ".react-pdf__Page__textContent"
        ) as HTMLElement | null;
        if (!textLayer) return;
        const spans = Array.from(
          textLayer.querySelectorAll<HTMLElement>("span")
        );
        for (const h of hls) {
          const needle = normalize(h.text);
          if (!needle) continue;
          // Sliding window over spans; mark the first contiguous run whose
          // concatenated normalized text contains the needle.
          for (let start = 0; start < spans.length; start++) {
            let acc = "";
            for (let end = start; end < spans.length; end++) {
              acc += " " + normalize(spans[end].textContent || "");
              if (acc.length >= needle.length && acc.includes(needle)) {
                for (let k = start; k <= end; k++) {
                  spans[k].classList.add("pdf-highlight-mark");
                }
                start = end; // don't re-match overlapping windows
                break;
              }
            }
          }
        }
      });
    });
    return () => cancelAnimationFrame(rafId);
  }, [highlightsByPage, numPages, pageWidth]);

  // Autosave state: first real content → create (POST); subsequent edits → PATCH.
  // No Send button — the act of typing is the commit, matching the FlashcardEditor
  // and main Notes editor. User clicks away / navigates / closes with no ceremony.
  const [draftNoteId, setDraftNoteId] = useState<string | null>(null);
  const [noteSync, setNoteSync] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const lastSavedContentRef = useRef<string>("");
  const latestContentRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  // Track create/patch target via ref too — React state updates are async
  // and a second save fire can read a stale draftNoteId from closure.
  const draftIdRef = useRef<string | null>(null);

  useEffect(() => {
    draftIdRef.current = draftNoteId;
  }, [draftNoteId]);

  useEffect(() => {
    latestContentRef.current = noteContent;
  }, [noteContent]);

  useEffect(() => {
    // Skip meaningfully empty content
    const normalized = noteContent.replace(/<br\s*\/?>(\s*)?/gi, "").trim();
    const meaningful =
      normalized.length > 0 && normalized !== "<p></p>" && normalized !== "<p><br></p>";
    if (!meaningful) return;
    if (noteContent === lastSavedContentRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    const scheduleSave = (delay: number) => {
      saveTimerRef.current = setTimeout(async () => {
        // If another save is in flight, wait and retry; don't drop.
        if (inFlightRef.current) {
          scheduleSave(250);
          return;
        }
        const payload = latestContentRef.current;
        if (payload === lastSavedContentRef.current) return;
        inFlightRef.current = true;
        setNoteSync({ kind: "saving" });
        try {
          const existingId = draftIdRef.current;
          if (existingId) {
            await updateNote(existingId, { content: payload });
          } else {
            const created = await onCreateNote(payload, [
              "synthesis",
              `ref:${itemId}`,
            ]);
            if (created?.id) {
              draftIdRef.current = created.id;
              setDraftNoteId(created.id);
            }
          }
          lastSavedContentRef.current = payload;
          setNoteSync({ kind: "saved" });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Save failed";
          // eslint-disable-next-line no-console
          console.error("[pdf-note autosave]", err);
          setNoteSync({ kind: "error", message });
        } finally {
          inFlightRef.current = false;
          // If the user typed more during the in-flight save, re-fire.
          if (latestContentRef.current !== lastSavedContentRef.current) {
            scheduleSave(300);
          }
        }
      }, delay);
    };

    scheduleSave(900);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteContent, itemId]);

  const activeCollectionSet = new Set(activeCollectionIds);

  return (
    <div ref={containerRef} className="pdf-split-view">
      {/* Floating highlight toolbar for text selection */}
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

      {/* PDF pages rendered as canvas */}
      <div ref={scrollRef} className="pdf-pages-scroll">
        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={<div className="pdf-page-loading">Loading PDF...</div>}
          error={<div className="pdf-page-loading">Failed to load PDF</div>}
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div key={i + 1} className="pdf-page-wrapper">
              <Page
                pageNumber={i + 1}
                width={pageWidth}
                renderTextLayer={true}
                renderAnnotationLayer={false}
              />
              <div className="pdf-page-num">{i + 1}</div>
            </div>
          ))}
        </Document>
      </div>

      {/* Annotation sidebar */}
      <aside className="pdf-split-sidebar">
        {/* Bookmark bar */}
        <div className="pdf-bookmark-bar">
          <span className="pdf-bookmark-page">Page {currentPage} / {numPages}</span>
          <button onClick={saveBookmark} className="pdf-bookmark-btn" title="Bookmark this page">
            📌 Bookmark
          </button>
          {bookmarkPage && (
            <button onClick={jumpToBookmark} className="pdf-bookmark-jump" title={`Jump to page ${bookmarkPage}`}>
              → p.{bookmarkPage}
            </button>
          )}
        </div>

        {collections.length > 0 && onAddToCollection && (
          <>
            <div className="pdf-sidebar-divider" />
            <div className="pdf-sidebar-heading">Folder</div>
            <div className="pdf-collection-row">
              {activeCollectionSet.size > 0 &&
                [...activeCollectionSet].map((cid) => {
                  const c = collections.find((x) => x.id === cid);
                  if (!c) return null;
                  return (
                    <span key={cid} className="pdf-collection-chip is-active">
                      <Folder size={10} /> {c.name}
                    </span>
                  );
                })}
              <button
                onClick={() => setShowCollectionPicker((o) => !o)}
                className="pdf-collection-chip"
              >
                <Folder size={10} /> {showCollectionPicker ? "close" : "add folder"}
              </button>
            </div>
            {showCollectionPicker && (
              <div className="pdf-collection-picker">
                {collections
                  .filter((c) => !activeCollectionSet.has(c.id))
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={async () => {
                        await onAddToCollection(c.id);
                        setShowCollectionPicker(false);
                      }}
                      className="pdf-collection-picker-item"
                    >
                      <Folder size={11} /> {c.name}
                    </button>
                  ))}
                {collections.filter((c) => !activeCollectionSet.has(c.id))
                  .length === 0 && (
                  <div className="pdf-collection-picker-empty">
                    Already in all folders.
                  </div>
                )}
              </div>
            )}
          </>
        )}

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
            <div className="pdf-sidebar-heading">Highlights ({highlights.length})</div>
            {highlights.map((hl) => (
              <div key={hl.id} className="pdf-sidebar-card">
                <p className="pdf-sidebar-quote">&ldquo;{hl.text}&rdquo;</p>
                {hl.note && <p className="pdf-sidebar-note">{hl.note}</p>}
                <span className="pdf-sidebar-time">
                  {new Date(hl.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
                <div className="pdf-sidebar-note-content" dangerouslySetInnerHTML={{ __html: n.content }} />
                <span className="pdf-sidebar-time">
                  {new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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

// Normalize for text-layer matching: collapse whitespace, lowercase, trim.
// Required because PDF.js splits text into many spans with irregular
// whitespace boundaries; literal substring matching fails without this.
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").toLowerCase().trim();
}
