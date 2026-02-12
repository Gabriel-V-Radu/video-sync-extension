let selectedTabs = [];
let videoTabs = [];

const KNOWN_VIDEO_HOSTS = ["youtube.com", "crunchyroll.com", "netflix.com"];

function isKnownVideoUrl(url = "") {
  return KNOWN_VIDEO_HOSTS.some((host) => url.includes(host));
}

function getTabIcon(url = "") {
  if (url.includes("youtube.com")) return "▶️";
  if (url.includes("crunchyroll.com")) return "🎬";
  if (url.includes("netflix.com")) return "🎥";
  return "🎞️";
}

async function init() {
  await loadVideoTabs();
  await checkSyncStatus();
  setupEventListeners();
}

async function loadVideoTabs() {
  const allTabs = await chrome.tabs.query({});

  // Get registered tabs from background
  const { tabs: registeredTabsData } = await chrome.runtime.sendMessage({
    type: 'GET_REGISTERED_TABS'
  });

  const registeredTabIds = new Set(registeredTabsData.map(t => t.tabId));

  // Filter: registered tabs OR legacy URL check
  videoTabs = allTabs.filter(tab => {
    if (registeredTabIds.has(tab.id)) return true;

    // Legacy URL detection (fallback)
    return isKnownVideoUrl(tab.url);
  });

  renderTabList();
}

function renderTabList() {
  const videoList = document.getElementById("videoList");

  if (videoTabs.length === 0) {
    videoList.innerHTML =
      '<div class="empty">No video tabs found. Open a video on YouTube, Netflix, Crunchyroll, or any other site.</div>';
    return;
  }

  if (videoTabs.length === 1) {
    videoList.innerHTML =
      '<div class="empty">Need at least 2 video tabs. Open another video tab on any supported site.</div>';
    return;
  }

  videoList.innerHTML = "";

  videoTabs.forEach((tab) => {
    const icon = getTabIcon(tab.url);
    const item = createTabItem(tab, icon);
    videoList.appendChild(item);
  });
}

function createTabItem(tab, icon) {
  const div = document.createElement("div");
  div.className = "tab-item";
  div.dataset.tabId = tab.id;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "tab-checkbox";
  checkbox.id = `tab-${tab.id}`;

  const iconSpan = document.createElement("span");
  iconSpan.className = "tab-icon";
  iconSpan.textContent = icon;

  const titleSpan = document.createElement("span");
  titleSpan.className = "tab-title";
  titleSpan.textContent = tab.title;

  const badgeSpan = document.createElement("span");
  badgeSpan.className = "tab-badge";
  badgeSpan.id = `badge-${tab.id}`;
  badgeSpan.style.display = "none";

  div.appendChild(checkbox);
  div.appendChild(iconSpan);
  div.appendChild(titleSpan);
  div.appendChild(badgeSpan);

  div.addEventListener("click", (e) => {
    if (e.target !== checkbox) {
      checkbox.click();
    }
  });

  checkbox.addEventListener("change", () => toggleTab(tab.id));

  return div;
}

function toggleTab(tabId) {
  const index = selectedTabs.indexOf(tabId);

  if (index > -1) {
    selectedTabs.splice(index, 1);
  } else {
    if (selectedTabs.length >= 2) {
      // Uncheck the first selected tab
      const firstTab = selectedTabs.shift();
      const firstCheckbox = document.getElementById(`tab-${firstTab}`);
      if (firstCheckbox) firstCheckbox.checked = false;
    }
    selectedTabs.push(tabId);
  }

  updateBadges();
  updateStartButton();
}

function updateBadges() {
  // Clear all badges first
  videoTabs.forEach((tab) => {
    const badge = document.getElementById(`badge-${tab.id}`);
    if (badge) {
      badge.style.display = "none";
      badge.className = "tab-badge";
      badge.textContent = "";
    }
  });

  // Add badges to selected tabs
  if (selectedTabs.length > 0) {
    const primaryBadge = document.getElementById(`badge-${selectedTabs[0]}`);
    if (primaryBadge) {
      primaryBadge.style.display = "block";
      primaryBadge.className = "tab-badge primary";
      primaryBadge.textContent = "Primary";
    }
  }

  if (selectedTabs.length > 1) {
    const secondaryBadge = document.getElementById(`badge-${selectedTabs[1]}`);
    if (secondaryBadge) {
      secondaryBadge.style.display = "block";
      secondaryBadge.className = "tab-badge secondary";
      secondaryBadge.textContent = "Secondary";
    }
  }
}

