let selectedTabs = [];
let videoTabs = [];
let currentMode = 'local'; // 'local' or 'remote'
let selectedRemoteTab = null;
let remoteConnectionPollInterval = null;

const DEFAULT_SIGNALING_URL = 'ws://localhost:8080';
const SIGNALING_URL_STORAGE_KEY = 'remoteSignalingUrl';

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
  await loadSavedSignalingUrl();
  await loadVideoTabs();
  await checkSyncStatus();
  setupEventListeners();
  setupModeSelector();
}

async function loadSavedSignalingUrl() {
  try {
    const result = await chrome.storage.local.get(SIGNALING_URL_STORAGE_KEY);
    const url = normalizeSignalingUrl(result[SIGNALING_URL_STORAGE_KEY] || DEFAULT_SIGNALING_URL);
    const signalingInput = document.getElementById('signalingUrl');
    if (signalingInput) {
      signalingInput.value = url;
    }
  } catch (error) {
    console.error('Failed to load signaling URL:', error);
  }
}

async function saveSignalingUrl(url) {
  try {
    await chrome.storage.local.set({
      [SIGNALING_URL_STORAGE_KEY]: url
    });
  } catch (error) {
    console.error('Failed to save signaling URL:', error);
  }
}

function normalizeSignalingUrl(rawUrl) {
  const input = (rawUrl || '').trim();
  if (!input) {
    return '';
  }

  let urlValue = input;
  if (!/^wss?:\/\//i.test(urlValue)) {
    urlValue = `wss://${urlValue}`;
  }

  let parsed;
  try {
    parsed = new URL(urlValue);
  } catch (error) {
    return input;
  }

  const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (isLocalHost && parsed.protocol !== 'ws:') {
    parsed.protocol = 'ws:';
  }

  if (!isLocalHost && parsed.protocol !== 'wss:') {
    parsed.protocol = 'wss:';
  }

  return parsed.toString().replace(/\/$/, '');
}

function setupModeSelector() {
  const modeButtons = document.querySelectorAll('.mode-btn');
  
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      switchMode(mode);
    });
  });
}

