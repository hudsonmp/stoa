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

// 6 page layers for ruffle effect
const PAGES = [0, 1, 2, 3, 4, 5];

// Page cream tones — subtle variation for realism
const PAGE_TONES = [
  "#ede9e0", "#f0ece4", "#eee9e1", "#f2efe7", "#efebe3", "#f1ede5",
];

export default function BookSpine({
  book,
  index,
  isExpanded,
  onToggle,
}: BookSpineProps) {
  const spineColor =
    book.spine_color || SPINE_COLORS[index % SPINE_COLORS.length];
  const textColor = book.text_color || "#E8E4DC";

  return (
    <motion.button
      onClick={onToggle}
      className="outline-none flex-shrink-0 relative"
      style={{ height: 230 }}
      layout
      animate={{ width: isExpanded ? 172 : 42 }}
      transition={{ type: "spring", stiffness: 200, damping: 24, mass: 0.8 }}
      aria-label={`${book.title}${isExpanded ? " (expanded)" : ""}`}
    >
      {/*
       * Book body — single motion.div for the pull-out + turn.
       * translateY pulls the book up from the shelf.
       * translateZ brings it forward toward the viewer.
       * rotateX adds a subtle forward tilt as if grasped from above.
       * These three properties animate simultaneously with overlapping
       * ease curves to create the "one fluid motion" feel.
       */}
      <motion.div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: 172,
          height: 220,
          transformStyle: "preserve-3d",
          transformOrigin: "left bottom",
        }}
        animate={{
          y: isExpanded ? -24 : 0,
          z: isExpanded ? 35 : 0,
          rotateX: isExpanded ? -2 : 0,
        }}
        transition={{
          y: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
          z: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
          rotateX: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
        }}
      >
        {/* ── Spine face ── */}
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
            rotateY: isExpanded ? -60 : 0,
          }}
          transition={{
            rotateY: {
              duration: 0.55,
              delay: 0.12, // starts after pull-up is underway
              ease: [0.22, 1, 0.36, 1],
            },
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
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.05))",
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

        {/* ── Page ruffle layers ──
         * 6 thin layers between spine and cover. On expand:
         *   keyframes: [86°, peakFan, settle]
         *   - Start at 86° (edge-on, invisible)
         *   - Fan to peakFan (visible, cascading outward)
         *   - Settle near 80° (stacked, slight splay)
         * Inner pages (low index) fan MORE and earlier.
         * Staggered delay creates the ruffle cascade.
         */}
        {PAGES.map((i) => {
          const peakFan = 25 + i * 9;   // inner pages fan wider
          const settle = 76 + i * 1.5;  // settle close together
          return (
            <motion.div
              key={i}
              style={{
                position: "absolute",
                left: 42,
                top: 1 + i * 0.4,
                width: 127,
                height: 218 - i * 0.8,
                background: `linear-gradient(to right,
                  ${PAGE_TONES[i]} 0%,
                  #f8f6f1 100%)`,
                transformOrigin: "left center",
                transformStyle: "preserve-3d",
                borderRadius: "0 1px 1px 0",
                boxShadow: i === 0
                  ? "inset 1px 0 2px rgba(0,0,0,0.06)"
                  : "inset 0 0 0 0.5px rgba(0,0,0,0.03)",
              }}
              animate={{
                rotateY: isExpanded ? [86, peakFan, settle] : 86,
              }}
              transition={{
                duration: 0.7,
                delay: isExpanded ? 0.15 + i * 0.04 : 0.02 * i,
                ease: [0.22, 1, 0.36, 1],
                times: isExpanded ? [0, 0.5, 1] : undefined,
              }}
            />
          );
        })}

        {/* ── Cover face ── */}
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
            rotateY: {
              duration: 0.55,
              delay: isExpanded ? 0.18 : 0,
              ease: [0.22, 1, 0.36, 1],
            },
            opacity: {
              duration: 0.2,
              delay: isExpanded ? 0.28 : 0,
            },
          }}
        >
          {/* Page edge lines (left edge of cover) */}
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
      </motion.div>

      {/* Shadow underneath — grows when book lifts off shelf */}
      <motion.div
        className="absolute -bottom-2 left-1 right-1 h-4 pointer-events-none"
        animate={{
          opacity: isExpanded ? 0.5 : 0.15,
          scaleX: isExpanded ? 1.15 : 1,
          y: isExpanded ? 4 : 0,
        }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.35) 0%, transparent 70%)",
          transformOrigin: "center bottom",
        }}
      />
    </motion.button>
  );
}
