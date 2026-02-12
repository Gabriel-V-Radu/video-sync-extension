// Sync modes: 'local' or 'remote'
let syncMode = 'local'; // Default to local sync

// Local sync state (for same-browser tab sync)
let localSyncState = {
  isActive: false,
  tabs: {
    primary: null,
    secondary: null
  },
  lastAction: null,
  timeOffset: 0 // secondaryTime - primaryTime
};

// Remote sync state (for different-browser WebRTC sync)
let remoteSyncState = {
  isActive: false,
  localTabId: null, // The tab on this browser
  roomId: null,
  isHost: false,
  connectionState: 'disconnected',
  signalingUrl: null
};

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) {
    return false;
  }

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  try {
    if (await hasOffscreenDocument()) {
      return;
    }

    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['WEB_RTC'],
      justification: 'Keep WebRTC peer connection alive for remote sync'
    });
  } catch (error) {
    const message = error?.message || '';
    if (!message.includes('Only a single offscreen document')) {
      throw error;
    }
  }
}

let registeredTabs = new Map(); // tabId -> { site, url, timestamp }

function resetLocalSyncState() {
  localSyncState.isActive = false;
  localSyncState.tabs = { primary: null, secondary: null };
  localSyncState.timeOffset = 0;
  delete localSyncState.primaryTime;
  delete localSyncState.secondaryTime;
}

function resetRemoteSyncState() {
  chrome.runtime.sendMessage({ type: 'REMOTE_OFFSCREEN_STOP' }).catch(() => {
    // Offscreen document may not exist yet
  });

  remoteSyncState.isActive = false;
  remoteSyncState.localTabId = null;
  remoteSyncState.roomId = null;
  remoteSyncState.isHost = false;
  remoteSyncState.connectionState = 'disconnected';
}

function resetSyncState() {
  resetLocalSyncState();
  resetRemoteSyncState();
  syncMode = 'local';
}

// Load registered tabs from storage on startup
async function loadRegisteredTabs() {
  try {
    const result = await chrome.storage.session.get('registeredTabs');
    if (result.registeredTabs) {
      registeredTabs = new Map(Object.entries(result.registeredTabs).map(([k, v]) => [parseInt(k), v]));
      console.log('Loaded registered tabs from storage:', registeredTabs.size, 'tabs');
    }
  } catch (err) {
    console.error('Failed to load registered tabs:', err);
  }
}

// Save registered tabs to storage
async function saveRegisteredTabs() {
  try {
    const tabsObj = Object.fromEntries(registeredTabs.entries());
    await chrome.storage.session.set({ registeredTabs: tabsObj });
  } catch (err) {
    console.error('Failed to save registered tabs:', err);
  }
}

// Initialize on startup
loadRegisteredTabs();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  if (!message?.type) {
    sendResponse({ success: false, error: 'Invalid message' });
    return true;
  }

  switch (message.type) {
    case 'REGISTER_TAB':
      handleRegisterTab(message, sender);
      sendResponse({ success: true });
      break;

    case 'PLAYER_ACTION':
      handlePlayerAction(message, sender);
      sendResponse({ success: true });
      break;

    case 'REPORT_TIME':
      handleReportTime(message, sender);
      sendResponse({ success: true });
      break;

    case 'GET_SYNC_STATE':
      sendResponse({
        mode: syncMode,
        local: localSyncState,
        remote: {
          isActive: remoteSyncState.isActive,
          localTabId: remoteSyncState.localTabId,
          roomId: remoteSyncState.roomId,
          isHost: remoteSyncState.isHost,
          connectionState: remoteSyncState.connectionState
        }
      });
      break;

    case 'SET_TABS':
      // Local sync mode
      syncMode = 'local';
      localSyncState.tabs.primary = message.primaryTabId;
      localSyncState.tabs.secondary = message.secondaryTabId;
      localSyncState.isActive = true;
      sendResponse({ success: true });
      break;

    case 'STOP_SYNC':
      resetSyncState();
      sendResponse({ success: true });
      break;

    case 'GET_REGISTERED_TABS':
      const tabs = Array.from(registeredTabs.entries()).map(([tabId, data]) => ({
        tabId,
        ...data
      }));
      sendResponse({ tabs });
      break;

    // Remote sync commands
    case 'REMOTE_CREATE_ROOM':
      handleRemoteCreateRoom(message, sendResponse);
      return true; // Async response

    case 'REMOTE_JOIN_ROOM':
      handleRemoteJoinRoom(message, sendResponse);
      return true; // Async response

    case 'REMOTE_STOP':
      resetRemoteSyncState();
      sendResponse({ success: true });
      break;

    case 'REMOTE_OFFSCREEN_STATE':
      remoteSyncState.connectionState = message.state || 'disconnected';
      sendResponse({ success: true });
      break;

    case 'REMOTE_OFFSCREEN_PEER_MESSAGE':
      handleRemoteMessage(message.message);
      sendResponse({ success: true });
      break;

    case 'REMOTE_OFFSCREEN_CREATE_ROOM':
    case 'REMOTE_OFFSCREEN_JOIN_ROOM':
    case 'REMOTE_OFFSCREEN_SEND_SYNC':
    case 'REMOTE_OFFSCREEN_STOP':
      return false;

    default:
      sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
      break;
  }

  return true;
});

