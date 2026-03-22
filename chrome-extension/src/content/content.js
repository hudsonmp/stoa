/**
 * Stoa Content Script
 * - Highlight text selection with floating toolbar
 * - Keyboard shortcuts (1-5 for color, n for note, Escape to dismiss)
 * - Re-inject saved highlights on page load
 * - Track scroll position + reading progress bar
 * - Reading mode (Cmd/Ctrl+Shift+R) — simplified page like Safari Reader
 * - Notes sidebar (Cmd/Ctrl+Shift+N) — marginalia panel with highlights + notes
 * - Highlight removal — click highlight to remove, with undo
 * - Voice dictation — hands-free note-taking via Web Speech API
 * - Social overlay (badge showing friends who saved this page)
 */

const STOA_COLORS = ["yellow", "green", "blue", "pink", "purple"];

// --- State ---
let stoaApiUrl = "http://localhost:8000";
let currentUser = null;
let authToken = null;
let toolbar = null;
let progressBar = null;
let pendingSelection = null; // stashed selection range for keyboard shortcuts
let sidebarOpen = false;
let sidebarElement = null;
let highlightMap = new Map(); // Maps highlight text+selector → {id, span, data}
let currentItemId = null; // Stoa item ID for this page
let currentNoteId = null; // Stoa note ID for this page's source note
let noteAutoSaveTimer = null; // Auto-save interval for the notepad
let lastSavedNoteContent = ""; // Track last saved content to avoid redundant PATCHes

// --- Init ---
async function init() {
  const stored = await chrome.storage.local.get([
    "stoa_user_id",
    "stoa_api_url",
    "stoa_token",
  ]);
  currentUser = stored.stoa_user_id;
  authToken = stored.stoa_token || null;
  if (stored.stoa_api_url) stoaApiUrl = stored.stoa_api_url;

  if (currentUser) {
    await restoreHighlights();
    restoreScrollPosition();
    resolveCurrentItemId();
  }

  setupSelectionListener();
  setupKeyboardShortcuts();
  setupScrollTracking();
  createProgressBar();
  createSidebarToggle();
}

// Resolve the Stoa item ID for this URL (needed for notes + highlight deletion)
async function resolveCurrentItemId() {
  try {
    const resp = await fetch(
      `${stoaApiUrl}/items/by-url?url=${encodeURIComponent(window.location.href)}`,
      { headers: getAuthHeaders() }
    );
    if (resp.ok) {
      const data = await resp.json();
      currentItemId = data.item?.id || null;
    }
  } catch (e) {
    // Item doesn't exist yet — will be created on first highlight/save
  }
}

// --- Reading Progress Bar ---
function createProgressBar() {
  progressBar = document.createElement("div");
  progressBar.className = "stoa-progress-bar";
  progressBar.style.width = "0%";
  document.documentElement.appendChild(progressBar);
}

function updateProgressBar() {
  if (!progressBar) return;
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  if (docHeight <= 0) {
    progressBar.style.width = "100%";
    return;
  }
  const pct = Math.min(100, Math.round((scrollTop / docHeight) * 100));
  progressBar.style.width = pct + "%";
}

// --- Highlight Toolbar ---
function setupSelectionListener() {
  // On Stoa webapp: show toolbar on any text selection (single click)
  // On other sites: only show toolbar on double-click
  const isStoa = window.location.hostname === "localhost" && window.location.port === "3000";

  if (isStoa) {
    document.addEventListener("mouseup", (e) => {
      // Don't show toolbar inside editors (ProseMirror, TipTap, contenteditable)
      if (e.target.closest(".ProseMirror, .research-editor, [contenteditable]")) return;
      // Don't show on notes page
      if (window.location.pathname.startsWith("/notes")) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.toString().trim().length < 3) {
        removeToolbar();
        return;
      }
      if (e.target.closest(".stoa-toolbar")) return;
      showToolbar(selection, e);
    });
  } else {
    // External sites: double-click to show toolbar
    document.addEventListener("dblclick", (e) => {
      // Wait a tick for the browser to expand the selection
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.toString().trim().length < 3) return;
        if (e.target.closest(".stoa-toolbar")) return;
        showToolbar(selection, e);
      }, 50);
    });
  }

  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest(".stoa-toolbar")) {
      removeToolbar();
    }
  });
}

function showToolbar(selection) {
  removeToolbar();

  // Stash range for keyboard shortcuts
  pendingSelection = selection.getRangeAt(0).cloneRange();

  toolbar = document.createElement("div");
  toolbar.className = "stoa-toolbar";

  STOA_COLORS.forEach((color, i) => {
    const btn = document.createElement("button");
    btn.className = `stoa-btn-${color}`;
    btn.title = `Highlight ${color} (${i + 1})`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      highlightSelection(selection, color);
    });
    toolbar.appendChild(btn);
  });

  // Note button
  const noteBtn = document.createElement("button");
  noteBtn.className = "stoa-btn-note";
  noteBtn.textContent = "Note";
  noteBtn.title = "Add note (n)";
  noteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showNoteInput(selection.getRangeAt(0).cloneRange());
  });
  toolbar.appendChild(noteBtn);

  // Keyboard hint
  const hint = document.createElement("span");
  hint.className = "stoa-kbd-hint";
  hint.textContent = "1-5 / n";
  toolbar.appendChild(hint);

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  toolbar.style.top = `${window.scrollY + rect.top - 44}px`;
  toolbar.style.left = `${window.scrollX + rect.left + rect.width / 2 - 100}px`;

  document.body.appendChild(toolbar);
}

