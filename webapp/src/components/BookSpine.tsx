import { motion } from "framer-motion";
import type { Item } from "@/lib/supabase";

interface BookSpineProps {
  book: Item;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function BookSpine({
  book,
  index,
  isExpanded,
  onToggle,
}: BookSpineProps) {
  const spineColor = book.spine_color || "#2C3930";
  const textColor = book.text_color || "#E8E4DC";

  return (
    <motion.button
      onClick={onToggle}
      className="outline-none flex-shrink-0 relative"
      style={{ height: 230, perspective: 800, transformStyle: "preserve-3d" as const }}
      layout
      animate={{ width: isExpanded ? 200 : 42 }}
      transition={{ type: "spring", stiffness: 180, damping: 22, mass: 0.8 }}
      aria-label={`${book.title}${isExpanded ? " (expanded)" : ""}`}
    >
      {/* Book body — pull off shelf toward viewer */}
      <motion.div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: 200,
          height: 220,
          transformStyle: "preserve-3d",
          transformOrigin: "center bottom",
        }}
        animate={{
          y: isExpanded ? -40 : 0,
          z: isExpanded ? 60 : 0,
          rotateX: isExpanded ? -5 : 0,
          scale: isExpanded ? 1.05 : 1,
        }}
        transition={{
          type: "spring",
          stiffness: 120,
          damping: 16,
          mass: 0.7,
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
          animate={{ rotateY: isExpanded ? -75 : 0 }}
          transition={{
            type: "spring",
            stiffness: 100,
            damping: 14,
            mass: 0.6,
            delay: 0.1,
          }}
        >
          {/* Paper texture */}
          <div
            className="absolute inset-0 opacity-[0.07] pointer-events-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='6' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize: "64px 64px",
              mixBlendMode: "overlay",
            }}
          />
          <div
            className="absolute left-0 top-0 bottom-0 w-[1px]"
            style={{ background: `linear-gradient(to bottom, ${textColor}20, ${textColor}05)` }}
          />
          <div
            className="absolute right-0 top-0 bottom-0 w-[1px]"
            style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.05))" }}
          />
          <span
            className="mt-4 text-[11px] font-medium select-none overflow-hidden text-ellipsis whitespace-nowrap tracking-wide"
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

        {/* ── Page layers with spring flutter ── */}
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <motion.div
            key={`page-${i}`}
            style={{
              position: "absolute",
              left: 42,
              top: 1 + i * 0.4,
              width: 155,
              height: 218 - i * 0.8,
              background: `linear-gradient(to right, #ede9e0 0%, #f8f6f1 100%)`,
              transformOrigin: "left center",
              transformStyle: "preserve-3d",
              borderRadius: "0 1px 1px 0",
              boxShadow: i === 0
                ? "inset 1px 0 2px rgba(0,0,0,0.06)"
                : "inset 0 0 0 0.5px rgba(0,0,0,0.03)",
            }}
            animate={{ rotateY: isExpanded ? (72 + i * 1.5) : 86 }}
            transition={
              isExpanded
                ? {
                    type: "spring",
                    stiffness: 80 + i * 25,
                    damping: 5 + i * 3,
                    mass: 0.4 + i * 0.1,
                    delay: 0.12 + i * 0.04,
                  }
                : {
                    duration: 0.3,
                    delay: 0.02 * (5 - i),
                    ease: [0.22, 1, 0.36, 1] as const,
                  }
            }
          />
        ))}

        {/* ── Cover face — swings open like a real book ── */}
        <motion.div
          className="absolute overflow-hidden"
          style={{
            left: 42,
            top: 0,
            width: 155,
            height: 220,
            transformOrigin: "left center",
            transformStyle: "preserve-3d",
            borderRadius: "0 2px 2px 0",
          }}
          animate={{
            rotateY: isExpanded ? -10 : 86,
            opacity: isExpanded ? 1 : 0,
          }}
          transition={{
            rotateY: {
              type: "spring",
              stiffness: 90,
              damping: 14,
              mass: 0.8,
              delay: 0.15,
            },
            opacity: { duration: 0.15, delay: isExpanded ? 0.2 : 0 },
          }}
        >
          {/* Edge line detail */}
          <div
            className="absolute inset-0 z-10 pointer-events-none"
            style={{
              background: `linear-gradient(to right,
                rgba(255,255,255,0) 0px, rgba(255,255,255,0.4) 1px,
                rgba(255,255,255,0.15) 3px, transparent 5px)`,
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
              className="w-full h-full flex flex-col items-center justify-center p-4 text-center"
              style={{ backgroundColor: spineColor, color: textColor }}
            >
              <span className="text-xs font-serif leading-snug opacity-80">
                {book.title}
              </span>
            </div>
          )}
        </motion.div>
      </motion.div>

      {/* Shadow — intensifies as book lifts off shelf */}
      <motion.div
        className="absolute -bottom-2 left-1 right-1 h-5 pointer-events-none"
        animate={{
          opacity: isExpanded ? 0.6 : 0.15,
          scaleX: isExpanded ? 1.3 : 1,
          scaleY: isExpanded ? 1.5 : 1,
          y: isExpanded ? 6 : 0,
        }}
        transition={{
          type: "spring",
          stiffness: 120,
          damping: 18,
        }}
        style={{
          background: "radial-gradient(ellipse at center, rgba(0,0,0,0.4) 0%, transparent 70%)",
          transformOrigin: "center bottom",
        }}
      />
    </motion.button>
  );
}
