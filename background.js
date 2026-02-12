let syncState = {
  isActive: false,
  tabs: {
    primary: null,
    secondary: null
  },
  lastAction: null,
  timeOffset: 0 // secondaryTime - primaryTime
};

let registeredTabs = new Map(); // tabId -> { site, url, timestamp }

function resetSyncState() {
  syncState.isActive = false;
  syncState.tabs = { primary: null, secondary: null };
  syncState.timeOffset = 0;
  delete syncState.primaryTime;
  delete syncState.secondaryTime;
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
      sendResponse(syncState);
      break;

    case 'SET_TABS':
      syncState.tabs.primary = message.primaryTabId;
      syncState.tabs.secondary = message.secondaryTabId;
      syncState.isActive = true;
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
  if (!syncState.isActive) return;

  const action = message.action;
  const senderTabId = sender?.tab?.id;
  if (senderTabId === undefined) return;

  // Only accept actions from the primary tab
  if (senderTabId !== syncState.tabs.primary) {
    console.log(`Ignoring action from secondary tab ${senderTabId}`);
    return;
  }

  console.log(`Player action from primary tab ${senderTabId}:`, action);

  syncState.lastAction = {
    ...action,
    timestamp: Date.now(),
    sourceTab: senderTabId
  };

  // Add offset to the action for secondary player
  const actionWithOffset = {
    ...action,
    timeOffset: syncState.timeOffset
  };

  // Forward to secondary tab only
  const targetTabId = syncState.tabs.secondary;

  if (targetTabId) {
    chrome.tabs.sendMessage(targetTabId, {
      type: 'SYNC_ACTION',
      action: actionWithOffset
    }).catch(err => {
      console.error('Failed to send sync action:', err);
    });
  }
}

function handleReportTime(message, sender) {
  const senderTabId = sender?.tab?.id;
  if (senderTabId === undefined) return;
  const currentTime = message.currentTime;

  if (senderTabId === syncState.tabs.primary) {
    // Store primary time, wait for secondary
    syncState.primaryTime = currentTime;
  } else if (senderTabId === syncState.tabs.secondary) {
    // Store secondary time, wait for primary
    syncState.secondaryTime = currentTime;
  }

  // If we have both times, calculate offset
  if (syncState.primaryTime !== undefined && syncState.secondaryTime !== undefined) {
    syncState.timeOffset = syncState.secondaryTime - syncState.primaryTime;
    console.log(`Time offset calculated: ${syncState.timeOffset.toFixed(2)}s (secondary ${syncState.timeOffset > 0 ? 'ahead' : 'behind'})`);

    // Clear temp values
    delete syncState.primaryTime;
    delete syncState.secondaryTime;
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Clean up registered tabs
  const wasRegistered = registeredTabs.has(tabId);
  registeredTabs.delete(tabId);

  if (wasRegistered) {
    await saveRegisteredTabs();
  }

  // Clean up sync state
  if (tabId === syncState.tabs.primary || tabId === syncState.tabs.secondary) {
    resetSyncState();
  }
});
