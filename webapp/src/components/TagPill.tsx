interface TagPillProps {
  name: string;
  onClick?: () => void;
  active?: boolean;
}

export default function TagPill({ name, onClick, active }: TagPillProps) {
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center px-2 py-0.5 rounded-tag text-[11px] font-mono
        transition-warm select-none
        ${
          active
            ? "bg-accent/10 text-accent"
            : "bg-bg-secondary text-text-secondary hover:bg-accent/5 hover:text-accent"
        }
        ${onClick ? "cursor-pointer" : "cursor-default"}
      `}
    >
      #{name}
    </button>
  );
}