function showNoteInput(savedRange) {
  if (!toolbar) return;
  // Clear toolbar contents, show input
  while (toolbar.firstChild) toolbar.firstChild.remove();

  const input = document.createElement("input");
  input.type = "text";
  input.className = "stoa-note-input";
  input.placeholder = "Add a note...";
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      highlightFromRange(savedRange, "yellow", input.value || null);
      removeToolbar();
    } else if (ev.key === "Escape") {
      removeToolbar();
    }
  });
  const saveBtn = document.createElement("button");
  saveBtn.className = "stoa-btn-note";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    highlightFromRange(savedRange, "yellow", input.value || null);
    removeToolbar();
  });
  toolbar.appendChild(input);
  toolbar.appendChild(saveBtn);
  input.focus();
}

function removeToolbar() {
  if (toolbar) {
    toolbar.remove();
    toolbar = null;
  }
  pendingSelection = null;
}

// --- Keyboard Shortcuts ---
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    const tag = e.target.tagName;
    const inEditable = tag === "INPUT" || tag === "TEXTAREA" ||
      e.target.isContentEditable || e.target.closest(".stoa-note-input");

    // Always allow Cmd/Ctrl+Shift+E to toggle sidebar, even in editable fields
    if (e.key.toLowerCase() === "e" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // Ignore other shortcuts when typing in inputs/textareas/contenteditable
    if (inEditable) {
      return;
    }

    // Escape → dismiss toolbar, sidebar, or reading mode
    if (e.key === "Escape") {
      if (toolbar) {
        removeToolbar();
        window.getSelection()?.removeAllRanges();
        return;
      }
      if (sidebarOpen) {
        closeSidebar();
        return;
      }
      if (readingModeActive) {
        exitReadingMode();
        return;
      }
    }

    // Cmd/Ctrl+Shift+R → toggle reading mode
    if (e.key.toLowerCase() === "r" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      toggleReadingMode();
      return;
    }

    // (Cmd/Ctrl+Shift+N handled above, before editable check)

    // 1-5 → instant highlight with color (toolbar or bare selection)
    if (e.key >= "1" && e.key <= "5") {
      const sel = window.getSelection();
      const range = pendingSelection || (sel && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null);
      if (range && range.toString().trim().length >= 3) {
        const colorIdx = parseInt(e.key) - 1;
        highlightFromRange(range, STOA_COLORS[colorIdx]);
        removeToolbar();
        sel?.removeAllRanges();
        return;
      }
    }

    // n → add note to current selection
    if (e.key === "n" && toolbar && pendingSelection) {
      showNoteInput(pendingSelection.cloneRange());
      return;
    }
  });
}

// --- Highlight Logic ---
function highlightFromRange(range, color, note = null) {
  const text = range.toString().trim();
  if (!text || text.length < 3) return;
  _applyHighlight(range, text, color, note);
}

function highlightSelection(selection, color, note = null) {
  const range = selection.getRangeAt(0);
  const text = selection.toString().trim();
  if (!text || text.length < 3) return;
  _applyHighlight(range, text, color, note);
  selection.removeAllRanges();
  removeToolbar();
}

function _applyHighlight(range, text, color, note = null) {
  // Get context (surrounding paragraph)
  let context = "";
  const container = range.commonAncestorContainer;
  const paragraph =
    container.nodeType === 3 ? container.parentElement : container;
  const closestP = paragraph.closest(
    "p, div, li, blockquote, td, section, article"
  );
  if (closestP) {
    context = closestP.textContent.substring(0, 500);
  }
  const cssSelector = getCSSSelector(closestP || paragraph);

  const span = document.createElement("span");
  span.className = `stoa-highlight stoa-highlight-${color}`;
  span.dataset.stoaColor = color;
  span.dataset.stoaText = text;
  span.dataset.stoaSelector = cssSelector;
  try {
    range.surroundContents(span);
  } catch (e) {
    const fragment = range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);
  }

  // Click to show removal option
  span.addEventListener("click", (e) => {
    e.stopPropagation();
    showHighlightActions(span);
  });

  // Flash animation on new highlight
  span.classList.add("stoa-highlight-flash");
  setTimeout(() => span.classList.remove("stoa-highlight-flash"), 600);

  _saveHighlightData(text, context, cssSelector, color, note, span);
  updateHighlightBadge(1);
}

function _saveHighlightData(text, context, cssSelector, color, note, span) {
  saveHighlight({
    text,
    context,
    css_selector: cssSelector,
    color,
    note,
    url: window.location.href,
  }).then((highlightData) => {
    if (highlightData?.id) {
      span.dataset.stoaId = highlightData.id;
      highlightMap.set(highlightData.id, { span, data: highlightData });
      refreshSidebar();
    }
  });
}

// --- Highlight Actions (remove/edit on click) ---
let activeHighlightPopup = null;

function showHighlightActions(span) {
  dismissHighlightActions();

  const rect = span.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.className = "stoa-highlight-actions";

  const removeBtn = document.createElement("button");
  removeBtn.className = "stoa-ha-remove";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeHighlight(span);
    dismissHighlightActions();
  });

  const colorBar = document.createElement("div");
  colorBar.className = "stoa-ha-colors";
  STOA_COLORS.forEach((c) => {
    const dot = document.createElement("button");
    dot.className = `stoa-ha-dot stoa-ha-dot-${c}`;
    if (c === span.dataset.stoaColor) dot.classList.add("stoa-ha-dot-active");
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      changeHighlightColor(span, c);
      dismissHighlightActions();
    });
    colorBar.appendChild(dot);
  });

  popup.appendChild(colorBar);
  popup.appendChild(removeBtn);

  popup.style.top = `${window.scrollY + rect.bottom + 6}px`;
  popup.style.left = `${window.scrollX + rect.left + rect.width / 2}px`;
  document.body.appendChild(popup);
  activeHighlightPopup = popup;

  // Dismiss on outside click
  setTimeout(() => {
    document.addEventListener("click", dismissHighlightActions, { once: true });
  }, 0);
}

