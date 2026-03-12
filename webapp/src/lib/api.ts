const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("stoa_token");
  const userId = localStorage.getItem("stoa_user_id");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
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
