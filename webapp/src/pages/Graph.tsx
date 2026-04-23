import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { polygonHull } from "d3-polygon";
import ForceGraph2D from "react-force-graph-2d";
import {
  getNotesGraph,
  listCollections,
  KNOWLEDGE_TYPES,
  type GraphNode,
  type GraphEdge,
  type KnowledgeType,
} from "@/lib/api";

/**
 * Graph view for Stoa's note collection.
 *
 * Rendering grounded in:
 *  - Matuschak (evergreen notes should be densely linked) → degree ∝ size
 *  - Shneiderman (1996) → overview / zoom / filter / details-on-demand
 *  - Fruchterman & Reingold (1991) → force-directed
 *  - Ware (2012, ch.4) → 7 categorical colors = pre-attentive limit;
 *    our 7 knowledge types fit exactly
 *
 * Phase-1 scope: overview + kt color + folder hulls + orphan halos + hover
 * neighborhood + click navigate. Filter chips, local-mode, SVG export
 * deferred to Phase 2 (see plan).
 */

const KT_COLOR: Record<KnowledgeType, string> = {
  declarative: "#3b82f6",
  procedural: "#10b981",
  conceptual: "#8b5cf6",
  episodic: "#f59e0b",
  stylistic: "#ec4899",
  idea: "#eab308",
  mytake: "#14b8a6",
};
const UNENCODED_COLOR = "#94a3b8";
const ORPHAN_RING_COLOR = "#ef4444";

// Soft tinted hull per collection. Hash id → hue; low sat, high lightness
// so the hull sits behind nodes without competing for attention.
function hullColor(collectionId: string): string {
  let h = 0;
  for (let i = 0; i < collectionId.length; i++) {
    h = (h * 31 + collectionId.charCodeAt(i)) % 360;
  }
  return `hsla(${h}, 40%, 80%, 0.28)`;
}

interface Collection {
  id: string;
  name: string;
}

