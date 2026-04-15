import { useState, useEffect, useCallback } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Sidebar from "./Sidebar";
import { createNote } from "@/lib/api";

const LIBRARY_COLLAPSED_KEY = "stoa_library_sidebar_collapsed";

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

export default function Layout() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState({ to_read: 0, read: 0, writing: 0, total: 0 });
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(LIBRARY_COLLAPSED_KEY) === "1";
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((cur) => {
      const next = !cur;
      localStorage.setItem(LIBRARY_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/items/counts`, { headers: authHeaders() });
      if (res.ok) setCounts(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  // Re-fetch counts when navigating (Outlet re-renders trigger this via key change)
  useEffect(() => {
    const interval = setInterval(loadCounts, 5000);
    return () => clearInterval(interval);
  }, [loadCounts]);

  // Global "new note" shortcut — ⌘K on Mac, Ctrl+K elsewhere.
  // Two bug fixes over the first cut:
  //   1) Register on capture phase. ProseMirror/TipTap's keymap plugin runs
  //      in the bubble phase on the editor element; without capture, a
  //      nested editor can swallow the event before window receives it.
  //   2) Do NOT bail out when focus is in a contenteditable/input. The
  //      modifier (⌘ or Ctrl) makes this an intentional shortcut regardless
  //      of context — Hudson's canonical usage is ⌘K mid-note to start a
  //      new one. The earlier guard over-defended and blocked the common case.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (!cmd) return;
      if (e.altKey || e.shiftKey) return; // reserve ⌘⇧K / ⌘⌥K for future
      const isK = e.key === "k" || e.key === "K";
      if (!isK) return;
      e.preventDefault();
      e.stopPropagation();
      (async () => {
        try {
          const res = await createNote({
            content: "",
            title: "Untitled",
            note_type: "synthesis",
          });
          const id = (res.note as { id: string }).id;
          navigate(`/notes/${id}`);
        } catch {
          navigate("/notes");
        }
      })();
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [navigate]);

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      {!sidebarCollapsed && (
        <motion.div
          initial={{ x: -240, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="flex-shrink-0 relative"
        >
          <Sidebar counts={counts} />
          <button
            onClick={toggleSidebar}
            title="Collapse sidebar"
            className="absolute top-4 right-2 z-20 p-1 text-text-tertiary
                       hover:text-accent transition-warm"
          >
            <ChevronLeft size={14} />
          </button>
        </motion.div>
      )}
      {sidebarCollapsed && (
        <button
          onClick={toggleSidebar}
          title="Expand sidebar"
          className="flex-shrink-0 w-6 flex flex-col items-center pt-4
                     text-text-tertiary hover:text-accent transition-warm"
        >
          <ChevronRight size={14} />
        </button>
      )}

      <main className="flex-1 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
          className="h-full"
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}
