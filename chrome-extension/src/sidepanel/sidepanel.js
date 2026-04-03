/**
 * Stoa Side Panel
 * Runs in extension context — no CSP restrictions, full chrome.* API access.
 * Communicates with content script via chrome.tabs.sendMessage.
 */

// --- State ---
let stoaApiUrl = "http://localhost:8000";
let currentUser = null;
let authToken = null;
let activeTabId = null;
let currentItemId = null;
let currentItemCollectionIds = [];
let currentItemPersonIds = [];
let currentNoteId = null;
let lastSavedNoteContent = "";
let noteAutoSaveTimer = null;
let pageInfo = null; // { url, title, hostname, isPdf }

// --- DOM refs ---
const $ = (id) => document.getElementById(id);

// --- Auth ---
function getAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  else if (currentUser) headers["X-User-Id"] = currentUser;
  return headers;
}

// Side panel runs in extension context — direct fetch always works
async function apiFetch(path, options = {}) {
  const resp = await fetch(`${stoaApiUrl}${path}`, options);
  return resp;
}

function normalizeUrlForLookup(url) {
  const arxivPdf = url.match(/arxiv\.org\/pdf\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  if (arxivPdf) return `https://arxiv.org/abs/${arxivPdf[1]}`;
  const arxivHtml = url.match(/arxiv\.org\/html\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  if (arxivHtml) return `https://arxiv.org/abs/${arxivHtml[1]}`;
  return url;
}

function guessContentType(hostname) {
  if (!hostname) return "blog";
  if (hostname.includes("arxiv.org")) return "paper";
  if (hostname.includes("youtube.com")) return "video";
  if (hostname.includes("twitter.com") || hostname.includes("x.com")) return "tweet";
  return "blog";
}

// --- Send message to content script in active tab ---
async function sendToContentScript(message) {
  if (!activeTabId) return null;
  try {
    return await chrome.tabs.sendMessage(activeTabId, message);
  } catch (e) {
    console.warn("[Stoa SP] Content script not reachable:", e.message);
    return null;
  }
}

// --- Init ---
async function initSidePanel() {
  try {
  // Load config
  const stored = await chrome.storage.local.get(["stoa_user_id", "stoa_api_url", "stoa_token"]);
  currentUser = stored.stoa_user_id || "5f067d11-b2b8-4efe-84c7-5ac9c5602c9a";
  authToken = stored.stoa_token || null;
  if (stored.stoa_api_url) stoaApiUrl = stored.stoa_api_url;

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { console.error("[Stoa SP] No active tab"); return; }
  activeTabId = tab.id;

  // Get page info from content script
  pageInfo = await sendToContentScript({ type: "GET_PAGE_INFO" });
  if (!pageInfo) {
    // Fallback: use tab info directly
    let hostname = "";
    try { hostname = new URL(tab.url || "").hostname; } catch (e) {}
    pageInfo = { url: tab.url || "", title: tab.title || "", hostname, isPdf: (tab.url || "").endsWith(".pdf") };
  }

  // Populate source bar
  const sourceTitle = (pageInfo.title || pageInfo.hostname || "").substring(0, 60);
  $("source-title").textContent = sourceTitle;
  $("source-title").title = pageInfo.title || "";

  // Show PDF button if needed
  if (pageInfo.isPdf) {
    $("pdf-open-stoa").style.display = "block";
  }

  // Set type from detection
  const detectedType = guessContentType(pageInfo.hostname);
  $("type-select").value = detectedType === "blog" ? "essay" : detectedType;

  // Resolve item ID
  await resolveCurrentItemId();

  // Update save button state
  updateSaveButtonState();

  // Load collections, people, notes, highlights in parallel
  await Promise.all([
    loadCollections(),
    loadPeople(),
    loadOrCreateSourceNote(),
    loadHighlights(),
  ]);

  // Pre-select dropdowns from item data
  if (currentItemCollectionIds.length > 0) {
    $("collection-select").value = currentItemCollectionIds[0];
  }
  if (currentItemPersonIds.length > 0) {
    $("person-select").value = currentItemPersonIds[0];
  } else {
    // Try domain-based person cache
    const domain = pageInfo.hostname?.replace("www.", "");
    const domainPersonKey = `domain-person:${domain}`;
    const cached = await chrome.storage.local.get(domainPersonKey);
    if (cached[domainPersonKey]) {
      $("person-select").value = cached[domainPersonKey];
    }
  }

  // Wire up UI
  setupEventListeners();

  // Auto-save notepad every 5 seconds
  noteAutoSaveTimer = setInterval(autoSaveNotepad, 5000);

  } catch (e) {
    console.error("[Stoa SP] Init failed:", e);
    $("source-title").textContent = "Error: " + e.message;
  }
}

// Run init — works whether DOM is already loaded or not
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSidePanel);
} else {
  initSidePanel();
}

