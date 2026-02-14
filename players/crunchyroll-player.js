let player = null;
let isSyncing = false;
let isPrimaryPlayer = false;
let isPlayerSetup = false;
let seekDebounceTimer = null;
let lastKnownTime = 0;
let syncCheckInterval = null;
let outboundActionSeq = 0;
let lastAppliedSyncSeq = 0;

// Helper to check if extension context is still valid
function isExtensionContextValid() {
  try {
    return chrome.runtime?.id !== undefined;
  } catch (e) {
    return false;
  }
}

// Detect if we're in the player iframe or main page
const isPlayerFrame = window.location.href.includes('vilos-v2/web/vilos/player.html');
const isMainPage = window.location.href.includes('/watch/') && !isPlayerFrame;

function init() {
  // Only search for player in the player iframe
  if (isPlayerFrame) {
    // Try to find player immediately
    findPlayer();

    if (player) {
      setupPlayer();
    } else {
      // Set up MutationObserver to detect player when it's added to DOM
      const observer = new MutationObserver((mutations) => {
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
        subtree: true
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
          console.error('Crunchyroll player not found after 60 seconds');
          clearInterval(checkPlayer);
          observer.disconnect();
        }
      }, 1000);
    }
  }

  // Only register from main page, not from iframe
  if (isMainPage && isExtensionContextValid()) {
    chrome.runtime.sendMessage({
      type: 'REGISTER_TAB',
      site: 'crunchyroll',
      url: window.location.href
    }).catch(err => {
      if (!isExtensionContextValid()) {
        console.log('Extension context invalidated, skipping registration');
      } else {
        console.error('Failed to register tab:', err);
      }
    });
  }
}

function findPlayer() {
  // Since this script now runs inside the iframe, we can find the video directly
  const video = document.querySelector('video');
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
  player.addEventListener('timeupdate', () => {
    lastKnownTime = player.currentTime;
  });

  player.addEventListener('play', () => {
    sendPlayerAction({ type: 'play' });
  });

  player.addEventListener('pause', () => {
    sendPlayerAction({ type: 'pause' });
  });

  player.addEventListener('seeked', () => {
    // Debounce seek events to prevent spam
    clearTimeout(seekDebounceTimer);
    seekDebounceTimer = setTimeout(() => {
      // Send current absolute position
      sendPlayerAction({
        type: 'seek',
        primaryTime: player.currentTime
      });

      lastKnownTime = player.currentTime;
    }, 300);
  });

  player.addEventListener('ratechange', () => {
    sendPlayerAction({
      type: 'ratechange',
      rate: player.playbackRate
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

  const actionWithMeta = {
    ...action,
    syncSeq: ++outboundActionSeq,
    sentAt: Date.now()
  };

  chrome.runtime.sendMessage({
    type: 'PLAYER_ACTION',
    action: actionWithMeta
  }).catch(err => {
    if (!isExtensionContextValid()) {
      console.log('Extension context invalidated, stopping sync');
      isSyncing = false;
      isPrimaryPlayer = false;
      stopPeriodicSync();
    } else {
      console.error('Failed to send player action:', err);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only the iframe should handle player-related messages
  if (!isPlayerFrame) {
    return false;
  }

  if (message.type === 'SYNC_ACTION') {
    handleSyncAction(message.action);
    sendResponse({ success: true });
  } else if (message.type === 'ENABLE_SYNC') {
    // Handle async player detection
    handleEnableSync(message, sendResponse);
    return true; // Keep channel open for async response
  } else if (message.type === 'DISABLE_SYNC') {
    isSyncing = false;
    isPrimaryPlayer = false;
    outboundActionSeq = 0;
    lastAppliedSyncSeq = 0;
    stopPeriodicSync();
    sendResponse({ success: true });
  } else if (message.type === 'GET_VIDEO_INFO') {
    sendResponse({
      title: document.title,
      url: window.location.href,
      hasPlayer: !!player
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

  // Try to find player first
  findPlayer();

  if (player) {
    setupPlayer();
    enableSyncWithPlayer(message);
    sendResponse({ success: true, playerReady: true });
    return;
  }

  // Player not found yet, wait up to 3 seconds for detection
  console.log('Crunchyroll player: Waiting for player detection...');
  const waitStart = Date.now();
  const maxWait = 3000; // 3 seconds

  const checkInterval = setInterval(() => {
    if (!player) {
      findPlayer();
    }

    if (player || Date.now() - waitStart >= maxWait) {
      clearInterval(checkInterval);

      if (player) {
        console.log('Crunchyroll player: Player detected during wait');
        setupPlayer();
        enableSyncWithPlayer(message);
        sendResponse({ success: true, playerReady: true });
      } else {
        console.log('Crunchyroll player: Player not found after waiting (page may not have a video player)');
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
  outboundActionSeq = 0;
  lastAppliedSyncSeq = 0;
  console.log(`Crunchyroll player enabled as ${isPrimaryPlayer ? 'PRIMARY' : 'SECONDARY'}`);

  // Report current time to calculate offset
  if (isExtensionContextValid()) {
    chrome.runtime.sendMessage({
      type: 'REPORT_TIME',
      currentTime: player.currentTime
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

  if (typeof action?.syncSeq === 'number') {
    if (action.syncSeq <= lastAppliedSyncSeq) {
      return;
    }
    lastAppliedSyncSeq = action.syncSeq;
  }

  // Clear any pending seek debounce timer
  clearTimeout(seekDebounceTimer);

  switch (action.type) {
    case 'play':
      player.play().catch(err => console.error('Play failed:', err));
      break;
    case 'pause':
      player.pause();
      break;
    case 'seek':
      // Calculate target time: primary time + offset
      if (action.primaryTime !== undefined && action.timeOffset !== undefined) {
        const targetTime = action.primaryTime + action.timeOffset;
        if (Math.abs(player.currentTime - targetTime) > 0.5) {
          player.currentTime = targetTime;
        }
      }
      break;
    case 'ratechange':
      if (Math.abs(player.playbackRate - action.rate) > 0.01) {
        player.playbackRate = action.rate;
      }
      break;
    case 'timesync':
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
          player.play().catch(err => console.error('Play failed:', err));
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
        type: 'timesync',
        primaryTime: player.currentTime,
        paused: player.paused,
        rate: player.playbackRate
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
