/**
 * Stoa Content Script
 * - Highlight text selection with floating toolbar
 * - Re-inject saved highlights on page load
 * - Track scroll position
 * - Social overlay (badge showing friends who saved this page)
 */

const STOA_API = "http://localhost:8000";
const STOA_COLORS = ["yellow", "green", "blue", "pink", "purple"];

// --- State ---
let currentUser = null;
let toolbar = null;

// --- Init ---
async function init() {
  const stored = await chrome.storage.local.get(["stoa_user_id", "stoa_api_url"]);
  currentUser = stored.stoa_user_id;
  if (stored.stoa_api_url) {
    // Allow overriding API URL
  }

  if (currentUser) {
    restoreHighlights();
    restoreScrollPosition();
    setupScrollTracking();
  }

  setupSelectionListener();
}

// --- Highlight Toolbar ---
function setupSelectionListener() {
  document.addEventListener("mouseup", (e) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.toString().trim().length < 3) {
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

function showToolbar(selection, event) {
  removeToolbar();

  toolbar = document.createElement("div");
  toolbar.className = "stoa-toolbar";

  STOA_COLORS.forEach((color) => {
    const btn = document.createElement("button");
    btn.className = `stoa-btn-${color}`;
    btn.title = `Highlight ${color}`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      highlightSelection(selection, color);
    });
    toolbar.appendChild(btn);
  });

  // Note button — shows inline input instead of blocking prompt()
  const noteBtn = document.createElement("button");
  noteBtn.className = "stoa-btn-note";
  noteBtn.textContent = "Note";
  noteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Replace toolbar content with inline note input
    toolbar.innerHTML = "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "stoa-note-input";
    input.placeholder = "Add a note...";
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        highlightSelection(selection, "yellow", input.value || null);
      } else if (ev.key === "Escape") {
        removeToolbar();
      }
    });
    const saveBtn = document.createElement("button");
    saveBtn.className = "stoa-btn-note";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      highlightSelection(selection, "yellow", input.value || null);
    });
    toolbar.appendChild(input);
    toolbar.appendChild(saveBtn);
    input.focus();
  });
  toolbar.appendChild(noteBtn);

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  toolbar.style.top = `${window.scrollY + rect.top - 44}px`;
  toolbar.style.left = `${window.scrollX + rect.left + (rect.width / 2) - 80}px`;

  document.body.appendChild(toolbar);
}

function removeToolbar() {
  if (toolbar) {
    toolbar.remove();
    toolbar = null;
  }
}

// --- Highlight Logic ---
function highlightSelection(selection, color, note = null) {
  const range = selection.getRangeAt(0);
  const text = selection.toString().trim();

  // Get context (surrounding paragraph)
  let context = "";
  const container = range.commonAncestorContainer;
  const paragraph = container.nodeType === 3 ? container.parentElement : container;
  const closestP = paragraph.closest("p, div, li, blockquote, td, section, article");
  if (closestP) {
    context = closestP.textContent.substring(0, 500);
  }

  // Get CSS selector for re-injection
  const cssSelector = getCSSSelector(closestP || paragraph);

  // Wrap selection in highlight span
  const span = document.createElement("span");
  span.className = `stoa-highlight stoa-highlight-${color}`;
  span.dataset.stoaColor = color;

  try {
    range.surroundContents(span);
  } catch (e) {
    // Range spans multiple elements — use extractContents approach
    const fragment = range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);
  }

  selection.removeAllRanges();
  removeToolbar();

  // Save to backend
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

// --- Save Highlight ---
async function saveHighlight(data) {
  if (!currentUser) return;

  const headers = {
    "Content-Type": "application/json",
    "X-User-Id": currentUser,
  };

  try {
    // Ensure the item exists (dedup handled server-side)
    const itemResp = await fetch(`${STOA_API}/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: data.url,
        type: guessContentType(window.location.hostname),
      }),
    });
    const itemData = await itemResp.json();
    const itemId = itemData?.item?.id;

    if (!itemId) {
      console.error("[Stoa] No item_id returned from ingest");
      return;
    }

    // Sync highlight to backend API (persisted in Supabase)
    await fetch(`${STOA_API}/highlights`, {
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

// --- Restore Highlights ---
async function restoreHighlights() {
  try {
    const resp = await fetch(
      `${STOA_API}/highlights?url=${encodeURIComponent(window.location.href)}`,
      { headers: { "X-User-Id": currentUser } }
    );
    const data = await resp.json();
    if (data?.highlights) {
      data.highlights.forEach((h) => injectHighlight(h));
    }
  } catch (err) {
    console.error("[Stoa] Failed to restore highlights:", err);
  }
}

function injectHighlight(highlight) {
  // Try to find the element via CSS selector
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
    chrome.runtime.sendMessage({
      type: "SAVE_SCROLL",
      payload: {
        url: window.location.href,
        user_id: currentUser,
        scroll_position: {
          x: window.scrollX,
          y: window.scrollY,
          progress: Math.round(
            (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100
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
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(saveScroll, 2000);
  });
}

function restoreScrollPosition() {
  chrome.runtime.sendMessage(
    { type: "GET_SCROLL", payload: { url: window.location.href, user_id: currentUser } },
    (response) => {
      if (response?.scroll_position) {
        setTimeout(() => {
          window.scrollTo(response.scroll_position.x, response.scroll_position.y);
        }, 500);
      }
    }
  );
}

// --- Helpers ---
function guessContentType(hostname) {
  if (hostname.includes("arxiv.org")) return "paper";
  if (hostname.includes("youtube.com")) return "video";
  if (hostname.includes("twitter.com") || hostname.includes("x.com")) return "tweet";
  return "blog";
}

// --- Run ---
init();
