import { useState, useEffect, useCallback, useMemo } from "react";
import type { Item } from "@/lib/supabase";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID;

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (DEV_USER_ID) h["X-User-Id"] = DEV_USER_ID;
  else {
    const token = localStorage.getItem("stoa_token");
    if (token) h["Authorization"] = `Bearer ${token}`;
  }
  return h;
}

export function useItems(status?: Item["reading_status"], type?: Item["type"]) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      const res = await fetch(`${API_URL}/items?${params}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setItems((data.items as Item[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }, [status, type]);

  useEffect(() => {
    load();
  }, [load]);

  // When filtering by reading_status, exclude writings (they have their own tab)
  const filtered = useMemo(
    () => (status && !type ? items.filter((i) => i.type !== "writing") : items),
    [items, status, type]
  );

  const byType = useCallback(
    (t: Item["type"]) => filtered.filter((i) => i.type === t),
    [filtered]
  );

  const counts = {
    total: items.length,
    to_read: items.filter((i) => i.reading_status === "to_read" && i.type !== "writing").length,
    read: items.filter((i) => i.reading_status === "read" && i.type !== "writing").length,
    writing: items.filter((i) => i.type === "writing").length,
  };

  return { items: filtered, loading, error, reload: load, byType, counts };
}