function dismissHighlightActions() {
  if (activeHighlightPopup) {
    activeHighlightPopup.remove();
    activeHighlightPopup = null;
  }
}

async function removeHighlight(span) {
  const highlightId = span.dataset.stoaId;

  // Unwrap the span — restore original text nodes
  const parent = span.parentNode;
  while (span.firstChild) {
    parent.insertBefore(span.firstChild, span);
  }
  parent.removeChild(span);
  parent.normalize();

  // Show undo toast
  showUndoToast(highlightId, span);

  // Delete from backend
  if (highlightId) {
    highlightMap.delete(highlightId);
    try {
      await fetch(`${stoaApiUrl}/highlights/${highlightId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
    } catch (e) {
      console.error("[Stoa] Failed to delete highlight:", e);
    }
    updateHighlightBadge(-1);
    refreshSidebar();
  }
}

async function changeHighlightColor(span, newColor) {
  const oldColor = span.dataset.stoaColor;
  span.className = `stoa-highlight stoa-highlight-${newColor}`;
  span.dataset.stoaColor = newColor;

  const highlightId = span.dataset.stoaId;
  if (highlightId) {
    try {
      await fetch(`${stoaApiUrl}/highlights/${highlightId}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ color: newColor }),
      });
    } catch (e) {
      // Revert on failure
      span.className = `stoa-highlight stoa-highlight-${oldColor}`;
      span.dataset.stoaColor = oldColor;
    }
    refreshSidebar();
  }
}

function showUndoToast(highlightId) {
  // Brief undo notification (purely visual confirmation)
  const toast = document.createElement("div");
  toast.className = "stoa-undo-toast";
  toast.innerHTML = `<span>Highlight removed</span>`;
  document.documentElement.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("stoa-toast-exit");
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function getCSSSelector(el) {
  if (!el || el === document.body) return "body";
  const parts = [];
  while (el && el !== document.body) {
    let selector = el.tagName.toLowerCase();
    if (el.id) {
      selector += `#${el.id}`;
      parts.unshift(selector);
      break;
    }
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === el.tagName
      );
      if (siblings.length > 1) {
        selector += `:nth-of-type(${siblings.indexOf(el) + 1})`;
      }
    }
    parts.unshift(selector);
    el = parent;
  }
  return parts.join(" > ");
}

// --- Auth Headers ---
function getAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  } else if (currentUser) {
    headers["X-User-Id"] = currentUser;
  }
  return headers;
}

