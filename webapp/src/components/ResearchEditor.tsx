import { useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Mention from "@tiptap/extension-mention";
import { lift } from "prosemirror-commands";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  ImageIcon,
} from "lucide-react";
import MentionList, { type MentionItem, type MentionListRef } from "./MentionList";
import ReactDOM from "react-dom/client";
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID;

// Module-level notes cache. Matches the link-picker pattern: pull the user's
// notes once into memory, filter client-side on every keystroke (instant),
// refresh after a short TTL. Item search stays network-bound but runs in
// parallel so it never blocks the notes response.
type CachedNote = { id: string; title?: string; content?: string };
let notesCache: { notes: CachedNote[]; fetchedAt: number } | null = null;
let notesFetchInFlight: Promise<CachedNote[]> | null = null;
const NOTES_CACHE_TTL_MS = 30_000;
const NOTES_CACHE_LIMIT = 500;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (DEV_USER_ID) headers["X-User-Id"] = DEV_USER_ID;
  else {
    const token = localStorage.getItem("stoa_token");
    const userId = localStorage.getItem("stoa_user_id");
    if (token) headers["Authorization"] = `Bearer ${token}`;
    else if (userId) headers["X-User-Id"] = userId;
  }
  return headers;
}

async function fetchNotesForCache(): Promise<CachedNote[]> {
  if (notesFetchInFlight) return notesFetchInFlight;
  notesFetchInFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/notes?limit=${NOTES_CACHE_LIMIT}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.notes || []) as CachedNote[];
    } catch {
      return [];
    } finally {
      notesFetchInFlight = null;
    }
  })();
  return notesFetchInFlight;
}

async function getCachedNotes(): Promise<CachedNote[]> {
  const now = Date.now();
  if (notesCache && now - notesCache.fetchedAt < NOTES_CACHE_TTL_MS) {
    return notesCache.notes;
  }
  const notes = await fetchNotesForCache();
  notesCache = { notes, fetchedAt: now };
  return notes;
}

function labelForNote(n: CachedNote): string {
  const fromTitle = n.title && n.title !== "Untitled" ? n.title : null;
  const fallback = (n.content || "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .split("\n")[0]
    .slice(0, 60);
  return fromTitle || fallback || "Untitled";
}

// Fast title search — items via the network endpoint, notes via in-memory
// cache (same responsiveness as the link picker). The id is prefixed with
// kind so renderHTML can route /notes/<id> vs /item/<id>.
async function quickSearch(
  query: string
): Promise<Array<{ id: string; label: string; kind: "item" | "note" }>> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  // Notes: filter the in-memory cache by title or content substring. Instant.
  const notesPromise = getCachedNotes().then((notes) =>
    notes
      .filter((n) => {
        const title = (n.title || "").toLowerCase();
        const content = (n.content || "").replace(/<[^>]*>/g, "").toLowerCase();
        return title.includes(q) || content.includes(q);
      })
      .slice(0, 5)
      .map((n) => ({
        id: `note:${n.id}`,
        label: labelForNote(n),
        kind: "note" as const,
      }))
  );

  // Items: network-bound, parallel. Rarely the bottleneck since /quick-search
  // is ILIKE on title only. Falls back to [] on error.
  const itemsPromise = fetch(
    `${API_URL}/items/quick-search?q=${encodeURIComponent(q)}&limit=5`,
    { headers: authHeaders() }
  )
    .then((res) => (res.ok ? res.json() : null))
    .then((data) =>
      data
        ? (data.results || []).map((r: { id: string; title: string }) => ({
            id: `item:${r.id}`,
            label: r.title,
            kind: "item" as const,
          }))
        : []
    )
    .catch(() => []);

  const [notes, items] = await Promise.all([notesPromise, itemsPromise]);
  // Notes first — most common mid-note @-reference.
  return [...notes, ...items];
}

function makeSuggestion(): Omit<SuggestionOptions<any, any>, "editor"> {
  return {
    items: async ({ query }) => {
      if (!query || query.length < 1) return [];
      return quickSearch(query);
    },
    render: () => {
      let root: ReactDOM.Root | null = null;
      let popup: HTMLDivElement | null = null;
      let componentRef: MentionListRef | null = null;

      return {
        onStart: (props: SuggestionProps<MentionItem, MentionItem>) => {
          popup = document.createElement("div");
          popup.style.position = "absolute";
          popup.style.zIndex = "50";
          document.body.appendChild(popup);

          root = ReactDOM.createRoot(popup);
          root.render(
            <MentionList
              ref={(ref) => { componentRef = ref; }}
              items={props.items}
              command={props.command}
            />
          );

          updatePosition(popup, props.clientRect);
        },

        onUpdate: (props: SuggestionProps<MentionItem, MentionItem>) => {
          if (root && popup) {
            root.render(
              <MentionList
                ref={(ref) => { componentRef = ref; }}
                items={props.items}
                command={props.command}
              />
            );
            updatePosition(popup, props.clientRect);
          }
        },

        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === "Escape") {
            if (popup && root) {
              root.unmount();
              popup.remove();
              popup = null;
              root = null;
            }
            return true;
          }
          return componentRef?.onKeyDown(props) ?? false;
        },

        onExit: () => {
          if (root) root.unmount();
          if (popup) popup.remove();
          popup = null;
          root = null;
          componentRef = null;
        },
      };
    },
  };
}

function updatePosition(
  popup: HTMLDivElement,
  clientRect: (() => DOMRect | null) | null | undefined
) {
  if (!clientRect) return;
  const rect = clientRect();
  if (!rect) return;
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 4}px`;
}

// ─── Toolbar Button ───

function ToolbarButton({
  onClick,
  isActive = false,
  title,
  children,
}: {
  onClick: () => void;
  isActive?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-[4px] transition-warm
        ${
          isActive
            ? "bg-bg-secondary text-accent"
            : "text-text-tertiary hover:bg-bg-secondary hover:text-text-secondary"
        }`}
    >
      {children}
    </button>
  );
}

