const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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
  user_id: string;
  type?: string;
  tags?: string[];
  person_ids?: string[];
  collection_id?: string;
}) {
  return apiFetch("/ingest", { method: "POST", body: JSON.stringify(data) });
}

export async function ingestArxiv(arxivId: string, userId: string) {
  return apiFetch(`/ingest/arxiv/${arxivId}?user_id=${userId}`, {
    method: "POST",
  });
}

export async function search(data: {
  query: string;
  user_id: string;
  type?: string;
  tags?: string[];
  limit?: number;
}) {
  return apiFetch<{ results: unknown[]; count: number }>("/search", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function ragQuery(question: string, userId: string) {
  return apiFetch<{ answer: string; sources: unknown[] }>("/rag/query", {
    method: "POST",
    body: JSON.stringify({ question, user_id: userId }),
  });
}

export async function exportBibtex(itemId: string) {
  return apiFetch<{ bibtex: string }>(`/citations/${itemId}/bib`);
}

export async function importBibtex(bibtex: string, userId: string) {
  return apiFetch("/citations/import", {
    method: "POST",
    body: JSON.stringify({ bibtex, user_id: userId }),
  });
}

export async function getNextReviews(userId: string, limit = 5) {
  return apiFetch<{ reviews: unknown[] }>(
    `/review/next?user_id=${userId}&limit=${limit}`,
    { method: "POST" }
  );
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
