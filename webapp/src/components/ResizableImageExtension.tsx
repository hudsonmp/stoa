/**
 * ResizableImage — TipTap extension that lets users drag-resize images.
 *
 * Extends the base @tiptap/extension-image with a `width` attribute and a
 * React node view that renders a drag handle at the bottom-right corner.
 * Dragging the handle updates node.attrs.width; the attribute is serialised
 * as an HTML width attribute so the stored HTML is round-trippable.
 *
 * Usage (in ResearchEditor.tsx):
 *   import ResizableImage from "./ResizableImageExtension";
 *   // replace Image.configure(...) with:
 *   ResizableImage.configure({ allowBase64: true }),
 */

import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { useRef, useCallback } from "react";
import type { NodeViewProps } from "@tiptap/react";

// ── React node view ────────────────────────────────────────────────────────

function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const { src, alt, title, width } = node.attrs as {
    src: string;
    alt?: string;
    title?: string;
    width?: number | null;
  };

  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const imgRef = useRef<HTMLImageElement>(null);

  const onDragHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startXRef.current = e.clientX;
      startWidthRef.current =
        imgRef.current?.getBoundingClientRect().width ?? (width as number) ?? 400;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startXRef.current;
        const newWidth = Math.max(80, Math.round(startWidthRef.current + delta));
        updateAttributes({ width: newWidth });
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width, updateAttributes],
  );

  return (
    <NodeViewWrapper
      className="resizable-image-wrapper"
      style={{ display: "inline-block", position: "relative", lineHeight: 0 }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt ?? ""}
        title={title ?? ""}
        style={{
          width: width ? `${width}px` : undefined,
          maxWidth: "100%",
          display: "block",
          outline: selected ? "2px solid #3b82f6" : "none",
          borderRadius: 2,
        }}
        draggable={false}
      />
      {/* Drag-resize handle — shown when node is selected */}
      {selected && (
        <div
          onMouseDown={onDragHandleMouseDown}
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 14,
            height: 14,
            background: "#3b82f6",
            borderRadius: "2px 0 2px 0",
            cursor: "se-resize",
            zIndex: 10,
          }}
          title="Drag to resize"
        />
      )}
    </NodeViewWrapper>
  );
}

// ── TipTap extension ────────────────────────────────────────────────────────

const ResizableImage = Node.create({
  name: "image",
  group: "block",
  inline: false,
  atom: true,
  draggable: true,

  addOptions() {
    return {
      ...Image.options,
      allowBase64: false,
    };
  },

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: {
        default: null,
        parseHTML: (el) => {
          const w = (el as HTMLImageElement).getAttribute("width");
          return w ? parseInt(w) : null;
        },
        renderHTML: (attrs) =>
          attrs.width ? { width: String(attrs.width) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },

  addCommands() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setImage:
        (options: { src: string; alt?: string; title?: string; width?: number }) =>
        ({ commands }: any) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },
});

export default ResizableImage;