// --- Resolve item ID ---
async function resolveCurrentItemId() {
  if (!pageInfo?.url) return;
  const lookupUrl = normalizeUrlForLookup(pageInfo.url);
  try {
    let resp = await apiFetch(`/items/by-url?url=${encodeURIComponent(lookupUrl)}`, { headers: getAuthHeaders() });
    if (!resp.ok && lookupUrl !== pageInfo.url) {
      resp = await apiFetch(`/items/by-url?url=${encodeURIComponent(pageInfo.url)}`, { headers: getAuthHeaders() });
    }
    if (resp.ok) {
      const data = await resp.json();
      currentItemId = data.item?.id || null;
      currentItemCollectionIds = data.item?.collection_ids || [];
      currentItemPersonIds = data.item?.person_ids || [];
    }
  } catch (e) {
    // Item doesn't exist yet
  }
}

// --- Ensure page saved ---
async function ensurePageSaved() {
  if (currentItemId) return;
  const lookupUrl = normalizeUrlForLookup(pageInfo.url);
  try {
    let checkResp = await apiFetch(`/items/by-url?url=${encodeURIComponent(lookupUrl)}`, { headers: getAuthHeaders() });
    if (!checkResp.ok && lookupUrl !== pageInfo.url) {
      checkResp = await apiFetch(`/items/by-url?url=${encodeURIComponent(pageInfo.url)}`, { headers: getAuthHeaders() });
    }
    if (checkResp.ok) {
      const checkData = await checkResp.json();
      if (checkData.item?.id) { currentItemId = checkData.item.id; return; }
    }
  } catch (e) { /* not found, will ingest */ }

  try {
    const resp = await apiFetch("/ingest", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ url: lookupUrl, type: guessContentType(pageInfo.hostname) }),
    });
    if (resp.ok) {
      const data = await resp.json();
      currentItemId = data.item?.id || null;
    }
  } catch (e) {
    console.error("[Stoa SP] Failed to auto-save page:", e);
  }
}

function updateSaveButtonState() {
  const btn = $("save-btn");
  btn.textContent = currentItemId ? "Saved \u2014 Update" : "Save Page";
  btn.disabled = false;
}

// --- Load collections ---
async function loadCollections() {
  try {
    const resp = await apiFetch("/items/collections", { headers: getAuthHeaders() });
    if (!resp.ok) return;
    const data = await resp.json();
    const select = $("collection-select");
    (data.collections || []).forEach((col) => {
      const opt = document.createElement("option");
      opt.value = col.id;
      opt.textContent = col.name;
      select.appendChild(opt);
    });
  } catch (e) { /* offline */ }
}

// --- Load people ---
async function loadPeople() {
  try {
    const resp = await apiFetch("/people", { headers: getAuthHeaders() });
    if (!resp.ok) return;
    const data = await resp.json();
    const select = $("person-select");
    (data.people || []).forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
  } catch (e) { /* offline */ }
}

