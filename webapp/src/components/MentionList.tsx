import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";

export interface MentionItem {
  /** Prefixed id: "item:<uuid>" or "note:<uuid>". renderHTML parses the prefix to route. */
  id: string;
  label: string;
  kind?: "item" | "note";
}

interface MentionListProps {
  items: MentionItem[];
  command: (item: MentionItem) => void;
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

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

    return (
      <div className="bg-bg-primary border border-border rounded-card shadow-warm-lg p-1 min-w-[180px] max-h-[240px] overflow-y-auto">
        {items.map((item, index) => (
          <button
            key={item.id}
            onClick={() => command(item)}
            className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-[6px] text-sm transition-warm
              ${
                index === selectedIndex
                  ? "bg-bg-secondary text-text-primary"
                  : "text-text-secondary hover:bg-bg-secondary/60"
              }`}
          >
            <span className="truncate">{item.label}</span>
            {item.kind && (
              <span className="text-[9px] font-mono uppercase tracking-wider text-text-tertiary flex-shrink-0">
                {item.kind}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }
);

MentionList.displayName = "MentionList";

export default MentionList;
