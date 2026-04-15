/**
 * AnkiConnect client — talks to the local Anki Desktop add-on over HTTP.
 *
 * Requirements:
 *  1. Anki Desktop running on the user's machine.
 *  2. AnkiConnect add-on installed (addon code 2055492159).
 *  3. Default config whitelists `http://localhost` (Vite dev server) and 127.0.0.1.
 *
 * Why browser-direct and not a backend proxy: AnkiConnect runs on the user's
 * machine. A deployed backend (Railway) cannot reach 127.0.0.1:8765 on the
 * user's laptop. Browser-direct sidesteps the tunnel problem and matches how
 * every other AnkiConnect integration (Obsidian, ReMNote, Supermemo) handles it.
 */

const ANKI_HOST = "http://127.0.0.1:8765";
const ANKI_VERSION = 6;

export type AnkiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

interface AnkiEnvelope<T> {
  result: T | null;
  error: string | null;
}

async function invoke<T>(action: string, params: object = {}): Promise<AnkiResult<T>> {
  try {
    const res = await fetch(ANKI_HOST, {
      method: "POST",
      body: JSON.stringify({ action, version: ANKI_VERSION, params }),
    });
    if (!res.ok) {
      return { ok: false, error: `Anki responded ${res.status}` };
    }
    const data = (await res.json()) as AnkiEnvelope<T>;
    if (data.error) return { ok: false, error: data.error };
    return { ok: true, value: data.result as T };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Anki unreachable";
    // Most common failure: Anki desktop isn't running, or AnkiConnect missing.
    return {
      ok: false,
      error: `${msg} — is Anki Desktop running with the AnkiConnect add-on?`,
    };
  }
}

export async function ankiPing(): Promise<boolean> {
  const res = await invoke<number>("version");
  return res.ok && typeof res.value === "number" && res.value >= ANKI_VERSION;
}

export async function ensureDeck(deckName: string): Promise<AnkiResult<null>> {
  const decks = await invoke<string[]>("deckNames");
  if (!decks.ok) return decks;
  if (decks.value.includes(deckName)) return { ok: true, value: null };
  const created = await invoke<number>("createDeck", { deck: deckName });
  if (!created.ok) return created;
  return { ok: true, value: null };
}

export interface AnkiCardPayload {
  deckName: string;
  front: string;
  back: string;
  /** Tags to attach in Anki (e.g. ["stoa","hamming"]) */
  tags?: string[];
  /** Anki model/note-type. "Basic" exists in every profile. */
  modelName?: string;
}

export async function addAnkiNote(
  card: AnkiCardPayload
): Promise<AnkiResult<number>> {
  const modelName = card.modelName || "Basic";
  return invoke<number>("addNote", {
    note: {
      deckName: card.deckName,
      modelName,
      fields: {
        Front: card.front,
        Back: card.back,
      },
      options: {
        // Allow duplicates across decks but warn within this deck.
        allowDuplicate: false,
        duplicateScope: "deck",
      },
      tags: card.tags || ["stoa"],
    },
  });
}

export async function updateAnkiNoteFields(
  ankiNoteId: number,
  front: string,
  back: string
): Promise<AnkiResult<null>> {
  return invoke<null>("updateNoteFields", {
    note: {
      id: ankiNoteId,
      fields: {
        Front: front,
        Back: back,
      },
    },
  });
}

/**
 * Convenience: ensure deck exists, then add-or-update the note.
 * If `existingAnkiId` is provided, update-in-place; otherwise create a new one.
 */
export async function syncCardToAnki(
  card: AnkiCardPayload,
  existingAnkiId: number | null
): Promise<AnkiResult<number>> {
  const deck = await ensureDeck(card.deckName);
  if (!deck.ok) return deck;
  if (existingAnkiId != null) {
    const upd = await updateAnkiNoteFields(existingAnkiId, card.front, card.back);
    if (!upd.ok) {
      // Note was deleted in Anki — fall through to re-add.
      if (upd.error.toLowerCase().includes("note was not found")) {
        return addAnkiNote(card);
      }
      return upd;
    }
    return { ok: true, value: existingAnkiId };
  }
  return addAnkiNote(card);
}
