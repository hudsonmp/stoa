"use client";

import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";

interface TagPickerProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}

export default function TagPicker({
  tags,
  onChange,
  suggestions = [],
  placeholder = "Add tag...",
}: TagPickerProps) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = suggestions.filter(
    (s) =>
      s.toLowerCase().includes(input.toLowerCase()) && !tags.includes(s)
  );

  const addTag = (tag: string) => {
    const clean = tag.replace(/^#/, "").trim();
    if (clean && !tags.includes(clean)) {
      onChange([...tags, clean]);
    }
    setInput("");
    setShowSuggestions(false);
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  return (
    <div className="relative">
      <div
        className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-border
                   bg-surface min-h-[40px] cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded
                       bg-accent-dim text-accent text-xs font-medium"
          >
            #{tag}
            <button onClick={() => removeTag(tag)} className="hover:opacity-70">
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag(input);
            }
            if (e.key === "Backspace" && !input && tags.length > 0) {
              removeTag(tags[tags.length - 1]);
            }
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[80px] bg-transparent border-none outline-none
                     text-sm text-foreground placeholder:text-muted"
        />
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && filtered.length > 0 && (
        <div
          className="absolute top-full left-0 right-0 mt-1 py-1 rounded-lg
                     border border-border bg-surface shadow-lg z-50
                     max-h-[160px] overflow-y-auto"
        >
          {filtered.map((s) => (
            <button
              key={s}
              onMouseDown={() => addTag(s)}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-2
                         transition-colors"
            >
              #{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