export default function Graph() {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 700 });

  useEffect(() => {
    Promise.all([getNotesGraph(), listCollections()])
      .then(([g, cs]) => {
        setNodes(g.nodes);
        setEdges(g.edges);
        setCollections((cs.collections || []) as Collection[]);
      })
      .catch(() => {
        /* silent */
      })
      .finally(() => setLoading(false));
  }, []);

  // Track container size so the canvas fills the page.
  useEffect(() => {
    function resize() {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Precompute neighbor set for the hovered node so rendering can fade
  // non-neighbors (Shneiderman details-on-demand).
  const neighborIds = useMemo(() => {
    if (!hoverId) return null;
    const s = new Set<string>([hoverId]);
    for (const e of edges) {
      const src = typeof e.source === "string" ? e.source : e.source.id;
      const tgt = typeof e.target === "string" ? e.target : e.target.id;
      if (src === hoverId) s.add(tgt);
      if (tgt === hoverId) s.add(src);
    }
    return s;
  }, [hoverId, edges]);

  const orphanCount = useMemo(
    () =>
      nodes.filter((n) => n.note_type === "synthesis" && n.degree < 2).length,
    [nodes]
  );

  const collectionMap = useMemo(() => {
    const m = new Map<string, Collection>();
    for (const c of collections) m.set(c.id, c);
    return m;
  }, [collections]);

  // Nodes per collection (for hull drawing)
  const nodesByCollection = useMemo(() => {
    const m = new Map<string, GraphNode[]>();
    for (const n of nodes) {
      for (const cid of n.collection_ids) {
        if (!m.has(cid)) m.set(cid, []);
        m.get(cid)!.push(n);
      }
    }
    return m;
  }, [nodes]);

  const graphData = useMemo(
    () => ({
      nodes,
      links: edges.map((e) => ({
        source: typeof e.source === "string" ? e.source : e.source.id,
        target: typeof e.target === "string" ? e.target : e.target.id,
        kind: e.kind,
      })),
    }),
    [nodes, edges]
  );

  // Degree → node radius on a log scale, clamped to [4, 18]px.
  function nodeRadius(n: GraphNode): number {
    const r = 4 + Math.log2(1 + n.degree) * 3;
    return Math.max(4, Math.min(18, r));
  }

  function nodeColor(n: GraphNode): string {
    return n.knowledge_type ? KT_COLOR[n.knowledge_type] : UNENCODED_COLOR;
  }

  return (
    <div className="flex flex-col h-full">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="px-8 pt-6 pb-3 flex items-start justify-between gap-6 flex-shrink-0"
      >
        <div>
          <h1 className="font-serif text-2xl font-semibold text-text-primary">
            Graph
          </h1>
          <p className="text-[11px] text-text-tertiary mt-1">
            <span className="font-mono tabular-nums">{nodes.length}</span>{" "}
            notes ·{" "}
            <span className="font-mono tabular-nums">{edges.length}</span>{" "}
            links ·{" "}
            <span
              className={`font-mono tabular-nums ${
                orphanCount > 0 ? "text-amber-600" : "text-text-tertiary"
              }`}
            >
              {orphanCount}
            </span>{" "}
            orphans
          </p>
        </div>
        {/* KT legend */}
        <div className="flex flex-wrap gap-2 items-center max-w-[420px] justify-end">
          {KNOWLEDGE_TYPES.map((kt) => (
            <span
              key={kt}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-text-tertiary"
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: KT_COLOR[kt] }}
              />
              {kt === "mytake" ? "my take" : kt}
            </span>
          ))}
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-text-tertiary">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: UNENCODED_COLOR }}
            />
            unencoded
          </span>
        </div>
      </motion.div>

      <div
        ref={containerRef}
        className="flex-1 relative bg-bg-primary border-t border-border"
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-text-tertiary text-sm">
            Loading graph…
          </div>
        )}
        {!loading && nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-text-tertiary text-sm">
            No notes yet. ⌘K to create one.
          </div>
        )}
        {!loading && nodes.length > 0 && (
          <ForceGraph2D
            graphData={graphData}
            width={size.w}
            height={size.h}
            backgroundColor="transparent"
            cooldownTicks={120}
            d3AlphaDecay={0.02}
            nodeRelSize={1}
            // Draw folder hulls BEFORE any node.
            onRenderFramePre={(ctx: CanvasRenderingContext2D) => {
              for (const [cid, ns] of nodesByCollection) {
                const pts = ns
                  .filter(
                    (n): n is GraphNode & { x: number; y: number } =>
                      typeof n.x === "number" && typeof n.y === "number"
                  )
                  .map((n) => [n.x, n.y] as [number, number]);
                if (pts.length < 3) continue;
                const hull = polygonHull(pts);
                if (!hull) continue;
                // Expand hull slightly so nodes sit inside it.
                const cx =
                  hull.reduce((s, p) => s + p[0], 0) / hull.length;
                const cy =
                  hull.reduce((s, p) => s + p[1], 0) / hull.length;
                ctx.beginPath();
                hull.forEach(([x, y], i) => {
                  const dx = x - cx;
                  const dy = y - cy;
                  const ex = cx + dx * 1.18;
                  const ey = cy + dy * 1.18;
                  if (i === 0) ctx.moveTo(ex, ey);
                  else ctx.lineTo(ex, ey);
                });
                ctx.closePath();
                ctx.fillStyle = hullColor(cid);
                ctx.fill();
              }
            }}
            linkColor={(l: unknown) => {
              const link = l as { kind?: string; source: GraphNode; target: GraphNode };
              if (hoverId) {
                const inN =
                  neighborIds &&
                  (neighborIds.has(link.source.id) ||
                    neighborIds.has(link.target.id));
                if (!inN) return "rgba(148, 163, 184, 0.08)";
              }
              const alpha =
                link.kind === "body" ? "0.35" : link.kind === "both" ? "0.8" : "0.6";
              return `rgba(100, 116, 139, ${alpha})`;
            }}
            linkLineDash={(l: unknown) => {
              const link = l as { kind?: string };
              return link.kind === "body" ? [4, 3] : null;
            }}
            linkDirectionalArrowLength={(l: unknown) => {
              const link = l as { kind?: string };
              return link.kind === "body" ? 0 : 4;
            }}
            linkDirectionalArrowRelPos={1}
            nodeCanvasObjectMode={() => "replace"}
            nodeCanvasObject={(
              n: GraphNode,
              ctx: CanvasRenderingContext2D
            ) => {
              if (typeof n.x !== "number" || typeof n.y !== "number") return;
              const r = nodeRadius(n);
              const dim =
                hoverId && neighborIds && !neighborIds.has(n.id) ? 0.15 : 1;

              // Orphan ring (Matuschak "orphan = waste" made visible)
              if (n.note_type === "synthesis" && n.degree < 2) {
                ctx.beginPath();
                ctx.arc(n.x, n.y, r + 2.4, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(239, 68, 68, ${0.8 * dim})`;
                ctx.lineWidth = 1.6;
                ctx.stroke();
              }

              // Node fill
              ctx.beginPath();
              ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
              const base = nodeColor(n);
              ctx.fillStyle = dim < 1 ? withAlpha(base, dim) : base;
              ctx.fill();

              // Hovered or zoomed-in labels
              if (hoverId === n.id || n.degree >= 3) {
                ctx.font = "10px ui-serif, Iowan Old Style, serif";
                ctx.fillStyle = `rgba(15, 23, 42, ${dim})`;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(truncate(n.title, 28), n.x + r + 3, n.y);
              }
            }}
            nodePointerAreaPaint={(
              n: GraphNode,
              color: string,
              ctx: CanvasRenderingContext2D
            ) => {
              if (typeof n.x !== "number" || typeof n.y !== "number") return;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(n.x, n.y, nodeRadius(n) + 4, 0, Math.PI * 2);
              ctx.fill();
            }}
            onNodeHover={(n: GraphNode | null) => setHoverId(n?.id ?? null)}
            onNodeClick={(n: GraphNode) => navigate(`/notes/${n.id}`)}
          />
        )}

        {/* Folder legend, overlay bottom-right */}
        {!loading && collections.length > 0 && nodesByCollection.size > 0 && (
          <div className="absolute bottom-3 right-3 text-[10px] font-mono bg-bg-primary/85 border border-border rounded-card px-2 py-1.5 max-w-[220px]">
            <div className="text-text-tertiary uppercase tracking-wider mb-1">
              Folders
            </div>
            {[...nodesByCollection.keys()].map((cid) => {
              const col = collectionMap.get(cid);
              if (!col) return null;
              return (
                <div
                  key={cid}
                  className="flex items-center gap-1.5 text-text-secondary truncate"
                >
                  <span
                    className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: hullColor(cid) }}
                  />
                  {col.name}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Rough alpha application for hex colors — good enough for dim factor.
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
