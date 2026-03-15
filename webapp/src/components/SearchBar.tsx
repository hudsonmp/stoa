import { Search as SearchIcon } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SearchBar({
  value,
  onChange,
  placeholder = "Search...",
}: SearchBarProps) {
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-card
                 bg-bg-primary border border-border
                 focus-within:border-accent/30 focus-within:shadow-warm
                 transition-warm"
    >
      <SearchIcon size={14} className="text-text-tertiary flex-shrink-0" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent border-none outline-none
                   text-sm font-sans text-text-primary
                   placeholder:text-text-tertiary"
      />
    </div>
  );
}
