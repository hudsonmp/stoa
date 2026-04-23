/**
 * ProjectNoteEditor — TipTap-based rich editor for project-scoped notes.
 *
 * Mirrors the current post-merge ResearchEditor behaviour, but all @mention
 * side-effects (note_links creation) target the project_note_links table via
 * createProjectNoteLink.
 *
 * This component is the Project-fork equivalent of the library's legacy
 * NoteEditor (which is a thin TipTap wrapper without mentions).
 */

import { useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import ResizableImage from "./ResizableImageExtension";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Mention from "@tiptap/extension-mention";
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
import type {
  SuggestionOptions,
  SuggestionProps,
  SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import { createProjectNoteLink } from "@/lib/api";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID;

// ── mention autocomplete ──────────────────────────────────────────────────────

interface MentionResult {
  id: string;
  label: string;
  ref_type: "note" | "item" | "person" | "folder";
  sub?: string;
}

function getAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (DEV_USER_ID) {
    h["X-User-Id"] = DEV_USER_ID;
    return h;
  }
  const token = localStorage.getItem("stoa_token");
  const userId = localStorage.getItem("stoa_user_id");
  if (token) h["Authorization"] = `Bearer ${token}`;
  else if (userId) h["X-User-Id"] = userId;
  return h;
}

/**
 * Multi-entity @mention search: items + notes + people.
 * Falls back to item-only quick-search if mention-search is unavailable.
 */
async function mentionSearch(
  query: string
): Promise<Array<MentionItem & { ref_type?: string }>> {
  if (!query || query.length < 1) return [];
  try {
    const res = await fetch(
      `${API_URL}/items/mention-search?q=${encodeURIComponent(query)}&limit=8`,
      { headers: getAuthHeaders() }
    );
    if (!res.ok) throw new Error("mention-search unavailable");
    const data: { results: MentionResult[] } = await res.json();
    return (data.results || []).map((r) => ({
      id: r.id,
      label: r.label,
      ref_type: r.ref_type,
      sub: r.sub,
    }));
  } catch {
    const res2 = await fetch(
      `${API_URL}/items/quick-search?q=${encodeURIComponent(query)}&limit=8`,
      { headers: getAuthHeaders() }
    );
    if (!res2.ok) return [];
    const data2: { results: { id: string; title: string }[] } =
      await res2.json();
    return (data2.results || []).map((r) => ({
      id: r.id,
      label: r.title,
      ref_type: "item" as const,
    }));
  }
}

function makeSuggestion(): Omit<
  SuggestionOptions<
    MentionItem & { ref_type?: string },
    MentionItem & { ref_type?: string }
  >,
  "editor"
> {
  return {
    items: async ({ query }) => mentionSearch(query),
    render: () => {
      let root: ReactDOM.Root | null = null;
      let popup: HTMLDivElement | null = null;
      let componentRef: MentionListRef | null = null;

      return {
        onStart: (
          props: SuggestionProps<
            MentionItem & { ref_type?: string },
            MentionItem & { ref_type?: string }
          >
        ) => {
          popup = document.createElement("div");
          popup.style.position = "absolute";
          popup.style.zIndex = "50";
          document.body.appendChild(popup);

          root = ReactDOM.createRoot(popup);
          root.render(
            <MentionList
              ref={(ref) => {
                componentRef = ref;
              }}
              items={props.items}
              command={props.command}
            />
          );

          updatePosition(popup, props.clientRect);
        },

        onUpdate: (
          props: SuggestionProps<
            MentionItem & { ref_type?: string },
            MentionItem & { ref_type?: string }
          >
        ) => {
          if (root && popup) {
            root.render(
              <MentionList
                ref={(ref) => {
                  componentRef = ref;
                }}
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

// ── link persistence ──────────────────────────────────────────────────────────

/**
 * Parse @mentions from TipTap HTML and upsert them as project_note_links.
 * Fire-and-forget so the editor save path stays unblocked.
 */
async function syncProjectMentionLinks(
  noteId: string,
  html: string
): Promise<void> {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const mentions = doc.querySelectorAll("a[data-type='mention'][data-id]");

    const seen = new Set<string>();
    const links: Array<{
      target_ref_type: "note" | "item" | "person" | "folder";
      target_ref_id: string;
      mention_offset: number;
    }> = [];
    const plainText = doc.body.textContent || "";

    mentions.forEach((el) => {
      const id = el.getAttribute("data-id") || "";
      const refType = (el.getAttribute("data-ref-type") ||
        "item") as "note" | "item" | "person" | "folder";
      const key = `${refType}::${id}`;
      if (!id || seen.has(key)) return;
      seen.add(key);
      const label = el.textContent || "";
      const offset = Math.max(0, plainText.indexOf(label));
      links.push({
        target_ref_type: refType,
        target_ref_id: id,
        mention_offset: offset,
      });
    });

    await Promise.allSettled(
      links.map((l) => createProjectNoteLink(noteId, l))
    );
  } catch {
    // never block save
  }
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

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

      <ToolbarButton
        onClick={addLink}
        isActive={editor.isActive("link")}
        title="Link"
      >
        <LinkIcon size={S} />
      </ToolbarButton>
      <ToolbarButton onClick={addImage} isActive={false} title="Image">
        <ImageIcon size={S} />
      </ToolbarButton>
    </div>
  );
}

// ── ProjectNoteEditor ─────────────────────────────────────────────────────────

interface ProjectNoteEditorProps {
  content: string;
  onSave: (content: string) => void;
  placeholder?: string;
  /** When present, @mentions are persisted as project_note_links after each save. */
  projectNoteId?: string;
}

export default function ProjectNoteEditor({
  content,
  onSave,
  placeholder = "Start writing...",
  projectNoteId,
}: ProjectNoteEditorProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContent = useRef(content);
  const noteIdRef = useRef(projectNoteId);
  useEffect(() => {
    noteIdRef.current = projectNoteId;
  }, [projectNoteId]);

  const handleSave = useCallback(
    (html: string) => {
      onSave(html);
      if (noteIdRef.current) {
        syncProjectMentionLinks(noteIdRef.current, html);
      }
    },
    [onSave]
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      ResizableImage.configure({ allowBase64: true }),
      Underline,
      Link.configure({
        openOnClick: true,
        autolink: true,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      }),
      Mention.configure({
        HTMLAttributes: { class: "stoa-mention" },
        renderHTML({ options, node }) {
          const refType: string = node.attrs.ref_type ?? "item";
          const id: string = node.attrs.id ?? "";
          let href = `/item/${id}`;
          if (refType === "note") href = `/notes/${id}`;
          else if (refType === "person") href = `/people/${id}`;
          return [
            "a",
            {
              ...options.HTMLAttributes,
              "data-type": "mention",
              "data-id": id,
              "data-ref-type": refType,
              href,
              class: "stoa-mention",
            },
            `@${node.attrs.label ?? id}`,
          ];
        },
        suggestion: makeSuggestion() as unknown as typeof Mention.options.suggestion,
      }),
    ],
    content,
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      latestContent.current = html;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        handleSave(html);
      }, 5000);
    },
    editorProps: {
      handleDrop: (_view, event) => {
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
      handlePaste: (_view, event) => {
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

  const handleBlur = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    handleSave(latestContent.current);
  }, [handleSave]);

  useEffect(() => {
    if (!editor) return;
    editor.on("blur", handleBlur);
    return () => {
      editor.off("blur", handleBlur);
    };
  }, [editor, handleBlur]);

  const prevContent = useRef(content);
  useEffect(() => {
    if (editor && content !== prevContent.current) {
      prevContent.current = content;
      const editorHtml = editor.getHTML();
      if (editorHtml !== content) {
        editor.commands.setContent(content);
      }
    }
  }, [editor, content]);

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