// ─── Toolbar ───

function EditorToolbar({ editor }: { editor: Editor }) {
  const addImage = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result as string;
        editor.chain().focus().setImage({ src }).run();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [editor]);

  const addLink = useCallback(() => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    // Collapse selection to the end of the just-linked range. With the Link
    // mark configured as non-inclusive (see extensions below), cursor at `to`
    // is OUTSIDE the mark — so the toolbar button toggles off and the next
    // character typed is not part of the link.
    const { to } = editor.state.selection;
    editor.commands.setTextSelection(to);
  }, [editor]);

  const S = 15;

  return (
    <div className="flex items-center gap-0.5 px-3 py-2 border-b border-border bg-bg-secondary/40 flex-wrap">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title="Bold"
      >
        <Bold size={S} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title="Italic"
      >
        <Italic size={S} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive("underline")}
        title="Underline"
      >
        <UnderlineIcon size={S} />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        <Heading1 size={S} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <Heading2 size={S} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        <Heading3 size={S} />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title="Bullet List"
      >
        <List size={S} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title="Numbered List"
      >
        <ListOrdered size={S} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <Quote size={S} />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1" />

      <ToolbarButton onClick={addLink} isActive={editor.isActive("link")} title="Link">
        <LinkIcon size={S} />
      </ToolbarButton>
      <ToolbarButton onClick={addImage} isActive={false} title="Image">
        <ImageIcon size={S} />
      </ToolbarButton>
    </div>
  );
}

// ─── Research Editor ───

interface ResearchEditorProps {
  content: string;
  onSave: (content: string) => void;
  placeholder?: string;
}

export default function ResearchEditor({
  content,
  onSave,
  placeholder = "Start writing...",
}: ResearchEditorProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContent = useRef(content);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      Image.configure({ allowBase64: true }),
      Underline,
      Link.extend({
        // Non-inclusive so cursor at the end of a link is treated as OUTSIDE
        // the mark. Matches the "Link button toggles off after applying"
        // expectation and prevents accidental link-extension when you keep typing.
        inclusive: false,
      }).configure({
        openOnClick: true,
        autolink: true,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      }),
      Mention.configure({
        HTMLAttributes: {
          class: "stoa-mention",
          // Prefixed id = "<kind>:<uuid>". Route to /notes/ or /item/ accordingly.
          onclick:
            "if(this.dataset.id){var p=this.dataset.id.split(':');var k=p.length>1?p[0]:'item';var u=p.length>1?p.slice(1).join(':'):p[0];window.location.href=(k==='note'?'/notes/':'/item/')+u}",
        },
        renderHTML({ options, node }) {
          const rawId = String(node.attrs.id ?? "");
          const [kindPart, ...rest] = rawId.split(":");
          const hasPrefix = rest.length > 0;
          const kind = hasPrefix ? kindPart : "item";
          const uuid = hasPrefix ? rest.join(":") : rawId;
          const href = kind === "note" ? `/notes/${uuid}` : `/item/${uuid}`;
          return [
            "a",
            {
              ...options.HTMLAttributes,
              "data-type": "mention",
              "data-id": rawId,
              "data-kind": kind,
              href,
              class: "stoa-mention",
            },
            `@${node.attrs.label ?? uuid}`,
          ];
        },
        suggestion: makeSuggestion(),
      }),
    ],
    content,
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      latestContent.current = html;

      // Debounced auto-save: 5s of inactivity
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSave(html);
      }, 5000);
    },
    editorProps: {
      // Exit blockquote on Enter when the current paragraph is empty
      // (i.e., the user hit Enter twice at the end of a quote).
      handleKeyDown: (view, event) => {
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey
        ) {
          return false;
        }
        const { $from } = view.state.selection;
        // Only act when the current paragraph is empty.
        if ($from.parent.content.size !== 0) return false;
        // Walk up the node stack to see if we're inside a blockquote.
        let inBlockquote = false;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === "blockquote") {
            inBlockquote = true;
            break;
          }
        }
        if (!inBlockquote) return false;
        event.preventDefault();
        return lift(view.state, view.dispatch);
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
          const file = files[0];
          if (file.type.startsWith("image/")) {
            event.preventDefault();
            const reader = new FileReader();
            reader.onload = () => {
              const src = reader.result as string;
              editor?.chain().focus().setImage({ src }).run();
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of items) {
            if (item.type.startsWith("image/")) {
              event.preventDefault();
              const file = item.getAsFile();
              if (!file) return false;
              const reader = new FileReader();
              reader.onload = () => {
                const src = reader.result as string;
                editor?.chain().focus().setImage({ src }).run();
              };
              reader.readAsDataURL(file);
              return true;
            }
          }
        }
        return false;
      },
    },
  });

  // Save on blur
  const handleBlur = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    onSave(latestContent.current);
  }, [onSave]);

  useEffect(() => {
    if (!editor) return;
    editor.on("blur", handleBlur);
    return () => {
      editor.off("blur", handleBlur);
    };
  }, [editor, handleBlur]);

  // Sync content from parent when note changes (different note selected)
  const prevContent = useRef(content);
  useEffect(() => {
    if (editor && content !== prevContent.current) {
      prevContent.current = content;
      // Only reset if content is actually different from editor state
      const editorHtml = editor.getHTML();
      if (editorHtml !== content) {
        editor.commands.setContent(content);
      }
    }
  }, [editor, content]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (!editor) return null;

  return (
    <div className="research-editor flex flex-col h-full">
      <EditorToolbar editor={editor} />
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
