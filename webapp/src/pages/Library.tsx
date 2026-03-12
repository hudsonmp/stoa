import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Plus, Settings2, Globe } from "lucide-react";
import { useItems } from "@/hooks/useItems";
import Bookshelf from "@/components/Bookshelf";
import ItemRow from "@/components/ItemRow";
import AddItemModal from "@/components/AddItemModal";
import type { Item } from "@/lib/supabase";

interface LibraryProps {
  status?: Item["reading_status"];
}

const STATUS_LABELS: Record<string, string> = {
  to_read: "To Read",
  reading: "Writings",
  read: "Read",
};

export default function Library({ status = "to_read" }: LibraryProps) {
  const { items, loading, reload } = useItems(status);
  const [showAddModal, setShowAddModal] = useState(false);

  const books = useMemo(() => items.filter((i) => i.type === "book"), [items]);
  const blogs = useMemo(() => items.filter((i) => i.type === "blog"), [items]);
  const papers = useMemo(() => items.filter((i) => i.type === "paper"), [items]);
  const podcasts = useMemo(
    () => items.filter((i) => i.type === "podcast"),
    [items]
  );
  const other = useMemo(
    () =>
      items.filter(
        (i) => !["book", "blog", "paper", "podcast"].includes(i.type)
      ),
    [items]
  );

  const statusLabel = STATUS_LABELS[status] || "Library";

  const listSections = [
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
          <SectionHeader label="Books" count={books.length} />
          <Bookshelf books={books} />
        </motion.section>
      )}

      {/* List sections */}
      {listSections.map((section, sIdx) => (
        <motion.section
          key={section.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.1 + sIdx * 0.05,
            duration: 0.35,
            ease: [0.23, 1, 0.32, 1],
          }}
          className="mb-8"
        >
          <SectionHeader label={section.label} count={section.items.length} />
          <div className="space-y-0.5">
            {section.items.map((item, i) => (
              <ItemRow key={item.id} item={item} index={i} />
            ))}
          </div>
        </motion.section>
      ))}

      <AddItemModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={reload}
      />
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-3 px-3">
      <h2 className="text-[11px] font-mono text-text-tertiary uppercase tracking-[0.15em]">
        {label}
      </h2>
      <div className="flex-1 h-px bg-border" />
      <span className="text-[11px] font-mono text-text-tertiary tabular-nums">
        {count} {count === 1 ? "item" : "items"}
      </span>
    </div>
  );
}
