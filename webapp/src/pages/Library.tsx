import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Settings2, Globe, Trash2, RefreshCw, ChevronRight } from "lucide-react";
import { useItems } from "@/hooks/useItems";
import { deleteItem, syncApplePodcasts } from "@/lib/api";
import Bookshelf from "@/components/Bookshelf";
import ItemRow from "@/components/ItemRow";
import AddItemModal from "@/components/AddItemModal";
import type { Item } from "@/lib/supabase";

interface LibraryProps {
  status?: Item["reading_status"];
  type?: Item["type"];
}

const PAGE_LABELS: Record<string, string> = {
  to_read: "To Read",
  read: "Read",
  writing: "Writings",
};

export default function Library({ status, type }: LibraryProps) {
  const effectiveStatus = type ? undefined : (status || "to_read");
  const { items, loading, reload } = useItems(effectiveStatus, type);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const handlePodcastSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncApplePodcasts();
      setSyncResult(`Synced ${result.synced} new episodes (${result.skipped} already imported)`);
      reload();
    } catch (e) {
      setSyncResult(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 4000);
    }
  };

  const books = useMemo(() => items.filter((i) => i.type === "book"), [items]);

  const handleDeleteAllBooks = async () => {
    if (deletingAll || books.length === 0) return;
    setDeletingAll(true);
    try {
      await Promise.all(books.map((b) => deleteItem(b.id)));
      reload();
    } finally {
      setDeletingAll(false);
    }
  };
  const blogs = useMemo(() => items.filter((i) => i.type === "blog"), [items]);
  const papers = useMemo(() => items.filter((i) => i.type === "paper"), [items]);
  const writings = useMemo(() => items.filter((i) => i.type === "writing"), [items]);
  const podcasts = useMemo(
    () => items.filter((i) => i.type === "podcast"),
    [items]
  );
  const other = useMemo(
    () =>
      items.filter(
        (i) => !["book", "blog", "paper", "podcast", "writing"].includes(i.type)
      ),
    [items]
  );

  const statusLabel = type ? PAGE_LABELS[type] : PAGE_LABELS[effectiveStatus || "to_read"] || "Library";

  const listSections = [
    { label: "Writings", items: writings },
    { label: "Blogs", items: blogs },
    { label: "Papers", items: papers },
    { label: "Podcasts", items: podcasts },
    { label: "Other", items: other },
  ].filter((s) => s.items.length > 0);

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="font-serif text-2xl font-semibold text-text-primary">
            {statusLabel}
          </h1>
          <p className="text-sm text-text-tertiary mt-1 font-sans">
            <span className="font-mono text-[12px] tabular-nums">
              {items.length}
            </span>{" "}
            items
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePodcastSync}
            disabled={syncing}
            className="p-2 rounded-card hover:bg-bg-secondary transition-warm"
            title="Sync Apple Podcasts"
          >
            <RefreshCw size={16} className={`text-text-tertiary ${syncing ? "animate-spin" : ""}`} />
          </button>
          <button
            className="p-2 rounded-card hover:bg-bg-secondary transition-warm"
            title="Settings"
          >
            <Settings2 size={16} className="text-text-tertiary" />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="p-2 rounded-card hover:bg-bg-secondary transition-warm"
            title="Add item"
          >
            <Plus size={16} className="text-text-tertiary" />
          </button>
        </div>
      </motion.div>

      {/* Sync result toast */}
      {syncResult && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mb-4 px-3 py-2 rounded-card bg-bg-secondary text-[12px] font-mono text-text-secondary"
        >
          {syncResult}
        </motion.div>
      )}

      {/* Loading state */}
      {loading && items.length === 0 && (
        <div className="text-center py-20">
          <div className="inline-block w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin" />
          <p className="text-sm text-text-tertiary mt-3">Loading library...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="text-center py-20">
          <Globe size={32} className="mx-auto mb-4 text-text-tertiary/40" />
          <p className="text-sm font-serif text-text-secondary">
            Nothing here yet
          </p>
          <p className="text-[12px] text-text-tertiary mt-2 max-w-xs mx-auto">
            Save your first page using the Chrome extension or the + button above
          </p>
        </div>
      )}

      {/* Bookshelf section */}
      {books.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
          className="mb-10"
        >
          <div className="flex items-center gap-3 mb-3 px-3">
            <h2 className="text-[11px] font-mono text-text-tertiary uppercase tracking-[0.15em]">
              Books
            </h2>
            <div className="flex-1 h-px bg-border" />
            <span className="text-[11px] font-mono text-text-tertiary tabular-nums">
              {books.length} {books.length === 1 ? "item" : "items"}
            </span>
            {effectiveStatus === "to_read" && books.length > 0 && (
              <button
                onClick={handleDeleteAllBooks}
                disabled={deletingAll}
                className="text-[10px] font-mono text-text-tertiary hover:text-red-500
                           transition-warm disabled:opacity-40 flex items-center gap-1"
              >
                <Trash2 size={10} />
                {deletingAll ? "Deleting..." : "Clear all"}
              </button>
            )}
          </div>
          <Bookshelf books={books} onDeleted={reload} />
        </motion.section>
      )}

      {/* List sections (collapsible) */}
      {listSections.map((section, sIdx) => (
        <CollapsibleSection
          key={section.label}
          label={section.label}
          items={section.items}
          delay={0.1 + sIdx * 0.05}
          onDeleted={reload}
          defaultOpen={section.items.length <= 20}
        />
      ))}

      <AddItemModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={reload}
      />
    </div>
  );
}

function CollapsibleSection({
  label,
  items: sectionItems,
  delay,
  onDeleted,
  defaultOpen = true,
}: {
  label: string;
  items: Item[];
  delay: number;
  onDeleted: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      className="mb-8"
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 mb-3 px-3 w-full group"
      >
        <ChevronRight
          size={12}
          className={`text-text-tertiary transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
        />
        <h2 className="text-[11px] font-mono text-text-tertiary uppercase tracking-[0.15em]">
          {label}
        </h2>
        <div className="flex-1 h-px bg-border" />
        <span className="text-[11px] font-mono text-text-tertiary tabular-nums">
          {sectionItems.length}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5">
              {sectionItems.map((item, i) => (
                <ItemRow key={item.id} item={item} index={i} onDeleted={onDeleted} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
