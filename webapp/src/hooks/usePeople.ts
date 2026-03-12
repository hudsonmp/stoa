import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Person } from "@/lib/supabase";

export function usePeople() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("people")
        .select("*")
        .order("name");
      if (err) throw err;
      setPeople((data as Person[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load people");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byRole = useCallback(
    (role: string) => people.filter((p) => p.role === role),
    [people]
  );

  return { people, loading, error, reload: load, byRole };
}
