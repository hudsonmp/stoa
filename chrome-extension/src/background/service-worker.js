/**
 * Stoa Service Worker (Manifest V3)
 * - Handle messages from content scripts
 * - Manage tab groups save/restore
 * - Context menus
 * - Keyboard shortcuts
 * - Badge showing highlight count on current page
 */

// --- Auth + Config Helpers ---
async function getConfig() {
  const stored = await chrome.storage.local.get([
    "stoa_api_url",
    "stoa_user_id",
    "stoa_token",
  ]);
  return {
    apiUrl: stored.stoa_api_url || "http://localhost:8000",
    userId: stored.stoa_user_id || null,
    token: stored.stoa_token || null,
  };
}

function buildAuthHeaders(config) {
  const headers = { "Content-Type": "application/json" };
  if (config.token) {
    headers["Authorization"] = `Bearer ${config.token}`;
  } else if (config.userId) {
    headers["X-User-Id"] = config.userId;
  }
  return headers;
}

// --- Message Handling ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "SAVE_SCROLL":
      handleSaveScroll(message.payload);
      return false;

    case "GET_SCROLL":
      handleGetScroll(message.payload).then(sendResponse);
      return true;

    case "SAVE_PAGE":
      handleSavePage(message.payload).then(sendResponse);
      return true;

    case "SAVE_TAB_GROUP":
      saveCurrentTabGroup().then(sendResponse);
      return true;

    case "SET_BADGE":
      setBadge(message.payload.count, sender.tab?.id);
      return false;

    case "UPDATE_BADGE":
      incrementBadge(message.payload.delta, sender.tab?.id);
      return false;

    case "SYNC_SCROLL":
      handleSyncScroll(message.payload);
      return false;

    case "SYNC_ENGAGEMENT":
      handleSyncEngagement(message.payload);
      return false;
  }
});

// --- Badge Management ---
const tabBadgeCounts = {};

function setBadge(count, tabId) {
  if (!tabId) return;
  tabBadgeCounts[tabId] = count;
  const text = count > 0 ? String(count) : "";
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#C2410C", tabId });
}

function incrementBadge(delta, tabId) {
  if (!tabId) return;
  const current = tabBadgeCounts[tabId] || 0;
  setBadge(current + delta, tabId);
}

// Clear badge when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabBadgeCounts[tabId];
});

// --- Scroll Position ---
async function handleSaveScroll(data) {
  const key = `scroll:${data.url}`;
  await chrome.storage.local.set({ [key]: data.scroll_position });
}

async function handleGetScroll(data) {
  const key = `scroll:${data.url}`;
  const stored = await chrome.storage.local.get(key);
  return { scroll_position: stored[key] || null };
}

// --- Auto-detect type from URL ---
const PAPER_DOMAINS = [
  "arxiv.org", "dl.acm.org", "link.springer.com", "ieeexplore.ieee.org",
  "aclanthology.org", "openreview.net", "proceedings.mlr.press",
  "papers.nips.cc", "semanticscholar.org", "scholar.google.com",
  "nature.com", "science.org", "biorxiv.org", "medrxiv.org",
];

function detectType(url, fallback = "blog") {
  try {
    const host = new URL(url).hostname;
    if (PAPER_DOMAINS.some((d) => host.endsWith(d))) return "paper";
  } catch {}
  if (url.endsWith(".pdf")) return "paper";
  return fallback;
}

// --- Page Save (with auth headers) ---
async function handleSavePage(data) {
  try {
    const config = await getConfig();
    const headers = buildAuthHeaders(config);
    const type = data.type || detectType(data.url);

    const body = {
      url: data.url,
      type,
      tags: data.tags || [],
    };
    if (data.collection_id) body.collection_id = data.collection_id;

    const resp = await fetch(`${config.apiUrl}/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("[Stoa] Ingest failed:", resp.status, text);
      return { success: false, error: `API ${resp.status}` };
    }

    const result = await resp.json();
    return { success: true, item: result.item };
  } catch (err) {
    console.error("[Stoa] Save page error:", err);
    return { success: false, error: err.message };
  }
}

// --- Tab Group Management ---
async function saveCurrentTabGroup() {
  const config = await getConfig();
  if (!config.userId) return { success: false, error: "Not authenticated" };

  // Get current tab to find its group
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab) return { success: false, error: "No active tab" };

  let groupName = "Saved Tabs";
  let tabsToSave;

  if (activeTab.groupId === -1) {
    // No group — save all tabs in window
    tabsToSave = await chrome.tabs.query({ currentWindow: true });
  } else {
    // Get all tabs in this group
    tabsToSave = await chrome.tabs.query({
      currentWindow: true,
      groupId: activeTab.groupId,
    });
    try {
      const group = await chrome.tabGroups.get(activeTab.groupId);
      groupName = group.title || "Untitled Group";
    } catch (e) {
      // tabGroups API may fail
    }
  }

  const tabData = tabsToSave.map((t) => ({
    url: t.url,
    title: t.title,
    favicon_url: t.favIconUrl,
  }));

  const groupPayload = {
    name: groupName,
    tabs: tabData,
    created_at: new Date().toISOString(),
  };

  // Store locally
  const key = `tabgroup:${groupName}:${Date.now()}`;
  await chrome.storage.local.set({ [key]: groupPayload });

  // Save each tab's URL to the API as an item
  const headers = buildAuthHeaders(config);
  try {
    for (const tab of tabData) {
      if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) continue;
      await fetch(`${config.apiUrl}/ingest`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          url: tab.url,
          type: detectType(tab.url, "page"),
          tags: [`tab-group:${groupName}`],
        }),
      });
    }
  } catch (err) {
    console.error("[Stoa] Failed to save tab group to API:", err);
    return { success: false, error: err.message };
  }

  return { success: true, name: groupName, count: tabData.length };
}

async function restoreTabGroup(groupData) {
  const tabIds = [];
  for (const tab of groupData.tabs) {
    const newTab = await chrome.tabs.create({ url: tab.url });
    tabIds.push(newTab.id);
  }

  if (tabIds.length > 0) {
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: groupData.name,
      color: groupData.chrome_group_color || "blue",
    });
  }
}

// --- Scroll Sync to Backend ---
async function handleSyncScroll(data) {
  if (!data.item_id || !data.scroll_position) return;
  try {
    const config = await getConfig();
    const headers = buildAuthHeaders(config);
    await fetch(`${config.apiUrl}/items/${data.item_id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ scroll_position: data.scroll_position }),
    });
  } catch (err) {
    console.error("[Stoa] Scroll sync failed:", err);
  }
}

