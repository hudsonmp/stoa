import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // TipTap v3 sub-packages (notably @tiptap/react/menus) declare React as a
    // peer dep; without dedupe they end up resolved against a second react
    // copy, and every hook returns null. Symptoms: "Cannot read properties of
    // null (reading 'useState'/'useRef')" inside @tiptap_react_menus and
    // NoteCommentsSidebar. Dedupe forces a single react module instance.
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom"],
  },
  server: {
    port: 3000,
  },
});
