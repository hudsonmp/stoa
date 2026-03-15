import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Link as LinkIcon,
  Loader2,
  Type,
  Image as ImageIcon,
  Upload,
  FolderOpen,
} from "lucide-react";
import { ingestUrl, ingestPaste, ingestImage, extractMetadata, listCollections } from "@/lib/api";

interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}

type InputMode = "url" | "text" | "image";

const ITEM_TYPES = [
  "blog",
  "writing",
  "book",
  "paper",
  "podcast",
  "video",
  "page",
] as const;

export default function AddItemModal({
  isOpen,
  onClose,
  onAdded,
}: AddItemModalProps) {
  const [mode, setMode] = useState<InputMode>("url");
  const [url, setUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState("blog");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    title: string;
    domain: string;
    favicon_url: string;
  } | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string>("");
  const [collections, setCollections] = useState<{ id: string; name: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      listCollections()
        .then((data) => setCollections(data.collections || []))
        .catch(() => {});
    }
  }, [isOpen]);

  const handleUrlBlur = async () => {
    if (!url.trim()) return;
    try {
      const meta = await extractMetadata(url);
      setPreview(meta);
    } catch {
      // Metadata extraction is optional
    }
  };

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    },
    []
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (mode !== "image") return;
      const items = e.clipboardData.items;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) return;
          setImageFile(file);
          const reader = new FileReader();
          reader.onload = (ev) =>
            setImagePreview(ev.target?.result as string);
          reader.readAsDataURL(file);
          return;
        }
      }
    },
    [mode]
  );

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      if (mode === "url") {
        if (!url.trim()) return;
        await ingestUrl({ url, type, collection_id: collectionId || undefined });
      } else if (mode === "text") {
        if (!textContent.trim()) return;
        await ingestPaste({
          content: textContent,
          title: title || undefined,
          type,
        });
      } else if (mode === "image") {
        if (!imageFile) return;
        await ingestImage(imageFile, title || undefined, type);
      }

      // Reset state
      setUrl("");
      setTextContent("");
      setTitle("");
      setType("blog");
      setCollectionId("");
      setPreview(null);
      setImageFile(null);
      setImagePreview(null);
      onAdded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add item");
    } finally {
      setLoading(false);
    }
  };

  const canSubmit =
    !loading &&
    ((mode === "url" && url.trim()) ||
      (mode === "text" && textContent.trim()) ||
      (mode === "image" && imageFile));

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-text-primary/20 z-50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="bg-bg-primary border border-border rounded-modal
                         shadow-warm-lg w-full max-w-md p-6 space-y-4"
              onPaste={handlePaste}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-lg font-medium">Add Item</h2>
                <button
                  onClick={onClose}
                  className="p-1 rounded-card hover:bg-bg-secondary transition-warm"
                >
                  <X size={16} className="text-text-tertiary" />
                </button>
              </div>

              {/* Input mode tabs */}
              <div className="flex gap-1 p-1 bg-bg-secondary rounded-card">
                {(
                  [
                    { key: "url", icon: LinkIcon, label: "URL" },
                    { key: "text", icon: Type, label: "Text" },
                    { key: "image", icon: ImageIcon, label: "Image" },
                  ] as const
                ).map(({ key, icon: Icon, label }) => (
                  <button
                    key={key}
                    onClick={() => setMode(key)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[6px]
                                text-[12px] font-sans font-medium transition-warm
                                ${
                                  mode === key
                                    ? "bg-bg-primary text-text-primary shadow-sm"
                                    : "text-text-tertiary hover:text-text-secondary"
                                }`}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>

              {/* URL Input */}
              {mode === "url" && (
                <div>
                  <label className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5 block">
                    URL
                  </label>
                  <div
                    className="flex items-center gap-2 px-3 py-2.5 rounded-card
                               border border-border focus-within:border-accent/30
                               transition-warm"
                  >
                    <LinkIcon
                      size={14}
                      className="text-text-tertiary flex-shrink-0"
                    />
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onBlur={handleUrlBlur}
                      placeholder="https://..."
                      className="flex-1 bg-transparent border-none outline-none
                                 text-sm text-text-primary placeholder:text-text-tertiary"
                    />
                  </div>

                  {preview && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary rounded-card mt-2">
                      {preview.favicon_url && (
                        <img
                          src={preview.favicon_url}
                          alt=""
                          className="w-4 h-4 rounded-sm"
                        />
                      )}
                      <span className="text-sm text-text-primary truncate">
                        {preview.title}
                      </span>
                      <span className="text-[11px] font-serif italic text-text-tertiary ml-auto">
                        {preview.domain}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Text Input */}
              {mode === "text" && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5 block">
                      Title (optional)
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Give it a name..."
                      className="w-full px-3 py-2 rounded-card border border-border
                                 bg-transparent text-sm text-text-primary
                                 placeholder:text-text-tertiary outline-none
                                 focus:border-accent/30 transition-warm"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5 block">
                      Content
                    </label>
                    <textarea
                      value={textContent}
                      onChange={(e) => setTextContent(e.target.value)}
                      placeholder="Paste or type text here..."
                      rows={6}
                      className="w-full px-3 py-2.5 rounded-card border border-border
                                 bg-transparent text-sm text-text-primary font-serif
                                 leading-relaxed placeholder:text-text-tertiary
                                 outline-none focus:border-accent/30 transition-warm
                                 resize-y min-h-[120px]"
                    />
                  </div>
                </div>
              )}

              {/* Image Input */}
              {mode === "image" && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5 block">
                      Title (optional)
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Name this image..."
                      className="w-full px-3 py-2 rounded-card border border-border
                                 bg-transparent text-sm text-text-primary
                                 placeholder:text-text-tertiary outline-none
                                 focus:border-accent/30 transition-warm"
                    />
                  </div>
                  <div
                    className="border-2 border-dashed border-border rounded-card p-6
                               flex flex-col items-center justify-center gap-2
                               hover:border-accent/30 transition-warm cursor-pointer
                               min-h-[140px]"
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                  >
                    {imagePreview ? (
                      <img
                        src={imagePreview}
                        alt="Preview"
                        className="max-h-[160px] rounded-card object-contain"
                      />
                    ) : (
                      <>
                        <Upload
                          size={24}
                          className="text-text-tertiary"
                        />
                        <p className="text-sm text-text-tertiary text-center">
                          Click, drop, or paste an image
                        </p>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                  </div>
                </div>
              )}

              {/* Collection selector */}
              {collections.length > 0 && (
                <div>
                  <label className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5 block">
                    Save for...
                  </label>
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-card border border-border focus-within:border-accent/30 transition-warm">
                    <FolderOpen size={14} className="text-text-tertiary flex-shrink-0" />
                    <select
                      value={collectionId}
                      onChange={(e) => setCollectionId(e.target.value)}
                      className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary"
                    >
                      <option value="">No collection</option>
                      {collections.map((col) => (
                        <option key={col.id} value={col.id}>
                          {col.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Type selector */}
              <div>
                <label className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5 block">
                  Category
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ITEM_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setType(t)}
                      className={`px-3 py-1.5 rounded-card text-[12px] font-sans font-medium
                                  transition-warm capitalize
                                  ${
                                    type === t
                                      ? "bg-accent/10 text-accent"
                                      : "bg-bg-secondary text-text-secondary hover:text-text-primary"
                                  }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="w-full py-2.5 rounded-card bg-accent text-white text-sm
                           font-medium hover:bg-accent-hover transition-warm
                           disabled:opacity-40 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
              >
                {loading && <Loader2 size={14} className="animate-spin" />}
                {loading ? "Adding..." : "Add to Library"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