async function handleRegisterTab(message, sender) {
  const tabId = sender?.tab?.id;
  if (tabId === undefined) {
    return;
  }

  console.log(`Tab ${tabId} registered as ${message.site}`);
  registeredTabs.set(tabId, {
    site: message.site,
    url: message.url,
    timestamp: Date.now()
  });
  await saveRegisteredTabs();
}

function handlePlayerAction(message, sender) {
  const action = message.action;
  const senderTabId = sender?.tab?.id;
  if (senderTabId === undefined) return;

  // Route based on sync mode
  if (syncMode === 'local') {
    handleLocalPlayerAction(senderTabId, action);
  } else if (syncMode === 'remote') {
    handleRemotePlayerAction(senderTabId, action);
  }
}

function handleLocalPlayerAction(senderTabId, action) {
  if (!localSyncState.isActive) return;

  // Only accept actions from the primary tab
  if (senderTabId !== localSyncState.tabs.primary) {
    console.log(`[Local] Ignoring action from secondary tab ${senderTabId}`);
    return;
  }

  console.log(`[Local] Player action from primary tab ${senderTabId}:`, action);

  localSyncState.lastAction = {
    ...action,
    timestamp: Date.now(),
    sourceTab: senderTabId
  };

  // Add offset to the action for secondary player
  const actionWithOffset = {
    ...action,
    timeOffset: localSyncState.timeOffset
  };

  // Forward to secondary tab only
  const targetTabId = localSyncState.tabs.secondary;

  if (targetTabId) {
    chrome.tabs.sendMessage(targetTabId, {
      type: 'SYNC_ACTION',
      action: actionWithOffset
    }).catch(err => {
      console.error('[Local] Failed to send sync action:', err);
    });
  }
}

function handleRemotePlayerAction(senderTabId, action) {
  if (!remoteSyncState.isActive) return;

  // Only accept actions from our designated local tab
  if (senderTabId !== remoteSyncState.localTabId) {
    console.log(`[Remote] Ignoring action from non-synced tab ${senderTabId}`);
    return;
  }

  console.log(`[Remote] Player action from local tab ${senderTabId}:`, action);

  // Send action to remote peer via WebRTC offscreen context
  if (remoteSyncState.connectionState === 'connected') {
    chrome.runtime.sendMessage({
      type: 'REMOTE_OFFSCREEN_SEND_SYNC',
      message: {
        type: 'sync-action',
        action: action,
        timestamp: Date.now()
      }
    }).catch((err) => {
      console.error('[Remote] Failed to send sync message:', err);
    });
  }
}

