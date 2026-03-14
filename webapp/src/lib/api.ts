const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID;

function getAuthHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // Dev mode: always send X-User-Id from env
  if (DEV_USER_ID) {
    headers["X-User-Id"] = DEV_USER_ID;
    return headers;
  }
  const token = localStorage.getItem("stoa_token");
  const userId = localStorage.getItem("stoa_user_id");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  else if (userId) headers["X-User-Id"] = userId;
  return headers;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function ingestUrl(data: {
  url: string;
  type?: string;
  tags?: string[];
  person_ids?: string[];
  collection_id?: string;
}) {
  return apiFetch("/ingest", { method: "POST", body: JSON.stringify(data) });
}

export async function ingestArxiv(arxivId: string) {
  return apiFetch(`/ingest/arxiv/${arxivId}`, { method: "POST" });
}

export async function ingestPdf(file: File, title?: string) {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);

  const h: Record<string, string> = {};
  if (DEV_USER_ID) h["X-User-Id"] = DEV_USER_ID;
  else {
    const token = localStorage.getItem("stoa_token");
    const userId = localStorage.getItem("stoa_user_id");
    if (token) h["Authorization"] = `Bearer ${token}`;
    else if (userId) h["X-User-Id"] = userId;
  }

  const res = await fetch(`${API_URL}/ingest/pdf`, {
    method: "POST",
    headers: h,
    body: formData,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<{ item: unknown; chunks_created: number; citation: unknown }>;
}

/**
 * Derive an embeddable PDF URL from an item's URL.
 * Returns null if no PDF can be derived.
 */
export function getPdfEmbedUrl(item: { url?: string; metadata?: Record<string, unknown> }): string | null {
  // Check for stored PDF path in metadata
  const storagePath = item.metadata?.pdf_storage_path as string | undefined;
  if (storagePath) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (supabaseUrl) {
      return `${supabaseUrl}/storage/v1/object/public/documents/${storagePath}`;
    }
  }

  const url = item.url;
  if (!url) return null;

  // Direct PDF link
  if (url.endsWith(".pdf")) return url;

  // arXiv: abs → pdf
  const arxivAbs = url.match(/arxiv\.org\/abs\/([^\s?#]+)/);
  if (arxivAbs) return `https://arxiv.org/pdf/${arxivAbs[1]}.pdf`;

  // arXiv: already a pdf link
  if (url.includes("arxiv.org/pdf/")) return url;

  // OpenReview: forum → pdf
  const orMatch = url.match(/openreview\.net\/forum\?id=([^\s&#]+)/);
  if (orMatch) return `https://openreview.net/pdf?id=${orMatch[1]}`;

  return null;
}

export async function search(data: {
  query: string;
  type?: string;
  tags?: string[];
  limit?: number;
}) {
  return apiFetch<{ results: unknown[]; count: number }>("/search", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function ragQuery(question: string) {
  return apiFetch<{ answer: string; sources: unknown[] }>("/rag/query", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

export async function exportBibtex(itemId: string) {
  return apiFetch<{ bibtex: string }>(`/citations/${itemId}/bib`);
}

export async function importBibtex(bibtex: string) {
  return apiFetch("/citations/import", {
    method: "POST",
    body: JSON.stringify({ bibtex }),
  });
}

export async function getNextReviews(limit = 5) {
  return apiFetch<{ reviews: unknown[] }>(`/review/next?limit=${limit}`, {
    method: "POST",
  });
}

export async function respondToReview(reviewId: string, quality: number) {
  return apiFetch("/review/respond", {
    method: "POST",
    body: JSON.stringify({ review_id: reviewId, quality }),
  });
}

export async function getItem(itemId: string) {
  return apiFetch<{
    item: unknown;
    highlights: unknown[];
    notes: unknown[];
    citation: unknown | null;
    related: unknown[];
  }>(`/items/${itemId}`);
}

export async function updateItem(itemId: string, updates: Record<string, unknown>) {
  return apiFetch<{ item: unknown }>(`/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function createNote(data: {
  item_id?: string;
  person_id?: string;
  content: string;
}) {
  return apiFetch<{ note: unknown }>("/notes", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateHighlight(
  highlightId: string,
  updates: Record<string, unknown>
) {
  return apiFetch(`/highlights/${highlightId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function createPerson(data: {
  name: string;
  affiliation?: string;
  role?: string;
  website_url?: string;
  twitter_handle?: string;
  notes?: string;
}) {
  return apiFetch<{ person: unknown }>("/people", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getPerson(personId: string) {
  return apiFetch<{ person: unknown; items: unknown[] }>(`/people/${personId}`);
}

export async function getAuthors() {
  return apiFetch<{ authors: (unknown & { paper_count: number })[] }>("/people/authors");
}

export async function updatePerson(personId: string, updates: Record<string, unknown>) {
  return apiFetch<{ person: unknown }>(`/people/${personId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function ingestPaste(data: {
  content: string;
  title?: string;
  type?: string;
  tags?: string[];
}) {
  return apiFetch("/ingest/paste", { method: "POST", body: JSON.stringify(data) });
}

export async function ingestImage(file: File, title?: string, type?: string) {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);
  if (type) formData.append("type", type);

  const h: Record<string, string> = {};
  if (DEV_USER_ID) h["X-User-Id"] = DEV_USER_ID;
  else {
    const token = localStorage.getItem("stoa_token");
    const userId = localStorage.getItem("stoa_user_id");
    if (token) h["Authorization"] = `Bearer ${token}`;
    else if (userId) h["X-User-Id"] = userId;
  }

  const res = await fetch(`${API_URL}/ingest/image`, {
    method: "POST",
    headers: h,
    body: formData,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<{ items: unknown[]; extracted_count: number }>;
}

export async function getItemTags(itemId: string) {
  return apiFetch<{ tags: string[] }>(`/items/${itemId}/tags`);
}

export async function setItemTags(itemId: string, tags: string[]) {
  return apiFetch<{ tags: string[] }>(`/items/${itemId}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tags }),
  });
}

export async function createHighlight(data: {
  item_id: string;
  text: string;
  context?: string;
  color?: string;
  note?: string;
}) {
  return apiFetch<{ highlight: unknown }>("/highlights", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteNote(noteId: string) {
  return apiFetch(`/notes/${noteId}`, { method: "DELETE" });
}

export async function deleteHighlight(highlightId: string) {
  return apiFetch(`/highlights/${highlightId}`, { method: "DELETE" });
}

export async function deleteItem(itemId: string) {
  return apiFetch(`/items/${itemId}`, { method: "DELETE" });
}

export async function deletePerson(personId: string) {
  return apiFetch(`/people/${personId}`, { method: "DELETE" });
}

export async function syncApplePodcasts() {
  return apiFetch<{
    synced: number;
    skipped: number;
    total_played: number;
    items: { id: string; title: string; domain: string }[];
  }>("/ingest/podcasts/sync", { method: "POST" });
}

export async function extractMetadata(url: string) {
  return apiFetch<{
    title: string;
    author: string;
    domain: string;
    favicon_url: string;
  }>("/ingest/metadata", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}
