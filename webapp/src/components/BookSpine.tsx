import { motion } from "framer-motion";
import type { Item } from "@/lib/supabase";

interface BookSpineProps {
  book: Item;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}

const SPINE_COLORS = [
  "#2C3930", "#4A3728", "#1B3A4B", "#3D2B1F",
  "#2D3436", "#523A28", "#1A332E", "#4B3621",
  "#2E2118", "#354F52", "#3C1518", "#2C3E50",
];

const springConfig = {
  type: "spring" as const,
  stiffness: 200,
  damping: 24,
  mass: 0.8,
};

export default function BookSpine({
  book,
  index,
  isExpanded,
  onToggle,
}: BookSpineProps) {
  const spineColor = book.spine_color || SPINE_COLORS[index % SPINE_COLORS.length];
  const textColor = book.text_color || "#E8E4DC";

  return (
    <motion.button
      onClick={onToggle}
      className="outline-none flex-shrink-0 relative"
      style={{ height: 220 }}
      layout
      animate={{ width: isExpanded ? 172 : 42 }}
      transition={springConfig}
      aria-label={`${book.title}${isExpanded ? " (expanded)" : ""}`}
    >
      {/* Spine face (always visible) */}
      <motion.div
        className="absolute left-0 top-0 flex items-start justify-center overflow-hidden"
        style={{
          width: 42,
          height: 220,
          backgroundColor: spineColor,
          color: textColor,
          transformOrigin: "right center",
          transformStyle: "preserve-3d",
          borderRadius: "2px 0 0 2px",
        }}
        animate={{
          rotateY: isExpanded ? -50 : 0,
        }}
        transition={{
          duration: 0.45,
          ease: [0.23, 1, 0.32, 1],
        }}
      >
        {/* Paper texture overlay */}
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='6' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            backgroundSize: "64px 64px",
            mixBlendMode: "overlay",
          }}
        />

        {/* Left highlight edge */}
        <div
          className="absolute left-0 top-0 bottom-0 w-[1px]"
          style={{
            background: `linear-gradient(to bottom, ${textColor}20, ${textColor}05)`,
          }}
        />
        {/* Right shadow edge */}
        <div
          className="absolute right-0 top-0 bottom-0 w-[1px]"
          style={{
            background: `linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.05))`,
          }}
        />

        {/* Top cap */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background: `linear-gradient(to bottom, ${textColor}10, transparent)`,
          }}
        />

        {/* Title text rotated on spine */}
        <span
          className="mt-4 text-[11px] font-medium select-none
                     overflow-hidden text-ellipsis whitespace-nowrap tracking-wide"
          style={{
            writingMode: "vertical-rl",
            maxHeight: 196,
            fontFamily: '"DM Sans", system-ui, sans-serif',
            textShadow: "0 1px 2px rgba(0,0,0,0.3)",
          }}
        >
          {book.title}
        </span>
      </motion.div>

      {/* Cover face (revealed on expand) */}
      <motion.div
        className="absolute overflow-hidden"
        style={{
          left: 42,
          top: 0,
          width: 130,
          height: 220,
          transformOrigin: "left center",
          transformStyle: "preserve-3d",
          borderRadius: "0 2px 2px 0",
        }}
        animate={{
          rotateY: isExpanded ? 0 : 86,
          opacity: isExpanded ? 1 : 0,
        }}
        transition={{
          rotateY: { duration: 0.45, ease: [0.23, 1, 0.32, 1] },
          opacity: { duration: 0.25, delay: isExpanded ? 0.15 : 0 },
        }}
      >
        {/* Page edge lines */}
        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background: `linear-gradient(to right,
              rgba(255,255,255,0) 0px,
              rgba(255,255,255,0.4) 1px,
              rgba(255,255,255,0.15) 3px,
              transparent 5px,
              transparent 7px,
              rgba(255,255,255,0.1) 8px,
              transparent 10px
            )`,
          }}
        />

        {book.cover_image_url ? (
          <img
            src={book.cover_image_url}
            alt={book.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center
                       p-4 text-center"
            style={{ backgroundColor: spineColor, color: textColor }}
          >
            <span className="text-xs font-serif leading-snug opacity-80">
              {book.title}
            </span>
          </div>
        )}
      </motion.div>

      {/* Hover shadow underneath */}
      <motion.div
        className="absolute -bottom-2 left-1 right-1 h-3 pointer-events-none"
        animate={{ opacity: isExpanded ? 0.4 : 0.15 }}
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.3) 0%, transparent 70%)",
        }}
      />
    </motion.button>
  );
}
