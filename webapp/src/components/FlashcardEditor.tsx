import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import MathContent from "./MathContent";
import { syncCardToAnki } from "@/lib/anki";
import { updateNote, setNoteAnkiId } from "@/lib/api";
import type { Note } from "@/lib/supabase";

/**
 * Two-field editor for kt:declarative notes.
 *
 *  - front ↔ note.title (plain text; can be multi-line via textarea)
 *  - back  ↔ note.content (plain text with inline LaTeX; MathContent renders preview)
 *
 * On blur or after a debounce, we:
 *  1. PATCH Stoa with the updated title/content
 *  2. Upsert the card into Anki deck "42" via AnkiConnect (browser-direct).
 *
 * The Anki note id is stored in Stoa's note.tags as `anki:<id>` so subsequent
 * edits update in place instead of creating duplicates.
 */

const DECK_NAME = "42";
const AUTOSAVE_DEBOUNCE_MS = 900;

type SyncState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "synced"; ankiId: number }
  | { kind: "stoa-only"; reason: string };

function extractAnkiId(tags: string[] | undefined): number | null {
  if (!tags) return null;
  for (const t of tags) {
    if (t.startsWith("anki:")) {
      const n = Number(t.slice(5));
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

interface FlashcardEditorProps {
  note: Note;
  collectionNames: string[];
  onNoteUpdated: (note: Partial<Note> & { id: string }) => void;
}

export default function FlashcardEditor({
  note,
  collectionNames,
  onNoteUpdated,
}: FlashcardEditorProps) {
  const [front, setFront] = useState(note.title || "");
  const [back, setBack] = useState(() => stripHtml(note.content || ""));
  const [sync, setSync] = useState<SyncState>({ kind: "idle" });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ front, back });

  // Reset fields when switching to a different note.
  useEffect(() => {
    setFront(note.title || "");
    setBack(stripHtml(note.content || ""));
    setSync({ kind: "idle" });
  }, [note.id]);

  // Auto-push to Anki on mount if the note has content but no anki:<id> yet.
  // This covers notes that existed before Anki sync shipped, and notes
  // created without edits that never triggered the debounced save path.
  const didAutoPushRef = useRef(false);
  useEffect(() => {
    if (didAutoPushRef.current) return;
    const hasAnki = extractAnkiId(note.tags) != null;
    const hasContent =
      (note.title || "").trim().length > 0 ||
      stripHtml(note.content || "").trim().length > 0;
    if (!hasAnki && hasContent) {
      didAutoPushRef.current = true;
      // Defer so the first render completes and state/refs are stable.
      const t = setTimeout(() => doSave(), 50);
      return () => clearTimeout(t);
    }
    didAutoPushRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  useEffect(() => {
    latestRef.current = { front, back };
  }, [front, back]);

  const doSave = useCallback(async () => {
    const { front: f, back: b } = latestRef.current;
    setSync({ kind: "saving" });

    // 1) Persist to Stoa. Content is stored as plain text here (no TipTap HTML) so
    //    that the back-side math renders cleanly in FlashcardReview.
    const existingAnkiId = extractAnkiId(note.tags);
    try {
      await updateNote(note.id, { title: f, content: b });
    } catch {
      setSync({ kind: "stoa-only", reason: "Stoa save failed" });
      return;
    }

    // 2) Push to Anki. Failures here do not invalidate the Stoa save.
    const result = await syncCardToAnki(
      {
        deckName: DECK_NAME,
        front: f,
        back: b,
        tags: ["stoa", ...collectionNames.map((c) => c.replace(/\s+/g, "_"))],
        modelName: "Basic",
      },
      existingAnkiId
    );

    if (!result.ok) {
      setSync({ kind: "stoa-only", reason: result.error });
      onNoteUpdated({ id: note.id, title: f, content: b });
      return;
    }

    const ankiId = result.value;
    // Atomic server-side tag mutation — reads current tags, replaces anki:*
    // only. Previously we built the full tags array from a stale React closure
    // and PATCHed it, which clobbered col:/link:/kt: tags added in between
    // debounce start and save. That bug is now eliminated at the endpoint.
    let updatedTags = note.tags || [];
    try {
      const resp = await setNoteAnkiId(note.id, ankiId);
      const returned = resp.note as { tags?: string[] } | undefined;
      if (returned?.tags) updatedTags = returned.tags;
    } catch {
      // non-fatal — card is in Anki, Stoa just didn't record the id
    }
    onNoteUpdated({ id: note.id, title: f, content: b, tags: updatedTags });
    setSync({ kind: "synced", ankiId });
  }, [note.id, note.tags, collectionNames, onNoteUpdated]);

  // Debounced autosave on field change.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Only autosave if something actually changed.
    if (front === (note.title || "") && back === stripHtml(note.content || "")) {
      return;
    }
    saveTimer.current = setTimeout(doSave, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [front, back]);

  const hasExistingAnki = extractAnkiId(note.tags) != null;

  return (
    <div className="max-w-[820px] mx-auto px-8 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-accent">
            Declarative flashcard
          </div>
          <div className="text-[11px] text-text-tertiary mt-0.5">
            Auto-syncs to Anki deck{" "}
            <span className="font-mono text-text-secondary">{DECK_NAME}</span>.
            You review in Anki; this is just the capture surface.
          </div>
        </div>
        <SyncBadge state={sync} hasExistingAnki={hasExistingAnki} onManualSave={doSave} />
      </div>

      <FieldBlock
        label="Front (cue)"
        value={front}
        onChange={setFront}
        placeholder={"What trait predicts scientific greatness, per Hamming?"}
        minRows={2}
      />
      <FieldBlock
        label="Back (answer)"
        value={back}
        onChange={setBack}
        placeholder={
          "Ambiguity tolerance. Hamming (1986) — cited in Ch. 30. Math OK: \\(E = mc^2\\)."
        }
        minRows={6}
      />

      <div className="text-[11px] text-text-tertiary">
        Tip: write math inline as{" "}
        <span className="font-mono">{"\\(...\\)"}</span> or display as{" "}
        <span className="font-mono">{"\\[...\\]"}</span>. Rendered below and in Anki.
      </div>
    </div>
  );
}

function FieldBlock({
  label,
  value,
  onChange,
  placeholder,
  minRows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows: number;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-wider text-text-tertiary mb-1.5">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        rows={minRows}
        className="w-full px-3 py-2.5 rounded-card border border-border bg-bg-primary
                   text-[14px] text-text-primary font-serif leading-relaxed
                   placeholder:text-text-tertiary outline-none resize-y
                   focus:border-accent/40 transition-warm"
      />
      {!focused && value.trim() && (
        <div className="mt-1 px-3 py-2 rounded-card bg-bg-secondary/40 border border-border/40">
          <div className="text-[9px] font-mono uppercase tracking-wider text-text-tertiary mb-1">
            Preview
          </div>
          <MathContent
            html={escapeHtml(value).replace(/\n/g, "<br />")}
            className="text-[13px] text-text-primary leading-relaxed"
          />
        </div>
      )}
    </div>
  );
}

function SyncBadge({
  state,
  hasExistingAnki,
  onManualSave,
}: {
  state: SyncState;
  hasExistingAnki: boolean;
  onManualSave: () => void;
}) {
  if (state.kind === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary">
        <Loader2 size={12} className="animate-spin" /> Syncing…
      </span>
    );
  }
  if (state.kind === "synced") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-green-600">
        <CheckCircle2 size={12} /> Anki #{state.ankiId}
      </span>
    );
  }
  // Idle state is informational only — no manual button. Autosave + auto-push
  // on mount handle the sync; the user never needs to trigger it explicitly.
  if (state.kind === "idle") {
    return (
      <span className="text-[11px] text-text-tertiary">
        {hasExistingAnki ? `Anki #${extractAnkiId([]) ?? "—"}` : "—"}
      </span>
    );
  }
  if (state.kind === "stoa-only") {
    const looksLikeCors =
      /failed to fetch|cors|network/i.test(state.reason) ||
      /unreachable/i.test(state.reason);
    return (
      <div className="flex flex-col items-end gap-0.5 max-w-[340px]">
        <button
          onClick={onManualSave}
          className="inline-flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-700"
        >
          <AlertCircle size={12} /> Anki sync failed · retry
        </button>
        <div className="text-[10px] text-text-tertiary leading-snug text-right">
          {state.reason}
        </div>
        {looksLikeCors && (
          <div className="text-[10px] text-text-tertiary leading-snug text-right max-w-[320px]">
            Likely CORS: Anki → Tools → Add-ons → AnkiConnect → Config. Add{" "}
            <span className="font-mono text-text-secondary">
              "http://localhost:3000"
            </span>{" "}
            to <span className="font-mono">webCorsOriginList</span> and restart Anki.
          </div>
        )}
      </div>
    );
  }
  // Exhaustive fallthrough (shouldn't hit, but keep a silent placeholder).
  void onManualSave;
  void hasExistingAnki;
  return <span className="text-[11px] text-text-tertiary">—</span>;
}

function stripHtml(html: string): string {
  // Declarative notes created in the TipTap editor before this change may still
  // hold HTML. We present them as plain text here so the flashcard form is clean.
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
