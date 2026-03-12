/**
 * Stoa Popup Script
 * - Auto-detect page title and type
 * - Tag input with autocomplete from saved tags
 * - Save page with proper auth
 * - Show "Saved" state with link to webapp item
 * - Settings gear opens options page
 */

let stoaWebapp = "http://localhost:3000";
let tags = [];
let allKnownTags = []; // for autocomplete
let activeSuggestionIdx = -1;

// --- Init ---
async function init() {
  const stored = await chrome.storage.local.get([
    "stoa_user_id",
    "stoa_webapp_url",
    "stoa_known_tags",
  ]);

  if (stored.stoa_webapp_url) stoaWebapp = stored.stoa_webapp_url;
  allKnownTags = stored.stoa_known_tags || [];

  if (stored.stoa_user_id) {
    document.getElementById("setup-view").style.display = "none";
    document.getElementById("main-view").style.display = "block";
    detectPageInfo();
    checkIfSaved();
  } else {
    document.getElementById("setup-view").style.display = "block";
    document.getElementById("main-view").style.display = "none";
  }
}

// --- Settings ---
document.getElementById("settings-btn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// --- Setup ---
document.getElementById("save-user-btn").addEventListener("click", async () => {
  const userId = document.getElementById("user-id-input").value.trim();
  if (userId) {
    await chrome.storage.local.set({ stoa_user_id: userId });
    init();
  }
});

// --- Detect page info ---
async function detectPageInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // Show page title
  const titleEl = document.getElementById("page-title");
  titleEl.textContent = tab.title || "Untitled";

  // Auto-detect type from URL
  const url = tab.url || "";
  const typeSelect = document.getElementById("type-select");
  if (url.includes("arxiv.org")) typeSelect.value = "paper";
  else if (url.includes("youtube.com") || url.includes("youtu.be")) typeSelect.value = "video";
  else if (url.includes("twitter.com") || url.includes("x.com")) typeSelect.value = "tweet";
  else if (url.includes("podcasts.apple.com") || url.includes("open.spotify.com/episode")) typeSelect.value = "podcast";
}

// --- Check if current page is saved ---
async function checkIfSaved() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const statusEl = document.getElementById("status");
  const key = `saved:${tab.url}`;
  const stored = await chrome.storage.local.get([key, `saved_item_id:${tab.url}`]);

  if (stored[key]) {
    statusEl.className = "status saved";
    const itemId = stored[`saved_item_id:${tab.url}`];
    if (itemId) {
      statusEl.innerHTML = "";
      const checkmark = document.createTextNode("Saved \u2713 ");
      statusEl.appendChild(checkmark);
      const link = document.createElement("a");
      link.href = `${stoaWebapp}/item/${itemId}`;
      link.textContent = "View in Stoa";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: link.href });
      });
      statusEl.appendChild(link);
    } else {
      statusEl.textContent = "Saved \u2713";
    }
    document.getElementById("save-btn").textContent = "Saved \u2713";
    document.getElementById("save-btn").disabled = true;
  }
}

// --- Save Page ---
document.getElementById("save-btn").addEventListener("click", async () => {
  const stored = await chrome.storage.local.get("stoa_user_id");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !stored.stoa_user_id) return;

  const type = document.getElementById("type-select").value;
  const statusEl = document.getElementById("status");
  const saveBtn = document.getElementById("save-btn");

  statusEl.className = "status saving";
  statusEl.textContent = "Saving...";
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  chrome.runtime.sendMessage(
    {
      type: "SAVE_PAGE",
      payload: {
        url: tab.url,
        user_id: stored.stoa_user_id,
        type,
        tags,
      },
    },
    (response) => {
      if (response?.success) {
        statusEl.className = "status saved";
        const itemId = response.item?.id;

        statusEl.innerHTML = "";
        const checkmark = document.createTextNode("Saved \u2713 ");
        statusEl.appendChild(checkmark);
        if (itemId) {
          const link = document.createElement("a");
          link.href = `${stoaWebapp}/item/${itemId}`;
          link.textContent = "View in Stoa";
          link.addEventListener("click", (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: link.href });
          });
          statusEl.appendChild(link);
        }

        saveBtn.textContent = "Saved \u2713";

        // Persist saved state
        const saveData = { [`saved:${tab.url}`]: true };
        if (itemId) saveData[`saved_item_id:${tab.url}`] = itemId;
        chrome.storage.local.set(saveData);

        // Remember tags for autocomplete
        if (tags.length > 0) {
          const merged = [...new Set([...allKnownTags, ...tags])];
          chrome.storage.local.set({ stoa_known_tags: merged });
        }
      } else {
        statusEl.className = "status unsaved";
        statusEl.textContent = "Failed to save";
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Page";
      }
    }
  );
});

