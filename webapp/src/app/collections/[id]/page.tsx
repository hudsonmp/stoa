"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Collection, Item } from "@/lib/supabase";
import ItemCard from "@/components/ItemCard";
import Link from "next/link";
import { ArrowLeft, FolderOpen, Share2 } from "lucide-react";

export default function CollectionPage() {
  const { id } = useParams<{ id: string }>();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    if (id) loadCollection();
  }, [id]);

  const loadCollection = async () => {
    const { data: colData } = await supabase
      .from("collections")
      .select("*")
      .eq("id", id)
      .single();
    setCollection(colData);

    const { data: itemsData } = await supabase
      .from("collection_items")
      .select("sort_order, items(*)")
      .eq("collection_id", id)
      .order("sort_order");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extracted = (itemsData || []).map((ci: any) => ci.items as Item);
    setItems(extracted);
  };

  if (!collection) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-3xl mx-auto p-8">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted
                  hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        Library
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FolderOpen size={20} className="text-accent" />
          <div>
            <h1 className="text-xl font-bold">{collection.name}</h1>
            {collection.description && (
              <p className="text-sm text-muted">{collection.description}</p>
            )}
          </div>
        </div>
        {collection.is_public && (
          <span className="flex items-center gap-1 text-xs text-muted">
            <Share2 size={12} />
            Public
          </span>
        )}
      </div>

      <div className="space-y-1">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
        {items.length === 0 && (
          <p className="text-center py-12 text-muted text-sm">
            This collection is empty
          </p>
        )}
      </div>
    </div>
  );
}
