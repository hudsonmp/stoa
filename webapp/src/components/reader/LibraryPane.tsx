/**
 * LibraryPane — item-scoped library browser for the reader screen.
 *
 * Replaces the global app Sidebar on /read/:id. Three responsibilities:
 *  1. Search box (⌘K shortcut hint; actual palette is wired by ReaderPage).
 *  2. Three labeled sections — PAPERS / NOTES / WEB CLIPPINGS — listing the
 *     user's recent items by type, each rendered as a type-badged row.
 *  3. Tag bullet footer aggregating tag counts across the user's items.
 *
 * Design contract:
 *  - Width is fixed at 240px when expanded, 0px when collapsed (parent owns
 *    the toggle state via the `collapsed` prop).
 *  - No global app navigation. The reader is a focused mode; library
 *    browsing happens via /library, not from inside the reader.
 *  - Items link to /read/:id (not /item/:id) — staying inside the reader.
 *
 * Why not a hover-out drawer: the target design shows the library as a
 * persistent column, not a collapse-on-blur drawer. Persistence supports the
 * "scan-while-reading" workflow that motivated the 3-pane layout.
 */

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText, StickyNote, Globe, Search } from "lucide-react";
import type { Item, Note } from "@/lib/supabase";

interface LibraryPaneProps {
  items: Item[];
  notes: Note[];
  tagCounts: Array<{ tag: string; count: number; color?: string }>;
  collapsed: boolean;
}

const READABLE_TYPES = new Set([
  "paper",
  "book",
  "blog",
  "page",
  "writing",
  "gdoc",
]);

const WEB_TYPES = new Set(["blog", "page", "tweet"]);

// Stable palette mapped to tag string — gives each tag a consistent bullet
// color without needing per-tag config.
const TAG_PALETTE = [
  "#c2410c", // accent
  "#4d7c0f", // accent-green
  "#b45309", // accent-amber
  "#0e7490",
  "#7c3aed",
];

function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
}

export default function LibraryPane({
  items,
  notes,
  tagCounts,
  collapsed,
}: LibraryPaneProps) {
  const { id: activeId } = useParams<{ id: string }>();
  const [query, setQuery] = useState("");

  const papers = useMemo(
    () => items.filter((i) => i.type === "paper" || i.type === "book").slice(0, 6),
    [items]
  );
  const webClippings = useMemo(
    () => items.filter((i) => WEB_TYPES.has(i.type)).slice(0, 6),
    [items]
  );
  const recentNotes = useMemo(() => notes.slice(0, 6), [notes]);

  const filteredQuery = query.trim().toLowerCase();
  const matches = (title: string) =>
    !filteredQuery || title.toLowerCase().includes(filteredQuery);

  if (collapsed) return null;

  return (
    <aside
      className="reader-library-pane"
      style={{
        width: 240,
        flexShrink: 0,
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Search */}
      <div style={{ padding: "12px 14px 8px" }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          <Search size={14} className="text-text-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search library…"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontFamily: '"DM Sans", system-ui, sans-serif',
              fontSize: 13,
              color: "var(--text-primary)",
            }}
          />
          <kbd
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 10,
              padding: "1px 4px",
              border: "1px solid var(--border)",
              borderRadius: 2,
              color: "var(--text-tertiary)",
              background: "var(--bg-secondary)",
            }}
          >
            ⌘K
          </kbd>
        </label>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 6px 12px",
        }}
      >
        <Section title="Papers" items={papers.filter((i) => matches(i.title))} activeId={activeId} icon="pdf" />
        <NotesSection notes={recentNotes.filter((n) => matches(n.title || ""))} activeId={activeId} />
        <Section
          title="Web Clippings"
          items={webClippings.filter((i) => matches(i.title))}
          activeId={activeId}
          icon="blog"
        />
      </div>

      {/* Tag footer */}
      {tagCounts.length > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "10px 14px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {tagCounts.slice(0, 8).map((t) => (
            <div
              key={t.tag}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: '"DM Sans", system-ui, sans-serif',
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: t.color || tagColor(t.tag),
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.tag}
              </span>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {t.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function Section({
  title,
  items,
  activeId,
  icon,
}: {
  title: string;
  items: Item[];
  activeId?: string;
  icon: "pdf" | "blog";
}) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <h3
        style={{
          fontFamily: '"DM Sans", system-ui, sans-serif',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          padding: "0 10px 6px",
        }}
      >
        {title}
      </h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((it) => {
          const dest = READABLE_TYPES.has(it.type) ? `/read/${it.id}` : `/item/${it.id}`;
          const active = activeId === it.id;
          return (
            <li key={it.id}>
              <Link
                to={dest}
                style={{
                  display: "block",
                  padding: "8px 10px",
                  borderRadius: 3,
                  background: active ? "var(--bg-secondary)" : "transparent",
                  textDecoration: "none",
                  color: "var(--text-primary)",
                  borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
                }}
              >
                <div
                  style={{
                    fontFamily: '"Newsreader", Georgia, serif',
                    fontSize: 13,
                    lineHeight: 1.35,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {it.title}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10,
                    fontFamily: '"JetBrains Mono", monospace',
                    color: "var(--text-tertiary)",
                  }}
                >
                  <TypeBadge type={it.type} icon={icon} />
                  {it.domain && (
                    <span
                      style={{
                        fontFamily: '"Newsreader", Georgia, serif',
                        fontStyle: "italic",
                        fontSize: 11,
                      }}
                    >
                      {it.domain}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NotesSection({
  notes,
  activeId,
}: {
  notes: Note[];
  activeId?: string;
}) {
  if (notes.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <h3
        style={{
          fontFamily: '"DM Sans", system-ui, sans-serif',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          padding: "0 10px 6px",
        }}
      >
        Notes
      </h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {notes.map((n) => {
          const active = activeId === n.id;
          return (
            <li key={n.id}>
              <Link
                to={`/notes/${n.id}`}
                style={{
                  display: "block",
                  padding: "8px 10px",
                  borderRadius: 3,
                  background: active ? "var(--bg-secondary)" : "transparent",
                  textDecoration: "none",
                  color: "var(--text-primary)",
                }}
              >
                <div
                  style={{
                    fontFamily: '"Newsreader", Georgia, serif',
                    fontSize: 13,
                    lineHeight: 1.35,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {n.title || (n.content || "").slice(0, 60) || "Untitled"}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    fontFamily: '"JetBrains Mono", monospace',
                    color: "var(--text-tertiary)",
                  }}
                >
                  <span
                    style={{
                      padding: "1px 4px",
                      border: "1px solid var(--border)",
                      borderRadius: 2,
                      letterSpacing: "0.05em",
                    }}
                  >
                    NOTE
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TypeBadge({ type, icon }: { type: string; icon: "pdf" | "blog" }) {
  const label =
    type === "paper" || type === "book"
      ? "PDF"
      : type === "blog"
      ? "BLOG"
      : type.toUpperCase();
  const Icon = icon === "pdf" ? FileText : icon === "blog" ? Globe : StickyNote;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 4px",
        border: "1px solid var(--border)",
        borderRadius: 2,
        letterSpacing: "0.05em",
        background:
          label === "PDF"
            ? "rgba(194,65,12,0.06)"
            : "transparent",
        color:
          label === "PDF"
            ? "var(--accent)"
            : "var(--text-tertiary)",
      }}
    >
      <Icon size={9} />
      {label}
    </span>
  );
}
