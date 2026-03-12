import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Link as LinkIcon, Loader2 } from "lucide-react";
import { ingestUrl, extractMetadata } from "@/lib/api";

interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export default function AddItemModal({
  isOpen,
  onClose,
  onAdded,
}: AddItemModalProps) {
  const [url, setUrl] = useState("");
  const [type, setType] = useState("blog");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    title: string;
    domain: string;
    favicon_url: string;
  } | null>(null);

  const handleUrlBlur = async () => {
    if (!url.trim()) return;
    try {
      const meta = await extractMetadata(url);
      setPreview(meta);
    } catch {
      // Metadata extraction is optional
    }
  };

  const handleSubmit = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    try {
      await ingestUrl({ url, type });
      setUrl("");
      setType("blog");
      setPreview(null);
      onAdded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add item");
    } finally {
      setLoading(false);
    }
  };

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

              {/* URL input */}
              <div>
                <label className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5 block">
                  URL
                </label>
                <div
                  className="flex items-center gap-2 px-3 py-2.5 rounded-card
                             border border-border focus-within:border-accent/30
                             transition-warm"
                >
                  <LinkIcon size={14} className="text-text-tertiary flex-shrink-0" />
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
              </div>

              {/* Preview */}
              {preview && (
                <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary rounded-card">
                  {preview.favicon_url && (
                    <img src={preview.favicon_url} alt="" className="w-4 h-4 rounded-sm" />
                  )}
                  <span className="text-sm text-text-primary truncate">
                    {preview.title}
                  </span>
                  <span className="text-[11px] font-serif italic text-text-tertiary ml-auto">
                    {preview.domain}
                  </span>
                </div>
              )}

              {/* Type selector */}
              <div>
                <label className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5 block">
                  Type
                </label>
                <div className="flex gap-1.5">
                  {["blog", "book", "paper", "podcast", "video", "page"].map(
                    (t) => (
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
                    )
                  )}
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}

              <button
                onClick={handleSubmit}
                disabled={loading || !url.trim()}
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
