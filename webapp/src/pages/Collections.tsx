import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { FolderOpen, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Collection, Item } from "@/lib/supabase";
import { Link } from "react-router-dom";
import ItemRow from "@/components/ItemRow";

export default function Collections() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collectionItems, setCollectionItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  useEffect(() => {
    loadCollections();
  }, []);

  useEffect(() => {
    if (selectedId) loadCollectionItems(selectedId);
  }, [selectedId]);

  const loadCollections = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("collections")
      .select("*")
      .order("name");
    setCollections((data as Collection[]) || []);
    setLoading(false);
  };

  const loadCollectionItems = async (collectionId: string) => {
    const { data: links } = await supabase
      .from("collection_items")
      .select("item_id")
      .eq("collection_id", collectionId)
      .order("sort_order");

    if (links && links.length > 0) {
      const ids = links.map((l: { item_id: string }) => l.item_id);
      const { data: items } = await supabase
        .from("items")
        .select("*")
        .in("id", ids);
      setCollectionItems((items as Item[]) || []);
    } else {
      setCollectionItems([]);
    }
  };

  const createCollection = async () => {
    if (!form.name.trim()) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("collections").insert({
      ...form,
      user_id: user?.id,
      is_public: false,
    });
    setForm({ name: "", description: "" });
    setShowCreate(false);
    loadCollections();
  };

  const selected = collections.find((c) => c.id === selectedId);

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif text-2xl font-semibold text-text-primary">
              Collections
            </h1>
            <p className="text-sm text-text-tertiary mt-1">
              Curated groupings of items
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-card
                       bg-accent text-white text-sm font-medium
                       hover:bg-accent-hover transition-warm"
          >
            <Plus size={14} />
            New
          </button>
        </div>

        {loading && collections.length === 0 && (
          <p className="text-center py-20 text-sm text-text-tertiary">Loading...</p>
        )}

        {!loading && collections.length === 0 && (
          <div className="text-center py-20">
            <FolderOpen size={32} className="mx-auto mb-4 text-text-tertiary/40" />
            <p className="font-serif text-sm text-text-secondary">
              No collections yet
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Collection list */}
          <div className="space-y-1">
            {collections.map((col) => (
              <button
                key={col.id}
                onClick={() => setSelectedId(col.id)}
                className={`w-full text-left flex items-center gap-2.5 px-3 py-2.5
                           rounded-card transition-warm text-sm
                           ${
                             selectedId === col.id
                               ? "bg-bg-secondary text-text-primary border-l-2 border-accent pl-[10px]"
                               : "text-text-secondary hover:bg-bg-secondary/60 hover:text-text-primary"
                           }`}
              >
                <FolderOpen
                  size={14}
                  className="text-text-tertiary flex-shrink-0"
                />
                <div className="min-w-0">
                  <p className="font-medium truncate">{col.name}</p>
                  {col.description && (
                    <p className="text-[11px] text-text-tertiary truncate mt-0.5">
                      {col.description}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Selected collection items */}
          <div className="md:col-span-2">
            {selected ? (
              <>
                <div className="mb-4">
                  <h2 className="font-serif text-lg font-medium text-text-primary">
                    {selected.name}
                  </h2>
                  {selected.description && (
                    <p className="text-sm text-text-secondary mt-1">
                      {selected.description}
                    </p>
                  )}
                </div>
                {collectionItems.length === 0 ? (
                  <p className="text-sm text-text-tertiary py-8 text-center">
                    No items in this collection
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {collectionItems.map((item, i) => (
                      <ItemRow key={item.id} item={item} index={i} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-text-tertiary py-8 text-center">
                Select a collection
              </p>
            )}
          </div>
        </div>

        {/* Create modal */}
        {showCreate && (
          <>
            <div
              className="fixed inset-0 bg-text-primary/20 z-50"
              onClick={() => setShowCreate(false)}
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-bg-primary border border-border rounded-modal
                           shadow-warm-lg w-full max-w-sm p-6 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-serif text-lg font-medium">
                    New Collection
                  </h2>
                  <button onClick={() => setShowCreate(false)}>
                    <X size={16} className="text-text-tertiary" />
                  </button>
                </div>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Collection name"
                  className="w-full px-3 py-2.5 rounded-card border border-border
                             bg-bg-primary text-sm outline-none focus:border-accent/30
                             transition-warm"
                  autoFocus
                />
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="Description (optional)"
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-card border border-border
                             bg-bg-primary text-sm outline-none focus:border-accent/30
                             transition-warm resize-none"
                />
                <button
                  onClick={createCollection}
                  className="w-full py-2.5 rounded-card bg-accent text-white text-sm
                             font-medium hover:bg-accent-hover transition-warm"
                >
                  Create
                </button>
              </motion.div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
