import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";

export type MentionKind = "item" | "person" | "profile";

export interface MentionItem {
  id: string;
  label: string;
  kind: MentionKind;
  subtitle?: string;
}

interface MentionListProps {
  items: MentionItem[];
  command: (item: MentionItem) => void;
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const SECTION_LABELS: Record<MentionKind, string> = {
  item: "Pages",
  person: "People",
  profile: "Friends",
};

const SECTION_ORDER: MentionKind[] = ["item", "person", "profile"];

const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((prev) =>
            prev <= 0 ? items.length - 1 : prev - 1
          );
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((prev) =>
            prev >= items.length - 1 ? 0 : prev + 1
          );
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selectedIndex];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="bg-bg-primary border border-border rounded-card shadow-warm-lg p-2 text-sm text-text-tertiary">
          No results
        </div>
      );
    }

    // Group items by kind, preserving relative order within each group.
    // Render sections only for kinds that have results.
    const grouped = new Map<MentionKind, MentionItem[]>();
    for (const item of items) {
      const list = grouped.get(item.kind) || [];
      list.push(item);
      grouped.set(item.kind, list);
    }

    // Build a flat rendering list with section headers interleaved.
    // Track the global index so keyboard selection spans sections.
    let globalIndex = 0;

    return (
      <div className="bg-bg-primary border border-border rounded-card shadow-warm-lg p-1 min-w-[220px] max-h-[280px] overflow-y-auto">
        {SECTION_ORDER.filter((k) => grouped.has(k)).map((kind) => {
          const sectionItems = grouped.get(kind)!;
          return (
            <div key={kind}>
              {grouped.size > 1 && (
                <p className="px-3 pt-2 pb-0.5 text-[10px] font-sans font-medium text-text-tertiary uppercase tracking-wider">
                  {SECTION_LABELS[kind]}
                </p>
              )}
              {sectionItems.map((item) => {
                const idx = globalIndex++;
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    onClick={() => command(item)}
                    className={`w-full text-left px-3 py-1.5 rounded-[6px] text-sm transition-warm
                      ${
                        idx === selectedIndex
                          ? "bg-bg-secondary text-text-primary"
                          : "text-text-secondary hover:bg-bg-secondary/60"
                      }`}
                  >
                    <span className="block truncate">{item.label}</span>
                    {item.subtitle && (
                      <span className="block text-[11px] text-text-tertiary truncate">
                        {item.subtitle}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }
);

MentionList.displayName = "MentionList";

export default MentionList;