function switchMode(mode) {
  currentMode = mode;
  
  // Update button states
  document.querySelectorAll('.mode-btn').forEach(btn => {
    if (btn.dataset.mode === mode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Update content visibility
  document.querySelectorAll('.mode-content').forEach(content => {
    content.classList.remove('active');
  });
  
  document.getElementById(`${mode}-mode`).classList.add('active');
  
  // Load appropriate tab lists
  if (mode === 'remote') {
    renderRemoteTabList();
  }
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

function renderRemoteTabList() {
  const videoListRemote = document.getElementById("videoListRemote");

  if (videoTabs.length === 0) {
    videoListRemote.innerHTML =
      '<div class="empty">No video tabs found. Open a video first.</div>';
    return;
  }

  videoListRemote.innerHTML = "";

  videoTabs.forEach((tab) => {
    const icon = getTabIcon(tab.url);
    const item = createRemoteTabItem(tab, icon);
    videoListRemote.appendChild(item);
  });
}

function createRemoteTabItem(tab, icon) {
  const div = document.createElement("div");
  div.className = "tab-item";
  div.dataset.tabId = tab.id;

  if (selectedRemoteTab === tab.id) {
    div.style.background = "#e3f2fd";
    div.style.borderLeft = "3px solid #2196f3";
  }

  const iconSpan = document.createElement("span");
  iconSpan.className = "tab-icon";
  iconSpan.textContent = icon;

  const titleSpan = document.createElement("span");
  titleSpan.className = "tab-title";
  titleSpan.textContent = tab.title;

  div.appendChild(iconSpan);
  div.appendChild(titleSpan);

  div.addEventListener("click", () => {
    selectedRemoteTab = tab.id;
    renderRemoteTabList(); // Re-render to update selection
  });

  return div;
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

  // Check local sync
  if (syncState.mode === 'local' && syncState.local.isActive) {
    if (syncState.local.tabs.primary && syncState.local.tabs.secondary) {
      selectedTabs = [syncState.local.tabs.primary, syncState.local.tabs.secondary];

      const checkbox1 = document.getElementById(`tab-${syncState.local.tabs.primary}`);
      const checkbox2 = document.getElementById(`tab-${syncState.local.tabs.secondary}`);
      if (checkbox1) checkbox1.checked = true;
      if (checkbox2) checkbox2.checked = true;

      updateBadges();
    }

    showSyncActive(syncState.local);
  }

  // Check remote sync
  if (syncState.mode === 'remote' && syncState.remote.isActive) {
    switchMode('remote');
    selectedRemoteTab = syncState.remote.localTabId;

    if (syncState.remote.connectionState === 'connected') {
      showRemoteConnected(syncState.remote);
    } else {
      showRemoteConnecting(syncState.remote.roomId);
      pollRemoteConnection();
    }
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
  // Local sync
  document.getElementById("startSync").addEventListener("click", startSync);
  document.getElementById("stopSync").addEventListener("click", stopSync);
  
  // Remote sync
  document.getElementById("createRoom").addEventListener("click", createRoom);
  document.getElementById("joinRoom").addEventListener("click", joinRoom);
  document.getElementById("stopRemoteSync").addEventListener("click", stopRemoteSync);

  const signalingInput = document.getElementById('signalingUrl');
  signalingInput.addEventListener('change', () => {
    const value = normalizeSignalingUrl(signalingInput.value);
    if (value) {
      signalingInput.value = value;
      saveSignalingUrl(value);
    }
  });
  signalingInput.addEventListener('blur', () => {
    const value = normalizeSignalingUrl(signalingInput.value);
    if (value) {
      signalingInput.value = value;
      saveSignalingUrl(value);
    }
  });
  
  // Auto-uppercase room ID input
  document.getElementById("roomIdInput").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
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

  if (syncState.local.tabs.primary) {
    chrome.tabs
      .sendMessage(syncState.local.tabs.primary, { type: "DISABLE_SYNC" })
      .catch((err) => {
        console.log("Tab may be closed:", err);
      });
  }
  if (syncState.local.tabs.secondary) {
    chrome.tabs
      .sendMessage(syncState.local.tabs.secondary, { type: "DISABLE_SYNC" })
      .catch((err) => {
        console.log("Tab may be closed:", err);
      });
  }

  await chrome.runtime.sendMessage({ type: "STOP_SYNC" });

  window.close();
}

// Remote sync functions
async function createRoom() {
  if (!selectedRemoteTab) {
    alert("Please select a video tab first");
    return;
  }

  const signalingInput = document.getElementById("signalingUrl");
  const signalingUrl = normalizeSignalingUrl(signalingInput.value);
  if (!signalingUrl) {
    alert("Please enter a signaling server URL");
    return;
  }

  signalingInput.value = signalingUrl;

  await saveSignalingUrl(signalingUrl);

  // Show connecting state
  showRemoteConnecting();

  try {
    // Enable sync on selected tab
    await chrome.tabs.sendMessage(selectedRemoteTab, { 
      type: "ENABLE_SYNC", 
      isPrimary: true 
    });

    // Create room via background
    const result = await chrome.runtime.sendMessage({
      type: "REMOTE_CREATE_ROOM",
      tabId: selectedRemoteTab,
      signalingUrl: signalingUrl
    });

    if (result.success) {
      document.getElementById("displayRoomId").textContent = result.roomId;
      document.getElementById("connectingRoomId").textContent = result.roomId;
      
      // Poll for connection status
      pollRemoteConnection();
    } else {
      throw new Error(result.error || "Failed to create room");
    }
  } catch (error) {
    console.error("Error creating room:", error);
    alert(`Failed to create room: ${error.message}\n\nMake sure the signaling server is running.`);
    hideRemoteConnecting();
  }
}

async function joinRoom() {
  if (!selectedRemoteTab) {
    alert("Please select a video tab first");
    return;
  }

  const roomId = document.getElementById("roomIdInput").value.trim().toUpperCase();
  if (!roomId || roomId.length !== 6) {
    alert("Please enter a valid 6-character room code");
    return;
  }

  const signalingInput = document.getElementById("signalingUrl");
  const signalingUrl = normalizeSignalingUrl(signalingInput.value);
  if (!signalingUrl) {
    alert("Please enter a signaling server URL");
    return;
  }

  signalingInput.value = signalingUrl;

  await saveSignalingUrl(signalingUrl);

  // Show connecting state
  document.getElementById("connectingRoomId").textContent = roomId;
  showRemoteConnecting();

  try {
    // Enable sync on selected tab
    await chrome.tabs.sendMessage(selectedRemoteTab, { 
      type: "ENABLE_SYNC", 
      isPrimary: true 
    });

    // Join room via background
    const result = await chrome.runtime.sendMessage({
      type: "REMOTE_JOIN_ROOM",
      tabId: selectedRemoteTab,
      roomId: roomId,
      signalingUrl: signalingUrl
    });

    if (result.success) {
      document.getElementById("displayRoomId").textContent = result.roomId;
      
      // Poll for connection status
      pollRemoteConnection();
    } else {
      throw new Error(result.error || "Failed to join room");
    }
  } catch (error) {
    console.error("Error joining room:", error);
    alert(`Failed to join room: ${error.message}\n\nMake sure:\n- The signaling server is running\n- The room code is correct\n- Your partner created the room`);
    hideRemoteConnecting();
  }
}

async function pollRemoteConnection() {
  if (remoteConnectionPollInterval) {
    clearInterval(remoteConnectionPollInterval);
  }

  remoteConnectionPollInterval = setInterval(async () => {
    if (document.hidden) {
      return;
    }

    const syncState = await chrome.runtime.sendMessage({
      type: "GET_SYNC_STATE",
    });

    if (syncState.remote.connectionState === 'connected') {
      clearInterval(remoteConnectionPollInterval);
      remoteConnectionPollInterval = null;
      showRemoteConnected(syncState.remote);
      return;
    }

    if (syncState.mode !== 'remote' || !syncState.remote.isActive) {
      clearInterval(remoteConnectionPollInterval);
      remoteConnectionPollInterval = null;
      hideRemoteConnecting();
      return;
    }

    if (syncState.remote.connectionState === 'disconnected') {
      clearInterval(remoteConnectionPollInterval);
      remoteConnectionPollInterval = null;
      alert("Connection failed or timed out. Please try again.");
      hideRemoteConnecting();
    }
  }, 1000);
}

function showRemoteConnecting(roomId = '') {
  document.getElementById("remoteActions").style.display = "none";
  document.getElementById("remoteConnecting").style.display = "block";
  document.getElementById("remoteConnected").style.display = "none";

  if (roomId) {
    document.getElementById("connectingRoomId").textContent = roomId;
  }
}

function hideRemoteConnecting() {
  document.getElementById("remoteActions").style.display = "block";
  document.getElementById("remoteConnecting").style.display = "none";
  document.getElementById("remoteConnected").style.display = "none";
}

function showRemoteConnected(remoteState) {
  document.getElementById("remoteActions").style.display = "none";
  document.getElementById("remoteConnecting").style.display = "none";
  document.getElementById("remoteConnected").style.display = "block";
  
  if (remoteState.roomId) {
    document.getElementById("displayRoomId").textContent = remoteState.roomId;
  }
}

async function stopRemoteSync() {
  if (remoteConnectionPollInterval) {
    clearInterval(remoteConnectionPollInterval);
    remoteConnectionPollInterval = null;
  }

  // Disable sync on tab
  if (selectedRemoteTab) {
    chrome.tabs
      .sendMessage(selectedRemoteTab, { type: "DISABLE_SYNC" })
      .catch((err) => {
        console.log("Tab may be closed:", err);
      });
  }

  await chrome.runtime.sendMessage({ type: "REMOTE_STOP" });

  window.close();
}

init();

window.addEventListener('beforeunload', () => {
  if (remoteConnectionPollInterval) {
    clearInterval(remoteConnectionPollInterval);
    remoteConnectionPollInterval = null;
  }
});