// --- Save Highlight ---
async function saveHighlight(data) {
  if (!currentUser && !authToken) return null;

  const headers = getAuthHeaders();

  try {
    // Ensure the item exists (dedup handled server-side)
    const itemResp = await fetch(`${stoaApiUrl}/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: data.url,
        type: guessContentType(window.location.hostname),
      }),
    });

    if (!itemResp.ok) {
      console.error("[Stoa] Ingest failed:", itemResp.status, await itemResp.text());
      return null;
    }

    const itemData = await itemResp.json();
    const itemId = itemData?.item?.id;
    currentItemId = itemId || currentItemId;

    if (!itemId) {
      console.error("[Stoa] No item_id returned from ingest");
      return null;
    }

    // Sync highlight to backend API
    const hlResp = await fetch(`${stoaApiUrl}/highlights`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        item_id: itemId,
        text: data.text,
        context: data.context,
        css_selector: data.css_selector,
        color: data.color,
        note: data.note,
      }),
    });

    if (hlResp.ok) {
      const hlData = await hlResp.json();
      return hlData.highlight || null;
    }
    return null;
  } catch (err) {
    console.error("[Stoa] Failed to save highlight:", err);
    return null;
  }
}

// --- Badge count (tell service worker) ---
function updateHighlightBadge(delta) {
  chrome.runtime.sendMessage({
    type: "UPDATE_BADGE",
    payload: { delta },
  });
}

// --- Restore Highlights ---
async function restoreHighlights() {
  try {
    const resp = await fetch(
      `${stoaApiUrl}/highlights?url=${encodeURIComponent(window.location.href)}`,
      { headers: getAuthHeaders() }
    );
    const data = await resp.json();
    if (data?.highlights) {
      data.highlights.forEach((h) => injectHighlight(h));
      // Set initial badge count
      chrome.runtime.sendMessage({
        type: "SET_BADGE",
        payload: { count: data.highlights.length },
      });
    }
  } catch (err) {
    console.error("[Stoa] Failed to restore highlights:", err);
  }
}

function injectHighlight(highlight) {
  try {
    const el = document.querySelector(highlight.css_selector);
    if (!el) return;

    const textContent = el.textContent;
    const idx = textContent.indexOf(highlight.text);
    if (idx === -1) return;

    // Walk text nodes to find and wrap the match
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let currentOffset = 0;
    let startNode = null;
    let startOffset = 0;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const nodeLen = node.textContent.length;

      if (!startNode && currentOffset + nodeLen > idx) {
        startNode = node;
        startOffset = idx - currentOffset;
      }

      if (startNode && currentOffset + nodeLen >= idx + highlight.text.length) {
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(node, idx + highlight.text.length - currentOffset);

        const span = document.createElement("span");
        const color = highlight.color || "yellow";
        span.className = `stoa-highlight stoa-highlight-${color}`;
        span.dataset.stoaId = highlight.id;
        span.dataset.stoaColor = color;
        span.dataset.stoaText = highlight.text;
        span.dataset.stoaSelector = highlight.css_selector;

        // Click to show removal option
        span.addEventListener("click", (e) => {
          e.stopPropagation();
          showHighlightActions(span);
        });

        try {
          range.surroundContents(span);
        } catch (e) {
          // Multi-element span — skip gracefully
        }

        // Track in highlightMap
        if (highlight.id) {
          highlightMap.set(highlight.id, { span, data: highlight });
        }
        return;
      }

      currentOffset += nodeLen;
    }
  } catch (e) {
    // Selector not found — skip
  }
}

// --- Scroll Position Tracking ---
function setupScrollTracking() {
  let debounceTimer;

  const saveScroll = () => {
    updateProgressBar();

    if (!currentUser) return;
    chrome.runtime.sendMessage({
      type: "SAVE_SCROLL",
      payload: {
        url: window.location.href,
        user_id: currentUser,
        scroll_position: {
          x: window.scrollX,
          y: window.scrollY,
          progress: Math.round(
            (window.scrollY /
              Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) *
              100
          ),
        },
      },
    });
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveScroll();
  });

  window.addEventListener("beforeunload", saveScroll);

  window.addEventListener("scroll", () => {
    updateProgressBar();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(saveScroll, 2000);
  });
}

function restoreScrollPosition() {
  chrome.runtime.sendMessage(
    {
      type: "GET_SCROLL",
      payload: { url: window.location.href, user_id: currentUser },
    },
    (response) => {
      if (response?.scroll_position) {
        setTimeout(() => {
          window.scrollTo(
            response.scroll_position.x,
            response.scroll_position.y
          );
        }, 500);
      }
    }
  );
}

// --- Reading Mode ---
let readingModeActive = false;
let readingModeContainer = null;

function toggleReadingMode() {
  if (readingModeActive) {
    exitReadingMode();
  } else {
    enterReadingMode();
  }
}

function enterReadingMode() {
  const article =
    document.querySelector("article") ||
    document.querySelector("[role='main']") ||
    document.querySelector("main") ||
    document.querySelector(".post-content, .article-content, .entry-content, .content");

  let source = article;

  if (!source) {
    // Fallback: find the DOM subtree with the most <p> children
    const paragraphs = Array.from(document.querySelectorAll("p"));
    if (paragraphs.length < 3) return;

    const best = paragraphs.reduce((acc, p) => {
      const parent = p.parentElement;
      if (!parent) return acc;
      const count = parent.querySelectorAll("p").length;
      return count > (acc?.count || 0) ? { el: parent, count } : acc;
    }, null);

    if (!best) return;
    source = best.el;
  }

  readingModeActive = true;

  readingModeContainer = document.createElement("div");
  readingModeContainer.className = "stoa-reading-mode";

  // Top bar
  const topbar = document.createElement("div");
  topbar.className = "stoa-rm-topbar";

  const title = document.createElement("span");
  title.className = "stoa-rm-title";
  title.textContent = document.title;

  const closeBtn = document.createElement("button");
  closeBtn.className = "stoa-rm-close";
  closeBtn.textContent = "Exit Reader";
  closeBtn.addEventListener("click", exitReadingMode);

  topbar.appendChild(title);
  topbar.appendChild(closeBtn);

  // Content
  const content = document.createElement("div");
  content.className = "stoa-rm-content";

  const clone = source.cloneNode(true);
  const removeSelectors =
    "script, iframe, nav, aside, .ad, .ads, .advertisement, .sidebar, " +
    ".social-share, .comments, .related-posts, footer, header, " +
    "[role='navigation'], [role='complementary'], [aria-hidden='true']";
  clone.querySelectorAll(removeSelectors).forEach((el) => el.remove());
  clone.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"));

  content.appendChild(clone);
  readingModeContainer.appendChild(topbar);
  readingModeContainer.appendChild(content);
  document.body.appendChild(readingModeContainer);
  document.body.style.overflow = "hidden";

  // Selection listener inside reading mode
  readingModeContainer.addEventListener("mouseup", (e) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim().length < 3) return;
    if (e.target.closest(".stoa-toolbar") || e.target.closest(".stoa-rm-topbar")) return;
    showToolbar(sel);
  });
}

function exitReadingMode() {
  readingModeActive = false;
  if (readingModeContainer) {
    readingModeContainer.remove();
    readingModeContainer = null;
  }
  document.body.style.overflow = "";
}

// --- Helpers ---
function guessContentType(hostname) {
  if (hostname.includes("arxiv.org")) return "paper";
  if (hostname.includes("youtube.com")) return "video";
  if (hostname.includes("twitter.com") || hostname.includes("x.com"))
    return "tweet";
  // Fall back to classifier for more nuanced detection
  const classified = classifyPage();
  if (classified.confidence > 0.5) return classified.type;
  return "blog";
}

// --- LLM Page Classifier (async, with heuristic fallback) ---
let llmClassification = null;

async function classifyPageLLM() {
  try {
    const meta = {
      url: window.location.href,
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || "",
      og_type: document.querySelector('meta[property="og:type"]')?.content || "",
      has_article: !!document.querySelector("article"),
      word_count: (document.body?.innerText || "").split(/\s+/).length,
      has_author: !!(
        document.querySelector('meta[name="author"]') ||
        document.querySelector('.byline, .author, [rel="author"]')
      ),
      has_date: !!(
        document.querySelector("time") ||
        document.querySelector('meta[property="article:published_time"]')
      ),
      domain: window.location.hostname,
    };

    const resp = await fetch(`${stoaApiUrl}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });

    if (resp.ok) {
      llmClassification = await resp.json();
    }
  } catch (e) {
    // Backend unreachable — heuristic fallback handles it
  }
}

