/**
 * IpadInkOverlay — renders iPad-authored Apple Pencil ink as a
 * zoom-stable absolutely-positioned PNG inside a react-pdf <Page>.
 *
 * Invariant: the iPad rasterizer renders into a rect equal to the PDF
 * cropBox (in PDF points), at a fixed integer scale. The resulting PNG's
 * pixel width = cropBox.width * scale, height = cropBox.height * scale.
 * Because the PNG's aspect ratio equals the PDF page's aspect ratio,
 * stretching it to `100%` of the <Page>'s rendered box keeps the strokes
 * pinned to the underlying characters across any browser zoom level.
 *
 * Tier 1: view-only. No tap-to-focus, no editing. The component fetches
 * `GET /project-items/:id/ink?page=N`, which mints a 60s signed URL from
 * the Supabase `project-sync` bucket.
 *
 * 404 → render nothing (most pages will have no ink). Anything else →
 * log + render nothing (no user-facing toast; this is a passive overlay).
 */

import { useEffect, useState } from "react";
import { getIpadInk } from "@/lib/api";

interface IpadInkOverlayProps {
  itemId: string;
  pageNumber: number;          // 1-based
}

interface InkMeta {
  signed_url: string;
  page_width_pt: number | null;
  page_height_pt: number | null;
  scale: number | null;
  sha_png: string | null;
  updated_at: string | null;
}

export default function IpadInkOverlay({
  itemId,
  pageNumber,
}: IpadInkOverlayProps) {
  const [ink, setInk] = useState<InkMeta | null>(null);

  useEffect(() => {
    let active = true;
    setInk(null);
    getIpadInk(itemId, pageNumber)
      .then((data) => {
        if (!active) return;
        if (data) setInk(data);
      })
      .catch(() => {
        // 404 and any other failure: silent. The overlay is purely additive.
      });
    return () => {
      active = false;
    };
    // Refetch when the page number changes or the item changes. `sha_png`
    // returned from the server invalidates a stale signed URL across
    // re-renders caused by zoom changes.
  }, [itemId, pageNumber]);

  if (!ink?.signed_url) return null;

  return (
    <img
      src={ink.signed_url}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        userSelect: "none",
      }}
    />
  );
}
