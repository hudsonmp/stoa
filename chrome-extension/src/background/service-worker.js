/**
 * Stoa Service Worker (Manifest V3)
 * - Handle messages from content scripts
 * - Manage tab groups save/restore
 * - Context menus
 * - Keyboard shortcuts
 */

const STOA_API = "http://localhost:8000";

// --- Message Handling ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "SAVE_HIGHLIGHT":
      handleSaveHighlight(message.payload).then(sendResponse);
      return true;

    case "GET_HIGHLIGHTS":
      handleGetHighlights(message.payload).then(sendResponse);
      return true;

    case "SAVE_SCROLL":
      handleSaveScroll(message.payload);
      return false;

    case "GET_SCROLL":
      handleGetScroll(message.payload).then(sendResponse);
      return true;

    case "SAVE_PAGE":
      handleSavePage(message.payload).then(sendResponse);
      return true;
  }
});

// --- Highlight Management ---
async function handleSaveHighlight(data) {
  try {
    // Store locally for quick re-injection
    const key = `highlights:${data.url}`;
    const stored = await chrome.storage.local.get(key);
    const highlights = stored[key] || [];
    highlights.push({
      text: data.text,
      context: data.context,
      css_selector: data.css_selector,
      color: data.color,
      note: data.note,
      created_at: new Date().toISOString(),
    });
    await chrome.storage.local.set({ [key]: highlights });

    // Also send to API for persistence
    // (The content script already calls /ingest, so the item should exist)
    return { success: true };
  } catch (err) {
    console.error("[Stoa] Save highlight error:", err);
    return { success: false, error: err.message };
  }
}

async function handleGetHighlights(data) {
  const key = `highlights:${data.url}`;
  const stored = await chrome.storage.local.get(key);
  return { highlights: stored[key] || [] };
}

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

// --- Page Save ---
async function handleSavePage(data) {
  try {
    const resp = await fetch(`${STOA_API}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await resp.json();
    return { success: true, item: result.item };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// --- Tab Group Management ---
async function saveCurrentTabGroup() {
  const stored = await chrome.storage.local.get("stoa_user_id");
  const userId = stored.stoa_user_id;
  if (!userId) return;

  // Get current tab to find its group
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || activeTab.groupId === -1) {
    // No group — save all tabs in window
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const tabData = tabs.map((t) => ({
      url: t.url,
      title: t.title,
      favicon_url: t.favIconUrl,
    }));

    await chrome.storage.local.set({
      [`tabgroup:ungrouped:${Date.now()}`]: {
        name: "Saved Tabs",
        tabs: tabData,
        created_at: new Date().toISOString(),
      },
    });
    return;
  }

  // Get all tabs in this group
  const groupTabs = await chrome.tabs.query({
    currentWindow: true,
    groupId: activeTab.groupId,
  });

  const group = await chrome.tabGroups.get(activeTab.groupId);

  const tabData = groupTabs.map((t) => ({
    url: t.url,
    title: t.title,
    favicon_url: t.favIconUrl,
  }));

  const groupData = {
    name: group.title || "Untitled Group",
    tabs: tabData,
    chrome_group_color: group.color,
    created_at: new Date().toISOString(),
  };

  // Store locally
  const key = `tabgroup:${group.title || "untitled"}:${Date.now()}`;
  await chrome.storage.local.set({ [key]: groupData });

  // Also send to API
  try {
    // This would go to Supabase via the API
    console.log("[Stoa] Tab group saved:", groupData.name, tabData.length, "tabs");
  } catch (err) {
    console.error("[Stoa] Failed to save tab group:", err);
  }
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

// --- Keyboard Shortcuts ---
chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case "save-page":
      chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
        if (!tab) return;
        const stored = await chrome.storage.local.get("stoa_user_id");
        if (!stored.stoa_user_id) return;
        handleSavePage({
          url: tab.url,
          user_id: stored.stoa_user_id,
          type: "blog",
        });
      });
      break;

    case "save-tab-group":
      saveCurrentTabGroup();
      break;
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
  const stored = await chrome.storage.local.get("stoa_user_id");
  if (!stored.stoa_user_id) return;

  if (info.menuItemId === "stoa-save-page") {
    handleSavePage({
      url: tab.url,
      user_id: stored.stoa_user_id,
      type: "blog",
    });
  } else if (info.menuItemId === "stoa-save-link") {
    handleSavePage({
      url: info.linkUrl,
      user_id: stored.stoa_user_id,
      type: "blog",
    });
  }
});
