import { useEffect, useState } from "react";

/**
 * Lightweight note editor for margin/inline use.
 * Lazy-loads TipTap with StarterKit + Placeholder + Image + Underline + Link + Mention.
 * Falls back to a plain textarea if imports fail.
 */
interface NoteEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
}

export default function NoteEditor({
  content,
  onChange,
  placeholder = "Write your notes...",
}: NoteEditorProps) {
  const [TipTapEditor, setTipTapEditor] = useState<React.ComponentType<{
    content: string;
    onChange: (c: string) => void;
    placeholder: string;
  }> | null>(null);

  useEffect(() => {
    Promise.all([
      import("@tiptap/react"),
      import("@tiptap/starter-kit"),
      import("@tiptap/extension-placeholder"),
      import("@tiptap/extension-image"),
      import("@tiptap/extension-underline"),
      import("@tiptap/extension-link"),
    ])
      .then(
        ([
          { useEditor, EditorContent },
          { default: StarterKit },
          { default: Placeholder },
          { default: Image },
          { default: Underline },
          { default: Link },
        ]) => {
          const TipTap = ({
            content: c,
            onChange: onC,
            placeholder: ph,
          }: {
            content: string;
            onChange: (c: string) => void;
            placeholder: string;
          }) => {
            const editor = useEditor({
              extensions: [
                StarterKit,
                Placeholder.configure({ placeholder: ph }),
                Image.configure({ allowBase64: true }),
                Underline,
                Link.configure({
                  openOnClick: true,
                  autolink: true,
                  HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
                }),
              ],
              content: c,
              onUpdate: ({ editor: ed }) => onC(ed.getHTML()),
            });
            return <EditorContent editor={editor} />;
          };
          setTipTapEditor(() => TipTap);
        }
      )
      .catch(() => {
        // TipTap not installed, stay with fallback
      });
  }, []);

  if (TipTapEditor) {
    return (
      <div className="border border-border rounded-card p-3 bg-bg-primary focus-within:border-accent/30 transition-warm">
        <TipTapEditor
          content={content}
          onChange={onChange}
          placeholder={placeholder}
        />
      </div>
    );
  }

  // Fallback textarea
  return (
    <textarea
      value={content}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={6}
      className="w-full px-3 py-2.5 rounded-card border border-border
                 bg-bg-primary text-sm text-text-primary font-sans
                 placeholder:text-text-tertiary outline-none resize-none
                 focus:border-accent/30 transition-warm leading-relaxed"
    />
  );
}
