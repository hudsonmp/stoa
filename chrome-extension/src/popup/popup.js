/**
 * Stoa Popup Script
 */

const STOA_WEBAPP = "http://localhost:3000";
let tags = [];

// --- Init ---
async function init() {
  const stored = await chrome.storage.local.get("stoa_user_id");

  if (stored.stoa_user_id) {
    document.getElementById("setup-view").style.display = "none";
    document.getElementById("main-view").style.display = "block";
    checkIfSaved();
  } else {
    document.getElementById("setup-view").style.display = "block";
    document.getElementById("main-view").style.display = "none";
  }
}

// --- Setup ---
document.getElementById("save-user-btn").addEventListener("click", async () => {
  const userId = document.getElementById("user-id-input").value.trim();
  if (userId) {
    await chrome.storage.local.set({ stoa_user_id: userId });
    init();
  }
});

// --- Check if current page is saved ---
async function checkIfSaved() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const statusEl = document.getElementById("status");
  // Simple check via local storage
  const key = `saved:${tab.url}`;
  const stored = await chrome.storage.local.get(key);
  if (stored[key]) {
    statusEl.className = "status saved";
    statusEl.textContent = "Saved to Stoa";
  }
}

// --- Save Page ---
document.getElementById("save-btn").addEventListener("click", async () => {
  const stored = await chrome.storage.local.get("stoa_user_id");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !stored.stoa_user_id) return;

  const type = document.getElementById("type-select").value;
  const note = document.getElementById("note-input").value.trim();

  const statusEl = document.getElementById("status");
  statusEl.className = "status";
  statusEl.textContent = "Saving...";
  statusEl.style.background = "rgba(99, 102, 241, 0.15)";
  statusEl.style.color = "#6366f1";

  chrome.runtime.sendMessage(
    {
      type: "SAVE_PAGE",
      payload: {
        url: tab.url,
        user_id: stored.stoa_user_id,
        type,
        tags,
        note,
      },
    },
    (response) => {
      if (response?.success) {
        statusEl.className = "status saved";
        statusEl.textContent = "Saved to Stoa";
        chrome.storage.local.set({ [`saved:${tab.url}`]: true });
      } else {
        statusEl.className = "status unsaved";
        statusEl.textContent = "Failed to save";
      }
    }
  );
});

// --- Open Webapp ---
document.getElementById("open-btn").addEventListener("click", () => {
  chrome.tabs.create({ url: STOA_WEBAPP });
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

// --- Tags ---
const tagInput = document.getElementById("tag-input");
tagInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    const value = tagInput.value.replace(/^#/, "").trim();
    if (value && !tags.includes(value)) {
      tags.push(value);
      renderTags();
    }
    tagInput.value = "";
  }
});

function renderTags() {
  const container = document.getElementById("tags-container");
  // Remove existing tag elements
  container.querySelectorAll(".tag").forEach((t) => t.remove());

  tags.forEach((tag) => {
    const el = document.createElement("span");
    el.className = "tag";
    el.innerHTML = `#${tag} <span class="remove">&times;</span>`;
    el.querySelector(".remove").addEventListener("click", () => {
      tags = tags.filter((t) => t !== tag);
      renderTags();
    });
    container.insertBefore(el, tagInput);
  });
}

init();
