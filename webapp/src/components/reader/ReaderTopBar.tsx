/**
 * ReaderTopBar — the unified top bar for the 3-pane reader.
 *
 * Layout:
 *   ←Library | Stoa | <breadcrumb tag/title>             COMMAND ⌘K | HIDE LIBRARY | READER ONLY
 *
 * Three controls (TWEAKS removed by design):
 *  - COMMAND ⌘K — opens the command palette (parent owns the modal).
 *  - HIDE LIBRARY — toggles the left LibraryPane visibility, persisted via
 *    LIBRARY_COLLAPSED_KEY in localStorage (compatible with the existing
 *    Layout.tsx key so the preference survives across reader and global app).
 *  - READER ONLY — collapses BOTH side panes for a distraction-free mode.
 *    Restores previous library-collapsed state on exit.
 *
 * Why no TWEAKS panel: metadata editing (status/tags/type/related grid)
 * lives at /item/:id (the existing ItemDetail.tsx admin route). Splitting
 * "reading mode" from "metadata mode" by route keeps the reader focused
 * and avoids a 1305-line file growing further.
 */

import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

interface ReaderTopBarProps {
  itemTitle: string;
  breadcrumbTag?: string;
  libraryHidden: boolean;
  readerOnly: boolean;
  onOpenCommand: () => void;
  onToggleLibrary: () => void;
  onToggleReaderOnly: () => void;
}

export default function ReaderTopBar({
  itemTitle,
  breadcrumbTag,
  libraryHidden,
  readerOnly,
  onOpenCommand,
  onToggleLibrary,
  onToggleReaderOnly,
}: ReaderTopBarProps) {
  return (
    <header
      style={{
        height: 44,
        flexShrink: 0,
        display: "flex",
        alignItems: "stretch",
        background: "var(--bg-primary)",
        borderBottom: "1px solid var(--border)",
        fontFamily: '"DM Sans", system-ui, sans-serif',
        fontSize: 12,
      }}
    >
      {/* Left: Library back + Stoa + breadcrumb */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 14px",
          minWidth: 0,
          flex: 1,
        }}
      >
        <Link
          to="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            border: "1px solid var(--border)",
            borderRadius: 3,
            color: "var(--text-secondary)",
            textDecoration: "none",
            fontSize: 12,
          }}
        >
          <ChevronLeft size={13} />
          Library
        </Link>

        <span
          style={{
            fontFamily: '"Newsreader", Georgia, serif',
            fontStyle: "italic",
            fontSize: 16,
            color: "var(--text-primary)",
            letterSpacing: "0.01em",
          }}
        >
          Stoa
        </span>

        {breadcrumbTag && (
          <span style={{ color: "var(--text-tertiary)", letterSpacing: "0.03em" }}>
            {breadcrumbTag}
          </span>
        )}

        <span
          style={{
            color: "var(--text-tertiary)",
            margin: "0 2px",
          }}
        >
          /
        </span>

        <span
          style={{
            fontFamily: '"Newsreader", Georgia, serif',
            fontStyle: "italic",
            fontSize: 13,
            color: "var(--text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
          title={itemTitle}
        >
          {itemTitle}
        </span>
      </div>

      {/* Right: 3 controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 14px",
          flexShrink: 0,
        }}
      >
        <BarButton onClick={onOpenCommand}>
          <span>COMMAND</span>
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
        </BarButton>

        <BarButton onClick={onToggleLibrary} pressed={libraryHidden}>
          {libraryHidden ? "SHOW LIBRARY" : "HIDE LIBRARY"}
        </BarButton>

        <BarButton onClick={onToggleReaderOnly} pressed={readerOnly} accent>
          READER ONLY
        </BarButton>
      </div>
    </header>
  );
}

function BarButton({
  onClick,
  children,
  pressed,
  accent,
}: {
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
  accent?: boolean;
}) {
  const baseColor = accent ? "var(--accent)" : "var(--text-secondary)";
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        background: pressed
          ? accent
            ? "rgba(194,65,12,0.08)"
            : "var(--bg-secondary)"
          : "transparent",
        border: `1px solid ${accent ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 3,
        color: baseColor,
        fontFamily: '"DM Sans", system-ui, sans-serif',
        fontSize: 11,
        letterSpacing: "0.06em",
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
