/**
 * Stoa Options Page
 * - Persist API URL, user ID, auth token, webapp URL, theme
 * - Reset all local data
 */

const FIELDS = {
  "api-url": { key: "stoa_api_url", default: "http://localhost:8000" },
  "user-id": { key: "stoa_user_id", default: "" },
  "auth-token": { key: "stoa_token", default: "" },
  "webapp-url": { key: "stoa_webapp_url", default: "http://localhost:3000" },
  "theme-select": { key: "stoa_theme", default: "light" },
};

// --- Load saved settings ---
async function loadSettings() {
  const keys = Object.values(FIELDS).map((f) => f.key);
  const stored = await chrome.storage.local.get(keys);

  for (const [elId, field] of Object.entries(FIELDS)) {
    const el = document.getElementById(elId);
    if (el) {
      el.value = stored[field.key] || field.default;
    }
  }
}

// --- Save settings ---
document.getElementById("save-btn").addEventListener("click", async () => {
  const data = {};
  for (const [elId, field] of Object.entries(FIELDS)) {
    const el = document.getElementById(elId);
    if (el) {
      data[field.key] = el.value.trim() || field.default;
    }
  }
  await chrome.storage.local.set(data);
  showToast("Settings saved");
});

// --- Reset ---
document.getElementById("reset-btn").addEventListener("click", async () => {
  if (!confirm("This will clear all Stoa local data (saved pages, highlights, scroll positions, settings). Continue?")) {
    return;
  }
  await chrome.storage.local.clear();
  loadSettings();
  showToast("All data cleared");
});

// --- Toast ---
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2000);
}

loadSettings();
