let player = null;
let isSyncing = false;
let isPrimaryPlayer = false;
let isPlayerSetup = false;
let seekDebounceTimer = null;
let lastKnownTime = 0;
let syncCheckInterval = null;
let playerMonitorInterval = null;

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
        console.log("Generic player not found after 60 seconds");
        clearInterval(checkPlayer);
        observer.disconnect();
      }
    }, 1000);
  }

  // Register tab (only from main page, not iframes)
  if (window === window.top && isExtensionContextValid()) {
    chrome.runtime
      .sendMessage({
        type: "REGISTER_TAB",
        site: "generic",
        url: window.location.href,
      })
      .catch((err) => {
        if (!isExtensionContextValid()) {
          console.log("Extension context invalidated, skipping registration");
        } else {
          console.error("Failed to register tab:", err);
        }
      });
  }
}

function findPlayer() {
  const previousPlayer = player;

  // Get all video elements (including Shadow DOM)
  const videos = getAllVideoElements();

  if (videos.length === 0) {
    player = null;
    isPlayerSetup = false;
    return;
  }

  if (videos.length === 1) {
    player = videos[0];
    if (player !== previousPlayer) {
      isPlayerSetup = false;
    }
    return;
  }

  // Score and select best video
  const scored = videos.map((v) => ({
    element: v,
    score: calculateVideoScore(v),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Log scores for debugging
  console.log(
    "Generic player: Found multiple videos, scores:",
    scored.map((s) => ({ score: s.score.toFixed(2), element: s.element })),
  );

  player = scored[0].element;
  if (player !== previousPlayer) {
    isPlayerSetup = false;
  }
}

function getAllVideoElements() {
  const videos = [];

  // Search regular DOM
  const regularVideos = Array.from(document.querySelectorAll("video"));
  videos.push(...regularVideos);

  // Search Shadow DOM recursively
  function searchShadowDOM(root) {
    const elements = root.querySelectorAll("*");
    elements.forEach((el) => {
      if (el.shadowRoot) {
        const shadowVideos = Array.from(el.shadowRoot.querySelectorAll("video"));
        videos.push(...shadowVideos);
        searchShadowDOM(el.shadowRoot);
      }
    });
  }

  searchShadowDOM(document.body || document.documentElement);

  return videos;
}

function calculateVideoScore(video) {
  let score = 0;

  // Get bounding box
  const rect = video.getBoundingClientRect();
  const area = rect.width * rect.height;

  // Size scoring (0-100 points)
  // Larger videos are more likely to be the main player
  const normalizedArea = Math.min(area / (window.innerWidth * window.innerHeight), 1);
  score += normalizedArea * 100;

  // Visibility check (critical - heavily penalize hidden videos)
  if (
    rect.width === 0 ||
    rect.height === 0 ||
    video.offsetParent === null ||
    getComputedStyle(video).display === "none" ||
    getComputedStyle(video).visibility === "hidden" ||
    video.hidden
  ) {
    score -= 200; // Heavily penalize hidden videos
  }

  // Viewport visibility (0-20 points)
  const isInViewport =
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.right <= window.innerWidth;
  if (isInViewport) {
    score += 20;
  } else if (rect.top < window.innerHeight && rect.bottom > 0) {
    // Partially visible
    score += 10;
  }

  // Playing state (0-30 points)
  if (!video.paused) {
    score += 30;
  }

  // Duration (0-25 points)
  // Prefer longer videos (ads are typically short)
  if (video.duration && !isNaN(video.duration) && video.duration > 0) {
    if (video.duration > 300) {
      // > 5 minutes
      score += 25;
    } else if (video.duration > 60) {
      // > 1 minute
      score += 15;
    } else if (video.duration < 30) {
      // < 30 seconds (likely ad)
      score -= 10;
    }
  }

  // Controls attribute (0-15 points)
  if (video.hasAttribute("controls")) {
    score += 15;
  }

  // Position scoring (0-15 points)
  // Centered videos are more likely to be main content
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const viewportCenterX = window.innerWidth / 2;
  const viewportCenterY = window.innerHeight / 2;

  const distanceFromCenter = Math.sqrt(
    Math.pow(centerX - viewportCenterX, 2) + Math.pow(centerY - viewportCenterY, 2),
  );
  const maxDistance = Math.sqrt(
    Math.pow(window.innerWidth / 2, 2) + Math.pow(window.innerHeight / 2, 2),
  );
  const centerScore = (1 - distanceFromCenter / maxDistance) * 15;
  score += centerScore;

  // Z-index (0-10 points)
  const zIndex = parseInt(getComputedStyle(video).zIndex) || 0;
  if (zIndex > 0) {
    score += Math.min(zIndex / 10, 10);
  }

  // Penalty for being in an iframe (main players are often in main document)
  if (window !== window.top) {
    score -= 5;
  }

  return score;
}

function setupPlayer() {
  if (!player || isPlayerSetup) {
    return;
  }

  isPlayerSetup = true;

  console.log("Generic player: Setting up player", player);

  // Start monitoring for player removal/changes
  startPlayerMonitoring();

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

function startPlayerMonitoring() {
  // Periodically check if player is still in DOM and valid
  stopPlayerMonitoring();
  playerMonitorInterval = setInterval(() => {
    const root = document.body || document.documentElement;
    if (player && root && !root.contains(player)) {
      console.log("Generic player: Player removed from DOM, re-detecting");
      player = null;
      isPlayerSetup = false;
      findPlayer();
      if (player) {
        setupPlayer();
      }
    } else if (!player) {
      // Try to find player again (SPA navigation)
      findPlayer();
      if (player) {
        setupPlayer();
      }
    }
  }, 2000);
}

function stopPlayerMonitoring() {
  if (playerMonitorInterval) {
    clearInterval(playerMonitorInterval);
    playerMonitorInterval = null;
  }
}

function sendPlayerAction(action) {
  // Only send actions if we're syncing AND we're the primary player
  if (!isSyncing || !isPrimaryPlayer) return;

  // Check if extension context is still valid
  if (!isExtensionContextValid()) {
    console.log("Extension context invalidated, stopping sync");
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
        console.log("Extension context invalidated, stopping sync");
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
  console.log("Generic player: Waiting for player detection...");
  const waitStart = Date.now();
  const maxWait = 3000; // 3 seconds

  const checkInterval = setInterval(() => {
    if (player || Date.now() - waitStart >= maxWait) {
      clearInterval(checkInterval);

      if (player) {
        console.log("Generic player: Player detected during wait");
        enableSyncWithPlayer(message);
        sendResponse({ success: true, playerReady: true });
      } else {
        console.log("Generic player: Player not found after waiting (page may not have a video player)");
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
    `Generic player enabled as ${isPrimaryPlayer ? "PRIMARY" : "SECONDARY"}`,
  );

  // Report current time to calculate offset
  if (isExtensionContextValid()) {
    chrome.runtime.sendMessage({
      type: "REPORT_TIME",
      currentTime: player.currentTime,
    }).catch((err) => {
      if (!isExtensionContextValid()) {
        console.log("Extension context invalidated");
      } else {
        console.error("Failed to report time:", err);
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