function handleReportTime(message, sender) {
  const senderTabId = sender?.tab?.id;
  if (senderTabId === undefined) return;
  const currentTime = message.currentTime;

  // Only handle for local sync mode
  if (syncMode === 'local' && localSyncState.isActive) {
    if (senderTabId === localSyncState.tabs.primary) {
      // Store primary time, wait for secondary
      localSyncState.primaryTime = currentTime;
    } else if (senderTabId === localSyncState.tabs.secondary) {
      // Store secondary time, wait for primary
      localSyncState.secondaryTime = currentTime;
    }

    // If we have both times, calculate offset
    if (localSyncState.primaryTime !== undefined && localSyncState.secondaryTime !== undefined) {
      localSyncState.timeOffset = localSyncState.secondaryTime - localSyncState.primaryTime;
      console.log(`[Local] Time offset calculated: ${localSyncState.timeOffset.toFixed(2)}s (secondary ${localSyncState.timeOffset > 0 ? 'ahead' : 'behind'})`);

      // Clear temp values
      delete localSyncState.primaryTime;
      delete localSyncState.secondaryTime;
    }
  }
}

// Remote sync handlers
async function handleRemoteCreateRoom(message, sendResponse) {
  try {
    syncMode = 'remote';
    remoteSyncState.localTabId = message.tabId;
    remoteSyncState.signalingUrl = message.signalingUrl;
    remoteSyncState.isHost = true;

    await ensureOffscreenDocument();

    const result = await chrome.runtime.sendMessage({
      type: 'REMOTE_OFFSCREEN_CREATE_ROOM',
      signalingUrl: message.signalingUrl
    });

    if (!result?.success) {
      throw new Error(result?.error || 'Failed to create remote room');
    }

    const roomId = result.roomId;
    remoteSyncState.roomId = roomId;
    remoteSyncState.isActive = true;
    remoteSyncState.connectionState = 'connecting';

    sendResponse({ 
      success: true, 
      roomId: roomId,
      isHost: true
    });
  } catch (error) {
    console.error('[Remote] Failed to create room:', error);
    resetRemoteSyncState();
    sendResponse({ 
      success: false, 
      error: error.message 
    });
  }
}

async function handleRemoteJoinRoom(message, sendResponse) {
  try {
    syncMode = 'remote';
    remoteSyncState.localTabId = message.tabId;
    remoteSyncState.roomId = message.roomId;
    remoteSyncState.signalingUrl = message.signalingUrl;
    remoteSyncState.isHost = false;

    await ensureOffscreenDocument();

    const result = await chrome.runtime.sendMessage({
      type: 'REMOTE_OFFSCREEN_JOIN_ROOM',
      roomId: message.roomId,
      signalingUrl: message.signalingUrl
    });

    if (!result?.success) {
      throw new Error(result?.error || 'Failed to join remote room');
    }

    remoteSyncState.isActive = true;
    remoteSyncState.connectionState = 'connecting';

    sendResponse({ 
      success: true, 
      roomId: message.roomId,
      isHost: false
    });
  } catch (error) {
    console.error('[Remote] Failed to join room:', error);
    resetRemoteSyncState();
    sendResponse({ 
      success: false, 
      error: error.message 
    });
  }
}

function handleRemoteMessage(message) {
  console.log('[Remote] Received message from peer:', message);

  if (message.type === 'sync-action' && message.action) {
    // Forward action to local tab
    const targetTabId = remoteSyncState.localTabId;
    
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, {
        type: 'SYNC_ACTION',
        action: message.action
      }).catch(err => {
        console.error('[Remote] Failed to send sync action to tab:', err);
      });
    }
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Clean up registered tabs
  const wasRegistered = registeredTabs.has(tabId);
  registeredTabs.delete(tabId);

  if (wasRegistered) {
    await saveRegisteredTabs();
  }

  // Clean up local sync state
  if (syncMode === 'local') {
    if (tabId === localSyncState.tabs.primary || tabId === localSyncState.tabs.secondary) {
      resetLocalSyncState();
    }
  }

  // Clean up remote sync state
  if (syncMode === 'remote') {
    if (tabId === remoteSyncState.localTabId) {
      resetRemoteSyncState();
    }
  }
});