// --- Open Webapp ---
document.getElementById("open-btn").addEventListener("click", () => {
  chrome.tabs.create({ url: stoaWebapp });
});

// --- Tab Group ---
document.getElementById("tabgroup-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "SAVE_TAB_GROUP" });
  const btn = document.getElementById("tabgroup-btn");
  btn.textContent = "Tab group saved!";
  setTimeout(() => {
    btn.textContent = "Save Tab Group";
  }, 2000);
});

// --- Tags with Autocomplete ---
const tagInput = document.getElementById("tag-input");
const suggestionsEl = document.getElementById("tag-suggestions");

tagInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    if (activeSuggestionIdx >= 0) {
      const items = suggestionsEl.querySelectorAll(".tag-suggestion");
      if (items[activeSuggestionIdx]) {
        addTag(items[activeSuggestionIdx].textContent);
        hideSuggestions();
        return;
      }
    }
    const value = tagInput.value.replace(/^#/, "").trim();
    if (value) addTag(value);
    tagInput.value = "";
    hideSuggestions();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    navigateSuggestions(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    navigateSuggestions(-1);
  } else if (e.key === "Escape") {
    hideSuggestions();
  }
});

tagInput.addEventListener("input", () => {
  const query = tagInput.value.replace(/^#/, "").trim().toLowerCase();
  if (query.length === 0) {
    hideSuggestions();
    return;
  }
  const matches = allKnownTags.filter(
    (t) => t.toLowerCase().includes(query) && !tags.includes(t)
  );
  if (matches.length === 0) {
    hideSuggestions();
    return;
  }
  showSuggestions(matches.slice(0, 6));
});

function showSuggestions(items) {
  suggestionsEl.innerHTML = "";
  activeSuggestionIdx = -1;
  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "tag-suggestion";
    div.textContent = item;
    div.addEventListener("click", () => {
      addTag(item);
      tagInput.value = "";
      hideSuggestions();
    });
    suggestionsEl.appendChild(div);
  });
  suggestionsEl.classList.add("visible");
}

function hideSuggestions() {
  suggestionsEl.classList.remove("visible");
  activeSuggestionIdx = -1;
}

function navigateSuggestions(dir) {
  const items = suggestionsEl.querySelectorAll(".tag-suggestion");
  if (items.length === 0) return;
  if (activeSuggestionIdx >= 0) items[activeSuggestionIdx].classList.remove("active");
  activeSuggestionIdx = (activeSuggestionIdx + dir + items.length) % items.length;
  items[activeSuggestionIdx].classList.add("active");
}

function addTag(value) {
  value = value.trim();
  if (!value || tags.includes(value)) return;
  tags.push(value);
  renderTags();
}

function renderTags() {
  const container = document.getElementById("tags-container");
  // Remove existing tag elements (not the input)
  container.querySelectorAll(".tag").forEach((t) => t.remove());

  tags.forEach((tag) => {
    const el = document.createElement("span");
    el.className = "tag";

    // XSS-safe: use textContent, not innerHTML
    const label = document.createElement("span");
    label.textContent = `#${tag}`;
    el.appendChild(label);

    const removeBtn = document.createElement("span");
    removeBtn.className = "remove";
    removeBtn.textContent = "\u00d7";
    removeBtn.addEventListener("click", () => {
      tags = tags.filter((t) => t !== tag);
      renderTags();
    });
    el.appendChild(removeBtn);

    container.insertBefore(el, tagInput);
  });
}

init();