// --- Notes ---
async function loadOrCreateSourceNote() {
  const notepad = $("notepad");
  const backupKey = `note-backup:${pageInfo.url}`;

  if (currentItemId) {
    try {
      const resp = await apiFetch(`/notes?item_id=${currentItemId}`, { headers: getAuthHeaders() });
      if (resp.ok) {
        const data = await resp.json();
        const notes = data.notes || [];
        const sourceNote = notes.find(n => (n.tags || []).includes("source-note")) || notes[0];
        if (sourceNote) {
          currentNoteId = sourceNote.id;
          let content = sourceNote.content || "";
          if (!content.replace(/<[^>]*>/g, "").trim()) {
            const backup = await chrome.storage.local.get(backupKey);
            if (backup[backupKey]?.replace(/<[^>]*>/g, "").trim()) {
              content = backup[backupKey];
              apiFetch(`/notes/${currentNoteId}`, {
                method: "PATCH", headers: getAuthHeaders(),
                body: JSON.stringify({ content }),
              }).catch(() => {});
            }
          }
          notepad.innerHTML = content;
          lastSavedNoteContent = notepad.innerHTML;
          return;
        }
      }
    } catch (e) {
      const backup = await chrome.storage.local.get(backupKey);
      if (backup[backupKey]) {
        notepad.innerHTML = backup[backupKey];
        lastSavedNoteContent = notepad.innerHTML;
        return;
      }
    }
  }

  // Check chrome.storage by URL
  const storageKey = `note:${pageInfo.url}`;
  const stored = await chrome.storage.local.get(storageKey);
  if (stored[storageKey]?.noteId) {
    currentNoteId = stored[storageKey].noteId;
    try {
      const resp = await apiFetch(`/notes/${currentNoteId}`, { headers: getAuthHeaders() });
      if (resp.ok) {
        const data = await resp.json();
        const note = data.note || data;
        notepad.innerHTML = note.content || "";
        lastSavedNoteContent = notepad.innerHTML;
        return;
      }
    } catch (e) { /* note deleted */ }
  }

  // Check for local backup
  const backup = await chrome.storage.local.get(backupKey);
  const initialContent = backup[backupKey] || "";

  // Create new note
  if (!currentItemId) await ensurePageSaved();
  try {
    const resp = await apiFetch("/notes", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        item_id: currentItemId,
        title: `Notes: ${pageInfo.title || pageInfo.url}`,
        content: initialContent,
        tags: ["source-note"],
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      currentNoteId = data.note?.id || null;
      if (currentNoteId) {
        await chrome.storage.local.set({ [storageKey]: { noteId: currentNoteId } });
      }
      notepad.innerHTML = initialContent;
      lastSavedNoteContent = notepad.innerHTML;
    }
  } catch (e) {
    console.error("[Stoa SP] Failed to create note:", e);
  }
}

async function autoSaveNotepad() {
  const notepad = $("notepad");
  const statusEl = $("save-status");
  const isPrivate = $("private-mode")?.checked;
  if (!notepad) return;

  const content = notepad.innerHTML;
  const normalizedContent = content.replace(/<br\s*\/?>/gi, "").replace(/<div><\/div>/gi, "").trim();
  const normalizedLast = lastSavedNoteContent.replace(/<br\s*\/?>/gi, "").replace(/<div><\/div>/gi, "").trim();
  if (normalizedContent === normalizedLast) return;

  // Always save locally as backup
  const localKey = `note-backup:${pageInfo.url}`;
  await chrome.storage.local.set({ [localKey]: content });

  if (isPrivate) {
    const key = `private-note:${pageInfo.url}`;
    await chrome.storage.local.set({ [key]: content });
    lastSavedNoteContent = content;
    if (statusEl) { statusEl.textContent = "Saved locally"; setTimeout(() => statusEl.textContent = "", 2000); }
    return;
  }

  if (!currentNoteId) {
    if (!currentItemId) await ensurePageSaved();
    await loadOrCreateSourceNote();
    if (!currentNoteId) {
      lastSavedNoteContent = content;
      if (statusEl) statusEl.textContent = "Saved locally";
      return;
    }
  }

  try {
    if (statusEl) statusEl.textContent = "Saving...";
    const resp = await apiFetch(`/notes/${currentNoteId}`, {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({ content }),
    });
    if (resp.ok) {
      lastSavedNoteContent = content;
      if (statusEl) { statusEl.textContent = "Saved"; setTimeout(() => statusEl.textContent = "", 2000); }
    } else {
      if (statusEl) statusEl.textContent = "Saved locally";
    }
  } catch (e) {
    console.error("[Stoa SP] Failed to auto-save note:", e);
    if (statusEl) statusEl.textContent = "Saved locally";
  }
}

// --- Highlights ---
async function loadHighlights() {
  const container = $("highlight-list");
  if (!pageInfo?.url) return;

  // Get from content script
  const csData = await sendToContentScript({ type: "GET_HIGHLIGHTS" });
  const highlights = csData?.highlights || [];

  // Also fetch from API
  const lookupUrl = normalizeUrlForLookup(pageInfo.url);
  try {
    const resp = await apiFetch(`/highlights?url=${encodeURIComponent(lookupUrl)}`, { headers: getAuthHeaders() });
    if (resp.ok) {
      const data = await resp.json();
      if (data.highlights?.length) {
        // Merge — use API as source of truth, content script has DOM refs
        const apiHighlights = data.highlights;
        const csIds = new Set(highlights.map(h => h.id));
        apiHighlights.forEach(h => {
          if (!csIds.has(h.id)) highlights.push(h);
        });
      }
    }
  } catch (e) { /* offline */ }

  renderHighlights(highlights, container);
}

