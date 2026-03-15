import { useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Document, Page, pdfjs } from "react-pdf";
import {
  Upload,
  FileText,
  X,
  ZoomIn,
  ZoomOut,
  Save,
  Loader2,
} from "lucide-react";
import { ingestPdf } from "@/lib/api";

import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export default function ReadPDF() {
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1.2);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onFileChange = useCallback((f: File | null) => {
    if (f && f.type === "application/pdf") {
      setFile(f);
      setNumPages(0);
      setLoadError(null);
      setSaveResult(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      onFileChange(f ?? null);
    },
    [onFileChange],
  );

  const handleSave = async () => {
    if (!file || saving) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const result = await ingestPdf(file);
      setSaveResult(`Saved to Stoa (${result.chunks_created} chunks indexed)`);
    } catch (e) {
      setSaveResult(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveResult(null), 5000);
    }
  };

  const zoomIn = () => setScale((s) => Math.min(s + 0.2, 3));
  const zoomOut = () => setScale((s) => Math.max(s - 0.2, 0.4));

  // Empty state: drop zone
  if (!file) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-8 h-full flex flex-col">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        >
          <h1 className="font-serif text-2xl font-semibold text-text-primary mb-2">
            Read PDF
          </h1>
          <p className="text-sm text-text-tertiary mb-8">
            Open any PDF file to read it inline. Optionally save it to your
            library.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.05,
            duration: 0.35,
            ease: [0.23, 1, 0.32, 1],
          }}
          className="flex-1 flex items-center justify-center"
        >
          <div
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`w-full max-w-lg border-2 border-dashed rounded-card p-16
                        flex flex-col items-center justify-center gap-4 cursor-pointer
                        transition-warm min-h-[280px]
                        ${
                          dragOver
                            ? "border-accent bg-accent/5"
                            : "border-border hover:border-accent/30 hover:bg-bg-secondary/30"
                        }`}
          >
            <Upload
              size={40}
              className={`${dragOver ? "text-accent" : "text-text-tertiary/50"} transition-warm`}
            />
            <div className="text-center">
              <p className="text-sm font-medium text-text-secondary">
                Drop a PDF here or click to browse
              </p>
              <p className="text-[12px] text-text-tertiary mt-1">
                The file stays on your device until you choose to save
              </p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </motion.div>
      </div>
    );
  }

  // PDF loaded: viewer
  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-primary/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => {
              setFile(null);
              setNumPages(0);
              setLoadError(null);
            }}
            className="p-1.5 rounded-card hover:bg-bg-secondary transition-warm"
            title="Close PDF"
          >
            <X size={16} className="text-text-tertiary" />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} className="text-accent flex-shrink-0" />
            <span className="text-sm text-text-primary truncate max-w-[300px]">
              {file.name}
            </span>
          </div>

          {numPages > 0 && (
            <span className="text-[11px] font-mono text-text-tertiary tabular-nums flex-shrink-0">
              {numPages} page{numPages !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Zoom controls */}
          <button
            onClick={zoomOut}
            className="p-1.5 rounded-card hover:bg-bg-secondary transition-warm"
            title="Zoom out"
          >
            <ZoomOut size={14} className="text-text-tertiary" />
          </button>
          <span className="text-[11px] font-mono text-text-tertiary tabular-nums w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            className="p-1.5 rounded-card hover:bg-bg-secondary transition-warm"
            title="Zoom in"
          >
            <ZoomIn size={14} className="text-text-tertiary" />
          </button>

          <div className="w-px h-5 bg-border mx-2" />

          {/* Save to Stoa */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-card
                       bg-accent text-white text-[12px] font-medium
                       hover:bg-accent-hover transition-warm
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Save size={12} />
            )}
            {saving ? "Saving..." : "Save to Stoa"}
          </button>
        </div>
      </div>

      {/* Save result toast */}
      {saveResult && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mx-6 mt-2 px-3 py-2 rounded-card bg-bg-secondary text-[12px] font-mono text-text-secondary"
        >
          {saveResult}
        </motion.div>
      )}

      {/* PDF pages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-bg-secondary/30"
      >
        <div className="flex flex-col items-center py-6 gap-4">
          <Document
            file={file}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            onLoadError={(error) =>
              setLoadError(error?.message || "Failed to load PDF")
            }
            loading={
              <div className="flex flex-col items-center gap-3 py-20">
                <Loader2
                  size={24}
                  className="animate-spin text-text-tertiary"
                />
                <p className="text-sm text-text-tertiary">Loading PDF...</p>
              </div>
            }
          >
            {loadError ? (
              <div className="text-center py-20">
                <p className="text-sm text-red-600">{loadError}</p>
              </div>
            ) : (
              Array.from({ length: numPages }, (_, i) => (
                <div key={i} className="relative mb-4 last:mb-0">
                  <Page
                    pageNumber={i + 1}
                    scale={scale}
                    className="shadow-warm rounded-sm overflow-hidden"
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                  />
                  <div className="absolute bottom-2 right-3">
                    <span className="text-[10px] font-mono text-text-tertiary/60 bg-bg-primary/80 px-1.5 py-0.5 rounded">
                      {i + 1}
                    </span>
                  </div>
                </div>
              ))
            )}
          </Document>
        </div>
      </div>
    </div>
  );
}