// --- Engagement Sync to Backend ---
async function handleSyncEngagement(data) {
  if (!data.item_id || !data.session) return;
  try {
    const config = await getConfig();
    const headers = buildAuthHeaders(config);

    // Get current engagement data
    const getResp = await fetch(`${config.apiUrl}/items/${data.item_id}`, { headers });
    if (!getResp.ok) return;
    const itemData = await getResp.json();
    const existing = itemData.item?.metadata?.engagement || {
      total_time_ms: 0,
      max_depth_pct: 0,
      visit_count: 0,
      total_highlights: 0,
      sessions: [],
    };

    // Merge session
    existing.total_time_ms += data.session.time_ms || 0;
    existing.max_depth_pct = Math.max(existing.max_depth_pct, data.session.depth_pct || 0);
    existing.total_highlights += data.session.highlights || 0;
    existing.visit_count += 1;
    existing.sessions.push(data.session);
    // Keep only last 20 sessions
    if (existing.sessions.length > 20) {
      existing.sessions = existing.sessions.slice(-20);
    }

    // Update metadata
    const currentMetadata = itemData.item?.metadata || {};
    currentMetadata.engagement = existing;

    // Unfortunately we can't PATCH metadata directly via items endpoint.
    // Use a dedicated call or store engagement separately.
    // For now, we'll use a direct supabase-style approach via a custom endpoint.
    // Falling back to storing in chrome.storage.local until backend supports it.
    const storageKey = `engagement:${data.item_id}`;
    await chrome.storage.local.set({ [storageKey]: existing });
  } catch (err) {
    console.error("[Stoa] Engagement sync failed:", err);
  }
}

// --- Keyboard Shortcuts ---
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-sidebar") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      // Try sending to existing content script
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR" });
    } catch (e) {
      // Content script not injected (PDF pages, etc.) — inject it first
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["src/content/content.js"],
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ["src/content/content.css"],
        });
        // Wait for init, then toggle
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR" });
        }, 500);
      } catch (e2) {
        console.error("[Stoa] Cannot inject into this page:", e2);
      }
    }
    return;
  }
  if (command === "save-page") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) return;
    const config = await getConfig();
    if (!config.userId) return;

    const result = await handleSavePage({
      url: tab.url,
      type: detectType(tab.url),
    });

    // Flash badge briefly to confirm
    if (result.success) {
      chrome.action.setBadgeText({ text: "\u2713", tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: "#15803D", tabId: tab.id });
      setTimeout(() => {
        const count = tabBadgeCounts[tab.id] || 0;
        chrome.action.setBadgeText({
          text: count > 0 ? String(count) : "",
          tabId: tab.id,
        });
        chrome.action.setBadgeBackgroundColor({ color: "#C2410C", tabId: tab.id });
      }, 2000);
    }
  } else if (command === "save-tab-group") {
    saveCurrentTabGroup();
  }
});

// --- Context Menu ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "stoa-save-page",
    title: "Save to Stoa",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: "stoa-save-link",
    title: "Save link to Stoa",
    contexts: ["link"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const config = await getConfig();
  if (!config.userId) return;

  if (info.menuItemId === "stoa-save-page") {
    handleSavePage({ url: tab.url, type: detectType(tab.url) });
  } else if (info.menuItemId === "stoa-save-link") {
    handleSavePage({ url: info.linkUrl, type: detectType(info.linkUrl) });
  }
});