function renderHighlights(highlights, container) {
  container.innerHTML = "";
  if (!highlights.length) {
    container.innerHTML = '<p class="sp-empty">Highlight text on the page to see it here.</p>';
    return;
  }

  const title = document.createElement("h3");
  title.className = "sp-section-title";
  title.textContent = `Highlights (${highlights.length})`;
  container.appendChild(title);

  highlights.forEach((h) => {
    const card = document.createElement("div");
    card.className = `sp-card sp-card-${h.color || "green"}`;

    const text = document.createElement("p");
    text.className = "sp-card-text";
    text.textContent = `"${(h.text || "").substring(0, 200)}${(h.text || "").length > 200 ? "..." : ""}"`;
    card.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "sp-card-actions";

    const jumpBtn = document.createElement("button");
    jumpBtn.className = "sp-card-jump";
    jumpBtn.textContent = "Jump";
    jumpBtn.addEventListener("click", () => {
      sendToContentScript({ type: "SCROLL_TO_HIGHLIGHT", payload: { highlightId: h.id } });
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "sp-card-remove";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      // Delete from API
      try {
        await apiFetch(`/highlights/${h.id}`, { method: "DELETE", headers: getAuthHeaders() });
      } catch (e) { /* already deleted */ }
      // Remove from page DOM
      sendToContentScript({ type: "REMOVE_HIGHLIGHT", payload: { highlightId: h.id } });
      card.remove();
    });

    actions.appendChild(jumpBtn);
    actions.appendChild(removeBtn);
    card.appendChild(actions);
    container.appendChild(card);
  });
}

