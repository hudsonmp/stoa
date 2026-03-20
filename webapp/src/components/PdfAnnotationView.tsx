/**
 * PdfAnnotationView — Embeds the actual PDF using the browser's native
 * renderer (like Apple Preview) with an annotation overlay.
 *
 * The PDF renders perfectly via <embed> — no JS PDF rendering needed.
 * Annotations are stored separately and shown in the margin sidebar.
 */

interface PdfAnnotationViewProps {
  pdfUrl: string;
  onCreateHighlight: (text: string, color: string, note?: string) => void;
}

export default function PdfAnnotationView({
  pdfUrl,
}: PdfAnnotationViewProps) {
  return (
    <div className="pdf-native-viewer">
      <embed
        src={pdfUrl}
        type="application/pdf"
        className="pdf-native-embed"
      />
    </div>
  );
}