function updateStartButton() {
  const startBtn = document.getElementById("startSync");
  startBtn.disabled = selectedTabs.length !== 2;
}

async function checkSyncStatus() {
  const syncState = await chrome.runtime.sendMessage({
    type: "GET_SYNC_STATE",
  });

  if (syncState.isActive) {
    // Pre-select the synced tabs
    if (syncState.tabs.primary && syncState.tabs.secondary) {
      selectedTabs = [syncState.tabs.primary, syncState.tabs.secondary];

      // Check the checkboxes
      const checkbox1 = document.getElementById(
        `tab-${syncState.tabs.primary}`,
      );
      const checkbox2 = document.getElementById(
        `tab-${syncState.tabs.secondary}`,
      );
      if (checkbox1) checkbox1.checked = true;
      if (checkbox2) checkbox2.checked = true;

      // Update badges
      updateBadges();
    }

    showSyncActive(syncState);
  }
}

function showSyncActive(syncState) {
  const status = document.getElementById("status");
  status.style.display = "block";
  status.className = "status active";
  status.innerHTML = "✓ Sync is active! Primary player controls the sync.";

  document.getElementById("startSync").style.display = "none";
  document.getElementById("stopSync").style.display = "block";
}

function setupEventListeners() {
  document.getElementById("startSync").addEventListener("click", startSync);
  document.getElementById("stopSync").addEventListener("click", stopSync);
}

async function startSync() {
  if (selectedTabs.length !== 2) {
    alert("Please select exactly 2 videos to sync");
    return;
  }

  const [tab1, tab2] = selectedTabs;

  try {
    // Set sync state in background
    await chrome.runtime.sendMessage({
      type: "SET_TABS",
      primaryTabId: tab1,
      secondaryTabId: tab2,
    });

    // Enable sync on both tabs with error handling
    // tab1 is primary, tab2 is secondary
    const results = await Promise.allSettled([
      chrome.tabs.sendMessage(tab1, { type: "ENABLE_SYNC", isPrimary: true }),
      chrome.tabs.sendMessage(tab2, { type: "ENABLE_SYNC", isPrimary: false }),
    ]);

    // Check results
    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    // If both failed, show error
    if (successes.length === 0) {
      console.error("Failed to enable sync on both tabs:", failures);
      await chrome.runtime.sendMessage({ type: "STOP_SYNC" });
      alert(
        "Could not connect to video tabs. Please make sure:\n\n1. Both video pages are fully loaded\n2. Videos are playing\n3. Try refreshing the video pages",
      );
      return;
    }

    // If one failed, show warning but continue
    if (failures.length > 0) {
      console.warn("Failed to enable sync on one tab:", failures);
      console.warn("Continuing with partial sync - one tab may not respond");
    }

    // Check if players are ready (only for successful responses)
    const responses = successes.map((r) => r.value);
    const playersNotReady = responses.filter((r) => r && !r.playerReady);

    if (playersNotReady.length > 0) {
      console.warn("Some players are not ready yet:", playersNotReady);
      alert(
        "One or more video players are still loading.\n\nThe extension will try to sync, but you may need to:\n1. Wait for videos to fully load\n2. Click play on both videos\n3. Restart sync if it doesn't work",
      );
      // Don't return, let it try anyway
    }

    console.log("Sync enabled successfully on both tabs");
    showSyncActive({
      tabs: { primary: tab1, secondary: tab2 },
    });
  } catch (error) {
    console.error("Error starting sync:", error);
    alert("Failed to start sync. Please try again.");
  }
}

async function stopSync() {
  const syncState = await chrome.runtime.sendMessage({
    type: "GET_SYNC_STATE",
  });

  if (syncState.tabs.primary) {
    chrome.tabs
      .sendMessage(syncState.tabs.primary, { type: "DISABLE_SYNC" })
      .catch((err) => {
        console.log("Tab may be closed:", err);
      });
  }
  if (syncState.tabs.secondary) {
    chrome.tabs
      .sendMessage(syncState.tabs.secondary, { type: "DISABLE_SYNC" })
      .catch((err) => {
        console.log("Tab may be closed:", err);
      });
  }

  await chrome.runtime.sendMessage({ type: "STOP_SYNC" });

  window.close();
}

init();