// Fire LLM classification on page load (non-blocking)
if (document.readyState === "complete") {
  classifyPageLLM();
} else {
  window.addEventListener("load", classifyPageLLM);
}

// --- Blog Classifier (heuristic fallback) ---
function classifyPage() {
  let score = 0;
  let type = "page";
  const hostname = window.location.hostname;

  // Known blog/article platforms
  const blogDomains = [
    "substack.com", "medium.com", "wordpress.com", "ghost.io",
    "henrikkarlsson.xyz", "paulgraham.com", "marginalrevolution.com",
    "benkuhn.net", "patrickcollison.com", "darioamodei.com",
  ];
  if (blogDomains.some(d => hostname.includes(d))) {
    score += 0.05;
  }

  // <article> tag
  if (document.querySelector("article")) score += 0.25;

  // og:type = article
  const ogType = document.querySelector('meta[property="og:type"]');
  if (ogType && ogType.content === "article") score += 0.20;

  // Author/byline
  const hasAuthor =
    document.querySelector('meta[name="author"]') ||
    document.querySelector('.byline, .author, [rel="author"]') ||
    document.querySelector('meta[property="article:author"]');
  if (hasAuthor) score += 0.15;

  // Word count > 500
  const wordCount = (document.body?.innerText || "").split(/\s+/).length;
  if (wordCount > 500) score += 0.15;

  // Published date
  const hasDate =
    document.querySelector("time") ||
    document.querySelector('meta[property="article:published_time"]') ||
    document.querySelector(".date, .published, .post-date");
  if (hasDate) score += 0.10;

  // Reading time metadata or similar
  const hasReadTime = document.querySelector(
    '.reading-time, .read-time, [class*="readingTime"], [class*="read-time"]'
  );
  if (hasReadTime) score += 0.10;

  if (score >= 0.3) type = "blog";

  // Paper detection via domain
  if (hostname.includes("arxiv.org") || hostname.includes("doi.org") ||
      hostname.includes("semanticscholar.org") || hostname.includes("scholar.google")) {
    type = "paper";
    score = 0.9;
  }

  return { type, confidence: Math.min(1, score), wordCount };
}

// --- Passive Save Toast ---
let toastShown = false;
let toastElement = null;

function showSaveToast(classification) {
  if (toastShown || !currentUser) return;
  toastShown = true;

  toastElement = document.createElement("div");
  toastElement.className = "stoa-save-toast";
  toastElement.innerHTML = `
    <div class="stoa-toast-content">
      <span class="stoa-toast-icon">📚</span>
      <span class="stoa-toast-text">Save to Stoa?</span>
      <button class="stoa-toast-save">Save</button>
      <button class="stoa-toast-dismiss">×</button>
    </div>
  `;

  const saveBtn = toastElement.querySelector(".stoa-toast-save");
  const dismissBtn = toastElement.querySelector(".stoa-toast-dismiss");

  saveBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({
      type: "SAVE_PAGE",
      payload: {
        url: window.location.href,
        user_id: currentUser,
        type: classification.type,
        tags: [],
      },
    }, (response) => {
      if (response?.success) {
        toastElement.querySelector(".stoa-toast-text").textContent = "Saved ✓";
        saveBtn.remove();
        setTimeout(() => removeSaveToast(), 2000);
      }
    });
  });

  dismissBtn.addEventListener("click", removeSaveToast);

  document.documentElement.appendChild(toastElement);

  // Auto-dismiss after 8s
  setTimeout(removeSaveToast, 8000);
}

function removeSaveToast() {
  if (toastElement) {
    toastElement.classList.add("stoa-toast-exit");
    setTimeout(() => {
      toastElement?.remove();
      toastElement = null;
    }, 300);
  }
}

// --- Engagement Tracking ---
const engagement = {
  startTime: Date.now(),
  activeTime: 0,
  lastActiveAt: Date.now(),
  isActive: true,
  maxScrollDepth: 0,
  scrollReversals: 0,
  lastScrollY: 0,
  lastScrollDirection: null,
  highlightCount: 0,
  readerModeUsed: false,
};

function trackEngagement() {
  // Visibility tracking
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (engagement.isActive) {
        engagement.activeTime += Date.now() - engagement.lastActiveAt;
        engagement.isActive = false;
      }
      syncEngagement();
    } else {
      engagement.lastActiveAt = Date.now();
      engagement.isActive = true;
    }
  });

  window.addEventListener("beforeunload", () => {
    if (engagement.isActive) {
      engagement.activeTime += Date.now() - engagement.lastActiveAt;
    }
    syncEngagement();
  });

  // Scroll depth and reversals
  window.addEventListener("scroll", () => {
    const scrollY = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight > 0) {
      const depth = Math.round((scrollY / docHeight) * 100);
      engagement.maxScrollDepth = Math.max(engagement.maxScrollDepth, depth);
    }

    // Detect scroll direction reversal
    const direction = scrollY > engagement.lastScrollY ? "down" : "up";
    if (engagement.lastScrollDirection && direction !== engagement.lastScrollDirection) {
      engagement.scrollReversals++;
    }
    engagement.lastScrollDirection = direction;
    engagement.lastScrollY = scrollY;
  });
}

function syncEngagement() {
  // Only sync if item is saved in Stoa
  chrome.storage.local.get(`saved:${window.location.href}`, (data) => {
    if (!data[`saved:${window.location.href}`]) return;

    chrome.storage.local.get(`saved_item_id:${window.location.href}`, (idData) => {
      const itemId = idData[`saved_item_id:${window.location.href}`];
      if (!itemId) return;

      const totalActive = engagement.isActive
        ? engagement.activeTime + (Date.now() - engagement.lastActiveAt)
        : engagement.activeTime;

      chrome.runtime.sendMessage({
        type: "SYNC_ENGAGEMENT",
        payload: {
          item_id: itemId,
          user_id: currentUser,
          session: {
            time_ms: totalActive,
            depth_pct: engagement.maxScrollDepth,
            reversals: engagement.scrollReversals,
            highlights: engagement.highlightCount,
            reader_mode: engagement.readerModeUsed,
            at: new Date().toISOString(),
          },
        },
      });
    });
  });
}

