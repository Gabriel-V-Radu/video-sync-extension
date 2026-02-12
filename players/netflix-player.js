let player = null;
let isSyncing = false;
let isPrimaryPlayer = false;
let isPlayerSetup = false;
let seekDebounceTimer = null;
let lastKnownTime = 0;
let syncCheckInterval = null;

// Helper to check if extension context is still valid
function isExtensionContextValid() {
  try {
    return chrome.runtime?.id !== undefined;
  } catch (e) {
    return false;
  }
}

function init() {
  // Skip initialization in sandboxed iframes
  try {
    if (
      window.location.href === "about:blank" ||
      window.frameElement?.hasAttribute("sandbox")
    ) {
      return;
    }
  } catch (e) {
    // Cross-origin check failed, might be sandboxed
    return;
  }

  // Try to find player immediately
  findPlayer();

  if (player) {
    setupPlayer();
  } else {
    // Set up MutationObserver to detect player when it's added
    const observer = new MutationObserver(() => {
      if (!player) {
        findPlayer();
        if (player) {
          observer.disconnect();
          setupPlayer();
        }
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Keep checking for player with extended timeout
    let attempts = 0;
    const checkPlayer = setInterval(() => {
      findPlayer();
      attempts++;

      if (player) {
        clearInterval(checkPlayer);
        observer.disconnect();
        setupPlayer();
      } else if (attempts > 60) {
        console.log("Netflix player not found after 60 seconds");
        clearInterval(checkPlayer);
        observer.disconnect();
      }
    }, 1000);
  }

  // Register tab (only from main page, not iframes)
  if (window === window.top) {
    chrome.runtime
      .sendMessage({
        type: "REGISTER_TAB",
        site: "netflix",
        url: window.location.href,
      })
      .catch((err) => console.error("Failed to register tab:", err));
  }
}

function findPlayer() {
  // Netflix typically uses a video element directly in the DOM
  const video = document.querySelector("video");
  if (video) {
    player = video;
  }
}

function setupPlayer() {
  if (!player || isPlayerSetup) {
    return;
  }

  isPlayerSetup = true;

  // Track time changes to detect seek deltas
  player.addEventListener("timeupdate", () => {
    lastKnownTime = player.currentTime;
  });

  player.addEventListener("play", () => {
    sendPlayerAction({ type: "play" });
  });

  player.addEventListener("pause", () => {
    sendPlayerAction({ type: "pause" });
  });

  player.addEventListener("seeked", () => {
    // Debounce seek events to prevent spam
    clearTimeout(seekDebounceTimer);
    seekDebounceTimer = setTimeout(() => {
      // Send current absolute position
      sendPlayerAction({
        type: "seek",
        primaryTime: player.currentTime,
      });

      lastKnownTime = player.currentTime;
    }, 300);
  });

  player.addEventListener("ratechange", () => {
    sendPlayerAction({
      type: "ratechange",
      rate: player.playbackRate,
    });
  });
}

function sendPlayerAction(action) {
  // Only send actions if we're syncing AND we're the primary player
  if (!isSyncing || !isPrimaryPlayer) return;

  // Check if extension context is still valid
  if (!isExtensionContextValid()) {
    console.log('Extension context invalidated, stopping sync');
    isSyncing = false;
    isPrimaryPlayer = false;
    stopPeriodicSync();
    return;
  }

  chrome.runtime
    .sendMessage({
      type: "PLAYER_ACTION",
      action: action,
    })
    .catch((err) => {
      if (!isExtensionContextValid()) {
        console.log('Extension context invalidated, stopping sync');
        isSyncing = false;
        isPrimaryPlayer = false;
        stopPeriodicSync();
      } else {
        console.error("Failed to send player action:", err);
      }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SYNC_ACTION") {
    handleSyncAction(message.action);
    sendResponse({ success: true });
  } else if (message.type === "ENABLE_SYNC") {
    // Handle async player detection
    handleEnableSync(message, sendResponse);
    return true; // Keep channel open for async response
  } else if (message.type === "DISABLE_SYNC") {
    isSyncing = false;
    isPrimaryPlayer = false;
    stopPeriodicSync();
    sendResponse({ success: true });
  } else if (message.type === "GET_VIDEO_INFO") {
    sendResponse({
      title: document.title,
      url: window.location.href,
      hasPlayer: !!player,
    });
  }
  return true;
});

function handleEnableSync(message, sendResponse) {
  // If player already exists, respond immediately
  if (player) {
    enableSyncWithPlayer(message);
    sendResponse({ success: true, playerReady: true });
    return;
  }

  // Player not found yet, wait up to 3 seconds for detection
  console.log('Netflix player: Waiting for player detection...');
  const waitStart = Date.now();
  const maxWait = 3000; // 3 seconds

  const checkInterval = setInterval(() => {
    if (player || Date.now() - waitStart >= maxWait) {
      clearInterval(checkInterval);

      if (player) {
        console.log('Netflix player: Player detected during wait');
        enableSyncWithPlayer(message);
        sendResponse({ success: true, playerReady: true });
      } else {
        console.log('Netflix player: Player not found after waiting (page may not have a video player)');
        // Still enable sync in case player loads later
        isSyncing = true;
        isPrimaryPlayer = message.isPrimary || false;
        sendResponse({ success: true, playerReady: false });
      }
    }
  }, 100); // Check every 100ms
}

function enableSyncWithPlayer(message) {
  isSyncing = true;
  isPrimaryPlayer = message.isPrimary || false;
  console.log(
    `Netflix player enabled as ${isPrimaryPlayer ? "PRIMARY" : "SECONDARY"}`,
  );

  // Report current time to calculate offset
  if (isExtensionContextValid()) {
    chrome.runtime.sendMessage({
      type: "REPORT_TIME",
      currentTime: player.currentTime,
    }).catch(err => {
      if (!isExtensionContextValid()) {
        console.log('Extension context invalidated');
      } else {
        console.error('Failed to report time:', err);
      }
    });
  }

  // Start periodic sync check if primary
  if (isPrimaryPlayer) {
    startPeriodicSync();
  }
}

function handleSyncAction(action) {
  if (!player) return;

  // Clear any pending seek debounce timer
  clearTimeout(seekDebounceTimer);

  switch (action.type) {
    case "play":
      player.play().catch((err) => console.error("Play failed:", err));
      break;
    case "pause":
      player.pause();
      break;
    case "seek":
      // Calculate target time: primary time + offset
      if (action.primaryTime !== undefined && action.timeOffset !== undefined) {
        const targetTime = action.primaryTime + action.timeOffset;
        if (Math.abs(player.currentTime - targetTime) > 0.5) {
          player.currentTime = targetTime;
        }
      }
      break;
    case "ratechange":
      if (Math.abs(player.playbackRate - action.rate) > 0.01) {
        player.playbackRate = action.rate;
      }
      break;
    case "timesync":
      // Periodic sync check from primary - maintain offset
      if (action.primaryTime !== undefined && action.timeOffset !== undefined) {
        const targetTime = action.primaryTime + action.timeOffset;
        const drift = Math.abs(player.currentTime - targetTime);

        if (drift > 0.5) {
          console.log(`Correcting offset drift of ${drift.toFixed(2)}s`);
          player.currentTime = targetTime;
        }

        // Sync playback state
        if (action.paused && !player.paused) {
          player.pause();
        } else if (!action.paused && player.paused) {
          player.play().catch((err) => console.error("Play failed:", err));
        }

        // Sync playback rate
        if (action.rate && Math.abs(player.playbackRate - action.rate) > 0.01) {
          player.playbackRate = action.rate;
        }
      }
      break;
  }
}

function startPeriodicSync() {
  stopPeriodicSync();
  syncCheckInterval = setInterval(() => {
    if (player) {
      sendPlayerAction({
        type: "timesync",
        primaryTime: player.currentTime,
        paused: player.paused,
        rate: player.playbackRate,
      });
    }
  }, 2000);
}

function stopPeriodicSync() {
  if (syncCheckInterval) {
    clearInterval(syncCheckInterval);
    syncCheckInterval = null;
  }
}

init();