// --- Event listeners ---
function setupEventListeners() {
  // Save button
  $("save-btn").addEventListener("click", async () => {
    const btn = $("save-btn");
    btn.textContent = "Saving...";
    btn.disabled = true;
    try {
      await ensurePageSaved();
      const promises = [];
      const collVal = $("collection-select").value;
      const personVal = $("person-select").value;

      if (currentItemId && collVal) {
        promises.push(
          apiFetch(`/items/collections/${collVal}/items`, {
            method: "POST", headers: getAuthHeaders(),
            body: JSON.stringify({ item_id: currentItemId }),
          }).then(() => { currentItemCollectionIds = [collVal]; }).catch(() => {})
        );
      }
      if (currentItemId && personVal) {
        promises.push(
          apiFetch(`/people/${personVal}/items`, {
            method: "POST", headers: getAuthHeaders(),
            body: JSON.stringify({ item_id: currentItemId, relation: "authored" }),
          }).then(() => { currentItemPersonIds = [personVal]; }).catch(() => {})
        );
      }
      if (currentItemId) {
        promises.push(
          apiFetch(`/items/${currentItemId}`, {
            method: "PATCH", headers: getAuthHeaders(),
            body: JSON.stringify({ type: $("type-select").value }),
          }).catch(() => {})
        );
      }
      await Promise.all(promises);
      btn.textContent = "Saved \u2713";
      if (personVal) {
        const domain = pageInfo.hostname?.replace("www.", "");
        await chrome.storage.local.set({ [`domain-person:${domain}`]: personVal });
      }
      setTimeout(() => { btn.textContent = "Saved \u2014 Update"; btn.disabled = false; }, 1500);
    } catch (e) {
      btn.textContent = "Failed";
      setTimeout(() => { updateSaveButtonState(); }, 2000);
    }
  });

  // New collection
  $("new-collection-btn").addEventListener("click", async () => {
    const input = $("new-collection-input");
    const btn = $("new-collection-btn");
    const name = input.value.trim();
    if (!name) return;
    btn.disabled = true;
    btn.textContent = "...";
    try {
      const resp = await apiFetch("/items/collections", {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({ name }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const col = data.collection;
        const opt = document.createElement("option");
        opt.value = col.id;
        opt.textContent = col.name;
        $("collection-select").appendChild(opt);
        $("collection-select").value = col.id;
        input.value = "";
        if (currentItemId) {
          apiFetch(`/items/collections/${col.id}/items`, {
            method: "POST", headers: getAuthHeaders(),
            body: JSON.stringify({ item_id: currentItemId }),
          }).catch(() => {});
        }
      }
      btn.textContent = "\u2713";
      setTimeout(() => { btn.textContent = "+"; btn.disabled = false; }, 1500);
    } catch (e) {
      btn.textContent = "!";
      setTimeout(() => { btn.textContent = "+"; btn.disabled = false; }, 2000);
    }
  });

  $("new-collection-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("new-collection-btn").click();
  });

  // New person
  $("new-person-btn").addEventListener("click", async () => {
    const input = $("new-person-input");
    const btn = $("new-person-btn");
    const name = input.value.trim();
    if (!name) return;
    btn.disabled = true;
    btn.textContent = "...";
    try {
      const resp = await apiFetch("/people", {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({ name, website_url: pageInfo.url, role: "intellectual hero" }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const person = data.person;
        const opt = document.createElement("option");
        opt.value = person.id;
        opt.textContent = person.name;
        $("person-select").appendChild(opt);
        $("person-select").value = person.id;
        input.value = "";
        if (currentItemId) {
          apiFetch(`/people/${person.id}/items`, {
            method: "POST", headers: getAuthHeaders(),
            body: JSON.stringify({ item_id: currentItemId, relation: "authored" }),
          }).catch(() => {});
        }
      }
      btn.textContent = "\u2713";
      setTimeout(() => { btn.textContent = "+"; btn.disabled = false; }, 1500);
    } catch (e) {
      btn.textContent = "!";
      setTimeout(() => { btn.textContent = "+"; btn.disabled = false; }, 2000);
    }
  });

  $("new-person-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("new-person-btn").click();
  });

  // Formatting
  $("fmt-bold").addEventListener("click", () => document.execCommand("bold"));
  $("fmt-italic").addEventListener("click", () => document.execCommand("italic"));
  $("fmt-list").addEventListener("click", () => document.execCommand("insertUnorderedList"));
  $("fmt-bookmark").addEventListener("click", () => {
    sendToContentScript({ type: "TOGGLE_BOOKMARK" });
  });

  // Private mode toggle
  $("private-mode").addEventListener("change", () => {
    $("private-icon").textContent = $("private-mode").checked ? "\uD83D\uDD12" : "\u2601\uFE0F";
  });

  // PDF open in Stoa
  $("pdf-open-stoa").addEventListener("click", async () => {
    const btn = $("pdf-open-stoa");
    btn.textContent = "Saving...";
    btn.disabled = true;
    try {
      await ensurePageSaved();
      if (currentItemId) {
        const webappUrl = (await chrome.storage.local.get("stoa_webapp_url")).stoa_webapp_url || "http://localhost:3000";
        chrome.tabs.create({ url: `${webappUrl}/item/${currentItemId}` });
        btn.textContent = "Saved \u2713";
      } else {
        btn.textContent = "Failed";
      }
    } catch (e) {
      btn.textContent = "Failed";
    }
    setTimeout(() => { btn.textContent = "Save & Open in Stoa"; btn.disabled = false; }, 3000);
  });

  // Notepad blur → save
  $("notepad").addEventListener("blur", autoSaveNotepad);
}

// --- Listen for highlight changes from content script ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "HIGHLIGHT_CHANGED") {
    loadHighlights();
  }
  if (msg.type === "ITEM_RESOLVED") {
    currentItemId = msg.payload?.itemId || currentItemId;
    currentItemCollectionIds = msg.payload?.collectionIds || currentItemCollectionIds;
    currentItemPersonIds = msg.payload?.personIds || currentItemPersonIds;
    updateSaveButtonState();
  }
});

// --- Save on panel close ---
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    autoSaveNotepad();
  }
});

window.addEventListener("beforeunload", () => {
  autoSaveNotepad();
});

// --- Re-init on tab switch ---
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  activeTabId = activeInfo.tabId;
  const tab = await chrome.tabs.get(activeTabId);
  pageInfo = await sendToContentScript({ type: "GET_PAGE_INFO" });
  if (!pageInfo) {
    try {
      pageInfo = { url: tab.url, title: tab.title, hostname: new URL(tab.url).hostname, isPdf: tab.url?.endsWith(".pdf") };
    } catch (e) {
      pageInfo = { url: tab.url, title: tab.title, hostname: "", isPdf: false };
    }
  }

  // Reset state
  currentItemId = null;
  currentItemCollectionIds = [];
  currentItemPersonIds = [];
  currentNoteId = null;
  lastSavedNoteContent = "";

  // Re-populate
  $("source-title").textContent = (pageInfo.title || "").substring(0, 60);
  $("notepad").innerHTML = "";
  $("highlight-list").innerHTML = "";

  await resolveCurrentItemId();
  updateSaveButtonState();
  await Promise.all([loadOrCreateSourceNote(), loadHighlights()]);

  if (currentItemCollectionIds.length > 0) $("collection-select").value = currentItemCollectionIds[0];
  if (currentItemPersonIds.length > 0) $("person-select").value = currentItemPersonIds[0];
});