// --- Scroll Sync to Backend ---
function syncScrollToBackend() {
  const url = window.location.href;
  chrome.storage.local.get([`saved:${url}`, `saved_item_id:${url}`], (data) => {
    if (!data[`saved:${url}`]) return;
    const itemId = data[`saved_item_id:${url}`];
    if (!itemId) return;

    chrome.runtime.sendMessage({
      type: "SYNC_SCROLL",
      payload: {
        item_id: itemId,
        user_id: currentUser,
        scroll_position: {
          x: window.scrollX,
          y: window.scrollY,
          progress: Math.round(
            (window.scrollY /
              Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) *
              100
          ),
        },
      },
    });
  });
}

// --- Notes Sidebar ---
function createSidebarToggle() {
  const toggle = document.createElement("button");
  toggle.className = "stoa-sidebar-toggle";
  toggle.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M2 6h8M2 9h10M2 12h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  toggle.title = "Notes & Highlights (Cmd+Shift+E)";
  toggle.addEventListener("click", toggleSidebar);
  document.documentElement.appendChild(toggle);
}

function toggleSidebar() {
  if (sidebarOpen) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

async function openSidebar() {
  if (sidebarElement) sidebarElement.remove();
  sidebarOpen = true;

  // Shift page content left to make room
  document.body.style.marginRight = "35%";
  document.body.style.transition = "margin-right 0.25s cubic-bezier(0.23, 1, 0.32, 1)";

  sidebarElement = document.createElement("div");
  sidebarElement.className = "stoa-sidebar";

  // --- Header ---
  const header = document.createElement("div");
  header.className = "stoa-sb-header";

  const title = document.createElement("h3");
  title.className = "stoa-sb-title";
  title.textContent = "Marginalia";

  const headerRight = document.createElement("div");
  headerRight.style.cssText = "display:flex;align-items:center;gap:8px;";

  const saveStatus = document.createElement("span");
  saveStatus.className = "stoa-sb-save-status";
  saveStatus.id = "stoa-sb-save-status";
  saveStatus.textContent = "";

  const closeBtn = document.createElement("button");
  closeBtn.className = "stoa-sb-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", closeSidebar);

  headerRight.appendChild(saveStatus);
  headerRight.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(headerRight);
  sidebarElement.appendChild(header);

  // --- Source link ---
  const sourceBar = document.createElement("div");
  sourceBar.className = "stoa-sb-source-bar";
  const sourceDomain = window.location.hostname.replace("www.", "");
  const sourceTitle = document.title.substring(0, 60) || sourceDomain;
  sourceBar.innerHTML = `<span class="stoa-sb-source-label">Source</span><span class="stoa-sb-source-title" title="${document.title}">${sourceTitle}</span>`;
  sidebarElement.appendChild(sourceBar);

  // --- Save options: type + collection ---
  const saveOpts = document.createElement("div");
  saveOpts.className = "stoa-sb-save-opts";

  // Type selector
  const typeSelect = document.createElement("select");
  typeSelect.className = "stoa-sb-type-select";
  ["essay", "paper", "book", "person", "blog", "page"].forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    typeSelect.appendChild(opt);
  });
  // Auto-detect type
  const detectedType = guessContentType(window.location.hostname);
  typeSelect.value = detectedType === "blog" ? "essay" : detectedType;
  typeSelect.addEventListener("change", async () => {
    if (currentItemId) {
      await fetch(`${stoaApiUrl}/items/${currentItemId}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ type: typeSelect.value }),
      });
    }
  });

  // Person name input (shown only when type is "person")
  const personInput = document.createElement("input");
  personInput.type = "text";
  personInput.className = "stoa-sb-person-input";
  personInput.placeholder = "Person's name...";
  personInput.style.display = "none";
  personInput.addEventListener("blur", async () => {
    if (personInput.value.trim() && currentItemId) {
      await fetch(`${stoaApiUrl}/people`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: personInput.value.trim(),
          website_url: window.location.href,
          role: "intellectual hero",
        }),
      });
    }
  });
  typeSelect.addEventListener("change", () => {
    personInput.style.display = typeSelect.value === "person" ? "block" : "none";
  });

  const typeLabel = document.createElement("span");
  typeLabel.className = "stoa-sb-opt-label";
  typeLabel.textContent = "Type";

  saveOpts.appendChild(typeLabel);
  saveOpts.appendChild(typeSelect);
  saveOpts.appendChild(personInput);
  sidebarElement.appendChild(saveOpts);

  // --- Formatting toolbar ---
  const fmtBar = document.createElement("div");
  fmtBar.className = "stoa-sb-fmt-bar";

  const boldBtn = document.createElement("button");
  boldBtn.className = "stoa-sb-fmt-btn";
  boldBtn.innerHTML = "<strong>B</strong>";
  boldBtn.title = "Bold (Cmd+B)";
  boldBtn.addEventListener("click", () => document.execCommand("bold"));

  const italicBtn = document.createElement("button");
  italicBtn.className = "stoa-sb-fmt-btn";
  italicBtn.innerHTML = "<em>I</em>";
  italicBtn.title = "Italic (Cmd+I)";
  italicBtn.addEventListener("click", () => document.execCommand("italic"));

  const listBtn = document.createElement("button");
  listBtn.className = "stoa-sb-fmt-btn";
  listBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="2.5" cy="3" r="1" fill="currentColor"/><circle cx="2.5" cy="7" r="1" fill="currentColor"/><circle cx="2.5" cy="11" r="1" fill="currentColor"/><line x1="5" y1="3" x2="12" y2="3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="11" x2="12" y2="11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  listBtn.title = "Bullet list";
  listBtn.addEventListener("click", () => document.execCommand("insertUnorderedList"));

  fmtBar.appendChild(boldBtn);
  fmtBar.appendChild(italicBtn);
  fmtBar.appendChild(listBtn);
  sidebarElement.appendChild(fmtBar);

  // --- Notepad (contenteditable) ---
  const notepad = document.createElement("div");
  notepad.className = "stoa-sb-notepad";
  notepad.id = "stoa-sb-notepad";
  notepad.contentEditable = "true";
  notepad.spellcheck = true;
  notepad.dataset.placeholder = "Write your notes...";
  sidebarElement.appendChild(notepad);

  // --- Highlights section ---
  const list = document.createElement("div");
  list.className = "stoa-sb-list";
  list.id = "stoa-sb-list";
  sidebarElement.appendChild(list);

  document.documentElement.appendChild(sidebarElement);

  // --- Auto-save the page to Stoa if not already saved ---
  await ensurePageSaved();

  // --- Load or create the source note ---
  await loadOrCreateSourceNote(notepad);

  // --- Populate highlights ---
  populateSidebarHighlights(list);

  // --- Auto-save notepad every 5 seconds ---
  noteAutoSaveTimer = setInterval(() => {
    autoSaveNotepad();
  }, 5000);

  // Also save on blur
  notepad.addEventListener("blur", () => {
    autoSaveNotepad();
  });
}

async function ensurePageSaved() {
  if (currentItemId) return;
  try {
    // Check if URL already has a Stoa item
    const checkResp = await fetch(
      `${stoaApiUrl}/items/by-url?url=${encodeURIComponent(window.location.href)}`,
      { headers: getAuthHeaders() }
    );
    if (checkResp.ok) {
      const checkData = await checkResp.json();
      if (checkData.item?.id) {
        currentItemId = checkData.item.id;
        return;
      }
    }
  } catch (e) { /* not found, will ingest */ }

  // Auto-save via /ingest
  try {
    const resp = await fetch(`${stoaApiUrl}/ingest`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        url: window.location.href,
        type: guessContentType(window.location.hostname),
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      currentItemId = data.item?.id || null;
    }
  } catch (e) {
    console.error("[Stoa] Failed to auto-save page:", e);
  }
}

async function loadOrCreateSourceNote(notepad) {
  if (!currentItemId) return;

  const statusEl = document.getElementById("stoa-sb-save-status");

  try {
    // Look for existing note linked to this item
    const resp = await fetch(
      `${stoaApiUrl}/notes?item_id=${currentItemId}`,
      { headers: getAuthHeaders() }
    );
    if (resp.ok) {
      const data = await resp.json();
      const notes = data.notes || [];
      // Find the source-note (tagged "source-note") or the first marginalia note
      const sourceNote = notes.find(n => (n.tags || []).includes("source-note")) || notes[0];
      if (sourceNote) {
        currentNoteId = sourceNote.id;
        notepad.innerHTML = sourceNote.content || "";
        lastSavedNoteContent = notepad.innerHTML;
        return;
      }
    }
  } catch (e) {
    console.error("[Stoa] Failed to load notes:", e);
  }

  // No existing note — create one
  try {
    const resp = await fetch(`${stoaApiUrl}/notes`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        item_id: currentItemId,
        content: "",
        title: document.title || window.location.href,
        note_type: "marginalia",
        tags: ["source-note", `ref:${currentItemId}`],
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      currentNoteId = data.note?.id || null;
      lastSavedNoteContent = "";
    }
  } catch (e) {
    console.error("[Stoa] Failed to create source note:", e);
  }
}

async function autoSaveNotepad() {
  const notepad = document.getElementById("stoa-sb-notepad");
  const statusEl = document.getElementById("stoa-sb-save-status");
  if (!notepad || !currentNoteId) return;

  const content = notepad.innerHTML;
  if (content === lastSavedNoteContent) return; // No changes

  try {
    if (statusEl) statusEl.textContent = "Saving...";
    const resp = await fetch(`${stoaApiUrl}/notes/${currentNoteId}`, {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({ content }),
    });
    if (resp.ok) {
      lastSavedNoteContent = content;
      if (statusEl) {
        statusEl.textContent = "Saved";
        setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 2000);
      }
    }
  } catch (e) {
    console.error("[Stoa] Failed to auto-save note:", e);
    if (statusEl) statusEl.textContent = "Save failed";
  }
}

function closeSidebar() {
  // Final save before closing
  autoSaveNotepad();

  sidebarOpen = false;

  // Clear auto-save timer
  if (noteAutoSaveTimer) {
    clearInterval(noteAutoSaveTimer);
    noteAutoSaveTimer = null;
  }

  // Reset note state for this session
  currentNoteId = null;
  lastSavedNoteContent = "";

  // Restore page margin
  document.body.style.marginRight = "";

  if (sidebarElement) {
    sidebarElement.classList.add("stoa-sb-exit");
    setTimeout(() => {
      sidebarElement?.remove();
      sidebarElement = null;
    }, 250);
  }
  stopVoiceDictation();
}

function refreshSidebar() {
  if (!sidebarOpen) return;
  const list = document.getElementById("stoa-sb-list");
  if (list) populateSidebarHighlights(list);
}

async function populateSidebarHighlights(list) {
  list.innerHTML = "";

  // Also fetch highlights from API (in case local map is stale)
  try {
    const resp = await fetch(
      `${stoaApiUrl}/highlights?url=${encodeURIComponent(window.location.href)}`,
      { headers: getAuthHeaders() }
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data?.highlights) {
        data.highlights.forEach((h) => {
          if (!highlightMap.has(h.id)) {
            highlightMap.set(h.id, { span: null, data: h });
          }
        });
      }
    }
  } catch (e) { /* backend unreachable */ }

  // Section: Highlights
  const hlSection = document.createElement("div");
  hlSection.className = "stoa-sb-section";
  const hlHeading = document.createElement("h4");
  hlHeading.className = "stoa-sb-section-title";
  hlHeading.textContent = "Highlights";
  hlSection.appendChild(hlHeading);

  const highlights = Array.from(highlightMap.entries());
  if (highlights.length === 0) {
    const empty = document.createElement("p");
    empty.className = "stoa-sb-empty";
    empty.textContent = "Select text on the page to highlight it.";
    hlSection.appendChild(empty);
  } else {
    highlights.forEach(([id, { span, data }]) => {
      const card = document.createElement("div");
      card.className = `stoa-sb-card stoa-sb-card-${data.color || span?.dataset?.stoaColor || "yellow"}`;

      const text = document.createElement("p");
      text.className = "stoa-sb-card-text";
      text.textContent = (data.text || "").substring(0, 200) + ((data.text || "").length > 200 ? "..." : "");

      const actions = document.createElement("div");
      actions.className = "stoa-sb-card-actions";

      // Jump to highlight
      const jumpBtn = document.createElement("button");
      jumpBtn.className = "stoa-sb-card-jump";
      jumpBtn.textContent = "Jump";
      jumpBtn.addEventListener("click", () => {
        if (span && span.isConnected) {
          span.scrollIntoView({ behavior: "smooth", block: "center" });
          span.classList.add("stoa-highlight-flash");
          setTimeout(() => span.classList.remove("stoa-highlight-flash"), 600);
        }
      });

      // Remove
      const removeBtn = document.createElement("button");
      removeBtn.className = "stoa-sb-card-remove";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        if (span && span.isConnected) {
          removeHighlight(span);
        } else {
          deleteHighlightById(id);
        }
      });

      if (data.note) {
        const note = document.createElement("p");
        note.className = "stoa-sb-card-note";
        note.textContent = data.note;
        card.appendChild(note);
      }

      actions.appendChild(jumpBtn);
      actions.appendChild(removeBtn);
      card.appendChild(text);
      card.appendChild(actions);
      hlSection.appendChild(card);
    });
  }
  list.appendChild(hlSection);
}

// saveSidebarNote is now handled by autoSaveNotepad() via contenteditable

async function deleteHighlightById(id) {
  highlightMap.delete(id);
  try {
    await fetch(`${stoaApiUrl}/highlights/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("[Stoa] Failed to delete highlight:", e);
  }
  updateHighlightBadge(-1);
  refreshSidebar();
}

// --- Voice Dictation (Web Speech API) ---
let recognition = null;
let isRecording = false;

function toggleVoiceDictation(textarea, btn) {
  if (isRecording) {
    stopVoiceDictation();
    btn.classList.remove("stoa-sb-voice-active");
  } else {
    startVoiceDictation(textarea, btn);
  }
}

function startVoiceDictation(textarea, btn) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("[Stoa] Speech recognition not supported");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  let finalTranscript = textarea.value;
  isRecording = true;
  btn.classList.add("stoa-sb-voice-active");

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += (finalTranscript ? " " : "") + transcript;
      } else {
        interim = transcript;
      }
    }
    textarea.value = finalTranscript + (interim ? " " + interim : "");
    // Auto-resize
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
  };

  recognition.onerror = (e) => {
    if (e.error !== "no-speech") {
      console.error("[Stoa] Speech recognition error:", e.error);
    }
    stopVoiceDictation();
    btn.classList.remove("stoa-sb-voice-active");
  };

  recognition.onend = () => {
    // Restart if still recording (continuous mode can stop)
    if (isRecording) {
      try { recognition.start(); } catch (e) { /* already started */ }
    }
  };

  recognition.start();
}

