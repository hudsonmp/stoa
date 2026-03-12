/**
 * Stoa Content Script
 * - Highlight text selection with floating toolbar
 * - Keyboard shortcuts (1-5 for color, n for note, Escape to dismiss)
 * - Re-inject saved highlights on page load
 * - Track scroll position + reading progress bar
 * - Reading mode (Cmd/Ctrl+Shift+R) — simplified page like Safari Reader
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
    restoreHighlights();
    restoreScrollPosition();
  }

  setupSelectionListener();
  setupKeyboardShortcuts();
  setupScrollTracking();
  createProgressBar();
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
  document.addEventListener("mouseup", (e) => {
    const selection = window.getSelection();
    if (
      !selection ||
      selection.isCollapsed ||
      selection.toString().trim().length < 3
    ) {
      removeToolbar();
      return;
    }

    // Don't show toolbar inside our own UI
    if (e.target.closest(".stoa-toolbar")) return;

    showToolbar(selection, e);
  });

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
    // Ignore when typing in inputs/textareas/contenteditable
    const tag = e.target.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      e.target.isContentEditable ||
      e.target.closest(".stoa-note-input")
    ) {
      return;
    }

    // Escape → dismiss toolbar or exit reading mode
    if (e.key === "Escape") {
      if (toolbar) {
        removeToolbar();
        window.getSelection()?.removeAllRanges();
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
  try {
    range.surroundContents(span);
  } catch (e) {
    const fragment = range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);
  }

  // Flash animation on new highlight
  span.classList.add("stoa-highlight-flash");
  setTimeout(() => span.classList.remove("stoa-highlight-flash"), 600);

  _saveHighlightData(text, context, cssSelector, color, note);
  updateHighlightBadge(1);
}

function _saveHighlightData(text, context, cssSelector, color, note) {
  saveHighlight({
    text,
    context,
    css_selector: cssSelector,
    color,
    note,
    url: window.location.href,
  });
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
  if (!currentUser && !authToken) return;

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
      console.error(
        "[Stoa] Ingest failed:",
        itemResp.status,
        await itemResp.text()
      );
      return;
    }

    const itemData = await itemResp.json();
    const itemId = itemData?.item?.id;

    if (!itemId) {
      console.error("[Stoa] No item_id returned from ingest");
      return;
    }

    // Sync highlight to backend API
    await fetch(`${stoaApiUrl}/highlights`, {
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
  } catch (err) {
    console.error("[Stoa] Failed to save highlight:", err);
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
        span.className = `stoa-highlight stoa-highlight-${highlight.color || "yellow"}`;
        try {
          range.surroundContents(span);
        } catch (e) {
          // Multi-element span — skip gracefully
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
  return "blog";
}

// --- Run ---
init();
