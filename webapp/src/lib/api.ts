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
export function getPdfEmbedUrl(item: { id?: string; url?: string; metadata?: Record<string, unknown> }): string | null {
  // For uploaded PDFs: serve through backend (correct Content-Type)
  const storagePath = item.metadata?.pdf_storage_path as string | undefined;
  if (storagePath && item.id) {
    const uid = DEV_USER_ID || localStorage.getItem("stoa_user_id") || "";
    return `${API_URL}/items/${item.id}/pdf?user_id=${uid}`;
  }

  const url = item.url;
  if (!url) return null;

  // Derive the raw PDF URL
  let pdfUrl: string | null = null;

  if (url.endsWith(".pdf")) pdfUrl = url;

  // arXiv: abs → pdf
  const arxivAbs = url.match(/arxiv\.org\/abs\/([^\s?#]+)/);
  if (arxivAbs) pdfUrl = `https://arxiv.org/pdf/${arxivAbs[1]}.pdf`;

  // arXiv: already a pdf link
  if (url.includes("arxiv.org/pdf/")) pdfUrl = url;

  // OpenReview: forum → pdf
  const orMatch = url.match(/openreview\.net\/forum\?id=([^\s&#]+)/);
  if (orMatch) pdfUrl = `https://openreview.net/pdf?id=${orMatch[1]}`;

  if (!pdfUrl) return null;

  // Proxy all external PDFs through the backend to avoid CORS issues
  const uid = DEV_USER_ID || localStorage.getItem("stoa_user_id") || "";
  return `${API_URL}/proxy/pdf?url=${encodeURIComponent(pdfUrl)}&user_id=${uid}`;
}

/**
 * Get ar5iv HTML URL for arXiv papers (LaTeX→HTML compilation with equations, figures).
 * Returns null for non-arXiv papers.
 */
export function getAr5ivUrl(item: { url?: string }): string | null {
  const url = item.url;
  if (!url) return null;
  const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  if (arxivMatch) return `https://ar5iv.labs.arxiv.org/html/${arxivMatch[1]}`;
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

export async function exportApa(itemId: string) {
  return apiFetch<{ apa: string }>(`/citations/${itemId}/apa`);
}

export async function exportMla(itemId: string) {
  return apiFetch<{ mla: string }>(`/citations/${itemId}/mla`);
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
  title?: string;
  tags?: string[];
  evergreen?: boolean;
  anchor_selectors?: Record<string, unknown> | null;
  anchored_highlight_ids?: string[];
  draft_id?: string;
}) {
  return apiFetch<{ note: unknown }>("/notes", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getNotes(params?: { person_id?: string; item_id?: string }) {
  const query = new URLSearchParams();
  if (params?.person_id) query.set("person_id", params.person_id);
  if (params?.item_id) query.set("item_id", params.item_id);
  const qs = query.toString();
  return apiFetch<{ notes: unknown[] }>(`/notes${qs ? `?${qs}` : ""}`);
}

export async function updateNote(noteId: string, updates: Record<string, unknown>) {
  return apiFetch<{ note: unknown }>(`/notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
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

export async function getStandaloneNotes(limit = 5) {
  return apiFetch<{ notes: unknown[] }>(`/notes/standalone?limit=${limit}`);
}

export async function appendToNote(noteId: string, content: string) {
  return apiFetch<{ note: unknown }>(`/notes/${noteId}/append`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
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

export async function listCollections() {
  return apiFetch<{
    collections: { id: string; name: string; description?: string }[];
  }>("/items/collections");
}

export async function getPapersByTopic() {
  return apiFetch<{
    groups: Record<string, { papers: unknown[]; count: number }>;
    total: number;
  }>("/items/papers/by-topic");
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

export async function createCollection(data: { name: string; description?: string }) {
  return apiFetch<{ collection: unknown }>("/items/collections", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function renameCollection(collectionId: string, name: string) {
  return apiFetch(`/items/collections/${collectionId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function deleteCollection(collectionId: string) {
  return apiFetch(`/items/collections/${collectionId}`, { method: "DELETE" });
}

export async function addItemToCollection(collectionId: string, itemId: string) {
  return apiFetch(`/items/collections/${collectionId}/items`, {
    method: "POST",
    body: JSON.stringify({ item_id: itemId }),
  });
}

export async function getCollectionItems(collectionId: string) {
  return apiFetch<{ items: unknown[] }>(`/items/collections/${collectionId}/items`);
}

export async function getCollectionItemCount(collectionId: string) {
  return apiFetch<{ count: number }>(`/items/collections/${collectionId}/count`);
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  color?: string;
  created_at: string;
  updated_at: string;
  item_count?: number;
}

export interface Folder {
  id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  path: string;
  sort_order: number;
  created_at: string;
  item_count?: number;
  children?: Folder[];
}

export interface FolderItem {
  id: string;
  title: string;
  url?: string;
  type: string;
  domain?: string;
  favicon_url?: string;
  cover_image_url?: string;
  reading_status: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  sort_order: number;
  added_at: string;
}

export async function listProjects() {
  return apiFetch<{ projects: Project[] }>("/projects");
}

export async function createProject(data: {
  name: string;
  description?: string;
  color?: string;
}) {
  return apiFetch<{ project: Project }>("/projects", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getProject(projectId: string) {
  return apiFetch<{ project: Project }>(`/projects/${projectId}`);
}

export async function updateProject(
  projectId: string,
  data: { name?: string; description?: string; color?: string }
) {
  return apiFetch<{ project: Project }>(`/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteProject(projectId: string) {
  return apiFetch(`/projects/${projectId}`, { method: "DELETE" });
}

export async function getFolderTree(projectId: string) {
  return apiFetch<{ tree: Folder[] }>(`/projects/${projectId}/tree`);
}

export async function listFolders(projectId: string, parentFolderId?: string | null) {
  const qs =
    parentFolderId !== undefined
      ? `?parent_folder_id=${parentFolderId ?? "root"}`
      : "";
  return apiFetch<{ folders: Folder[] }>(`/projects/${projectId}/folders${qs}`);
}

export async function createFolder(
  projectId: string,
  data: { name: string; parent_folder_id?: string | null; sort_order?: number }
) {
  return apiFetch<{ folder: Folder }>(`/projects/${projectId}/folders`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateFolder(
  projectId: string,
  folderId: string,
  data: { name?: string; sort_order?: number }
) {
  return apiFetch<{ folder: Folder }>(`/projects/${projectId}/folders/${folderId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function moveFolder(
  projectId: string,
  folderId: string,
  newParentFolderId: string | null
) {
  return apiFetch<{ folder: Folder }>(
    `/projects/${projectId}/folders/${folderId}/move`,
    {
      method: "POST",
      body: JSON.stringify({ new_parent_folder_id: newParentFolderId }),
    }
  );
}

export async function deleteFolder(projectId: string, folderId: string) {
  return apiFetch(`/projects/${projectId}/folders/${folderId}`, {
    method: "DELETE",
  });
}

export async function listFolderItems(projectId: string, folderId: string) {
  return apiFetch<{ items: FolderItem[] }>(
    `/projects/${projectId}/folders/${folderId}/items`
  );
}

export async function addItemToFolder(
  projectId: string,
  folderId: string,
  itemId: string,
  sortOrder?: number
) {
  return apiFetch(`/projects/${projectId}/folders/${folderId}/items`, {
    method: "POST",
    body: JSON.stringify({ item_id: itemId, sort_order: sortOrder }),
  });
}

export async function removeItemFromFolder(
  projectId: string,
  folderId: string,
  itemId: string
) {
  return apiFetch(
    `/projects/${projectId}/folders/${folderId}/items/${itemId}`,
    { method: "DELETE" }
  );
}

export async function moveItemToFolder(
  projectId: string,
  itemId: string,
  sourceFolderId: string,
  targetFolderId: string,
  sortOrder?: number
) {
  return apiFetch(`/projects/${projectId}/items/${itemId}/move`, {
    method: "POST",
    body: JSON.stringify({
      source_folder_id: sourceFolderId,
      target_folder_id: targetFolderId,
      sort_order: sortOrder,
    }),
  });
}

export async function resolveProjectPath(projectId: string, path: string) {
  return apiFetch<{ folder: Folder }>(
    `/projects/${projectId}/resolve?path=${encodeURIComponent(path)}`
  );
}


// ---------------------------------------------------------------------------
// Multi-content ingest endpoints
// ---------------------------------------------------------------------------

export async function ingestGdoc(url: string, tags: string[] = []) {
  return apiFetch<{ item: import("./supabase").Item; item_id: string; already_exists: boolean }>(
    "/ingest/gdoc",
    { method: "POST", body: JSON.stringify({ url, tags }) }
  );
}

export async function ingestEmail(threadId: string, tags: string[] = []) {
  return apiFetch<{ item: import("./supabase").Item; item_id: string; already_exists: boolean }>(
    "/ingest/email",
    { method: "POST", body: JSON.stringify({ thread_id: threadId, tags }) }
  );
}

export async function ingestGithub(url: string, tags: string[] = []) {
  return apiFetch<{ item: import("./supabase").Item; item_id: string; already_exists: boolean }>(
    "/ingest/github",
    { method: "POST", body: JSON.stringify({ url, tags }) }
  );
}

export async function ingestResearchImage(file: File, tags: string[] = []) {
  const form = new FormData();
  form.append("file", file);
  if (tags.length) form.append("tags", tags.join(","));
  // Use raw fetch — FormData can't go through apiFetch's JSON serialisation
  const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
  const userId = localStorage.getItem("stoa_user_id") ?? "";
  const resp = await fetch(`${API_BASE}/ingest/research-image`, {
    method: "POST",
    headers: { "X-User-Id": userId },
    body: form,
  });
  if (!resp.ok) throw new Error(`Image upload failed: ${resp.status}`);
  return resp.json() as Promise<{ item: import("./supabase").Item; item_id: string; image_url: string; width: number; height: number; ocr_text: string }>;
}

// ─── note_links (evergreen cross-linking) ────────────────────────────────────

export interface NoteLinkRow {
  source_note_id: string;
  target_ref_type: "note" | "item" | "person" | "folder";
  target_ref_id: string;
  mention_offset?: number;
  created_at: string;
  target_title?: string | null;
  source_title?: string | null;
}

export async function getNoteLinks(noteId: string) {
  return apiFetch<{ outgoing: NoteLinkRow[]; incoming: NoteLinkRow[] }>(
    `/notes/${noteId}/links`,
  );
}

export async function createNoteLink(
  noteId: string,
  data: {
    target_ref_type: "note" | "item" | "person" | "folder";
    target_ref_id: string;
    mention_offset?: number;
  },
) {
  return apiFetch<{ link: NoteLinkRow }>(`/notes/${noteId}/links`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteNoteLink(
  noteId: string,
  targetRefType: string,
  targetRefId: string,
) {
  return apiFetch(`/notes/${noteId}/links/${targetRefType}/${targetRefId}`, {
    method: "DELETE",
  });
}