function stopVoiceDictation() {
  isRecording = false;
  if (recognition) {
    recognition.abort();
    recognition = null;
  }
}

// --- Passive Blog Detection on Scroll ---
let passiveCheckDone = false;

function setupPassiveMonitoring() {
  window.addEventListener("scroll", () => {
    if (passiveCheckDone || toastShown) return;

    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight <= 0) return;
    const progress = window.scrollY / docHeight;

    // Threshold: 50% scroll + 0.7 confidence (Claypool et al. 2001, Adamczyk & Bailey 2004)
    // Lower thresholds produce false positives that erode system trust (Parasuraman & Manzey 2010)
    if (progress >= 0.50) {
      passiveCheckDone = true;

      // Check if already saved
      chrome.storage.local.get(`saved:${window.location.href}`, (data) => {
        if (data[`saved:${window.location.href}`]) return;

        // Use heuristic for known domains, LLM for ambiguous pages
        const heuristic = classifyPage();
        const classification = (heuristic.confidence >= 0.8) ? heuristic : (llmClassification || heuristic);
        if (classification.confidence >= 0.7) {
          showSaveToast(classification);
        }
      });
    }
  });
}

// --- Run ---
init();
trackEngagement();
setupPassiveMonitoring();

// Backend scroll sync (debounced, in addition to local storage)
let backendScrollTimer = null;
window.addEventListener("scroll", () => {
  clearTimeout(backendScrollTimer);
  backendScrollTimer = setTimeout(syncScrollToBackend, 5000);
});
