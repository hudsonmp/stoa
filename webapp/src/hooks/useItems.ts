import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Item } from "@/lib/supabase";

export function useItems(status?: Item["reading_status"]) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("items")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (status) {
        query = query.eq("reading_status", status);
      }

      const { data, error: err } = await query;
      if (err) throw err;
      setItems((data as Item[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const byType = useCallback(
    (type: Item["type"]) => items.filter((i) => i.type === type),
    [items]
  );

  const counts = {
    total: items.length,
    to_read: items.filter((i) => i.reading_status === "to_read").length,
    reading: items.filter((i) => i.reading_status === "reading").length,
    read: items.filter((i) => i.reading_status === "read").length,
    book: items.filter((i) => i.type === "book").length,
    blog: items.filter((i) => i.type === "blog").length,
    paper: items.filter((i) => i.type === "paper").length,
    podcast: items.filter((i) => i.type === "podcast").length,
  };

  return { items, loading, error, reload: load, byType, counts };
}
