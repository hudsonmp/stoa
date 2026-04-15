/**
 * Role-2 test suite for lib/anki.ts — AnkiConnect envelope handling.
 *
 * These tests cover the pure request/response shape. AnkiConnect itself is
 * mocked at the fetch boundary; we're not validating Anki Desktop behavior.
 *
 * Maps to EDITOR_SPEC.md section G (Flashcard editor) items G3–G6.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ankiPing,
  ensureDeck,
  addAnkiNote,
  updateAnkiNoteFields,
  syncCardToAnki,
} from "../anki";

// Typed envelope helpers for clarity.
function ok(result: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ result, error: null }),
  } as unknown as Response);
}
function errEnvelope(error: string) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ result: null, error }),
  } as unknown as Response);
}
function httpFail(status = 500) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as unknown as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ankiPing", () => {
  it("returns true when version >= 6", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => ok(6));
    expect(await ankiPing()).toBe(true);
  });

  it("returns false when Anki unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.reject(new Error("connection refused"))
    );
    expect(await ankiPing()).toBe(false);
  });
});

describe("ensureDeck", () => {
  it("does nothing if deck already exists", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => ok(["Default", "42"]));
    const res = await ensureDeck("42");
    expect(res.ok).toBe(true);
    // Only one call — deckNames; createDeck skipped.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("creates the deck when missing", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => ok(["Default"])) // deckNames
      .mockImplementationOnce(() => ok(1234567890)); // createDeck
    const res = await ensureDeck("42");
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const createBody = JSON.parse(
      (fetchSpy.mock.calls[1][1] as RequestInit).body as string
    );
    expect(createBody.action).toBe("createDeck");
    expect(createBody.params).toEqual({ deck: "42" });
  });

  it("surfaces the envelope error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      errEnvelope("deck name unavailable")
    );
    const res = await ensureDeck("42");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("deck name unavailable");
  });
});

describe("addAnkiNote", () => {
  it("posts addNote with Basic model and both fields", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => ok(42424242));
    const res = await addAnkiNote({
      deckName: "42",
      front: "Front text",
      back: "Back text",
      tags: ["stoa", "hamming"],
    });
    expect(res).toEqual({ ok: true, value: 42424242 });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.action).toBe("addNote");
    expect(body.params.note.deckName).toBe("42");
    expect(body.params.note.modelName).toBe("Basic");
    expect(body.params.note.fields).toEqual({
      Front: "Front text",
      Back: "Back text",
    });
    expect(body.params.note.tags).toEqual(["stoa", "hamming"]);
  });

  it("returns a CORS-ish error when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      Promise.reject(new TypeError("Failed to fetch"))
    );
    const res = await addAnkiNote({ deckName: "42", front: "a", back: "b" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Anki Desktop|Failed to fetch/);
  });
});

describe("updateAnkiNoteFields", () => {
  it("posts updateNoteFields with the existing note id", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => ok(null));
    const res = await updateAnkiNoteFields(987654, "new front", "new back");
    expect(res.ok).toBe(true);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.action).toBe("updateNoteFields");
    expect(body.params.note.id).toBe(987654);
    expect(body.params.note.fields).toEqual({ Front: "new front", Back: "new back" });
  });
});

describe("syncCardToAnki", () => {
  it("creates a new note when no existing id", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => ok(["42"])) // deckNames
      .mockImplementationOnce(() => ok(777)); // addNote
    const res = await syncCardToAnki(
      { deckName: "42", front: "q", back: "a" },
      null
    );
    expect(res).toEqual({ ok: true, value: 777 });
    const lastBody = JSON.parse(
      (fetchSpy.mock.calls[1][1] as RequestInit).body as string
    );
    expect(lastBody.action).toBe("addNote");
  });

  it("updates in place when existing id supplied", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => ok(["42"])) // deckNames
      .mockImplementationOnce(() => ok(null)); // updateNoteFields
    const res = await syncCardToAnki(
      { deckName: "42", front: "q", back: "a" },
      555
    );
    expect(res).toEqual({ ok: true, value: 555 });
    const lastBody = JSON.parse(
      (fetchSpy.mock.calls[1][1] as RequestInit).body as string
    );
    expect(lastBody.action).toBe("updateNoteFields");
  });

  it("falls back to addNote when existing id was deleted in Anki", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => ok(["42"])) // deckNames
      .mockImplementationOnce(() => errEnvelope("note was not found: 555")) // update fails
      .mockImplementationOnce(() => ok(999)); // addNote
    const res = await syncCardToAnki(
      { deckName: "42", front: "q", back: "a" },
      555
    );
    expect(res).toEqual({ ok: true, value: 999 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("propagates non-missing update errors", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => ok(["42"])) // deckNames
      .mockImplementationOnce(() => errEnvelope("collection is locked"));
    const res = await syncCardToAnki(
      { deckName: "42", front: "q", back: "a" },
      555
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("collection is locked");
  });

  it("bubbles HTTP failures as transport errors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => httpFail(502));
    const res = await syncCardToAnki(
      { deckName: "42", front: "q", back: "a" },
      null
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("502");
  });
});
