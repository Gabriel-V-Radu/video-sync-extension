let webrtc = null;

function ensureWebRTCManager() {
  if (!webrtc) {
    webrtc = new WebRTCManager();

    webrtc.onStateChange((state) => {
      chrome.runtime.sendMessage({
        type: 'REMOTE_OFFSCREEN_STATE',
        state
      }).catch(() => {
        // Background may be restarting
      });
    });

    webrtc.onMessage((message) => {
      chrome.runtime.sendMessage({
        type: 'REMOTE_OFFSCREEN_PEER_MESSAGE',
        message
      }).catch(() => {
        // Background may be restarting
      });
    });
  }

  return webrtc;
}

function cleanupWebRTC() {
  if (webrtc) {
    webrtc.disconnect();
    webrtc = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  (async () => {
    try {
      switch (message.type) {
        case 'REMOTE_OFFSCREEN_CREATE_ROOM': {
          const manager = ensureWebRTCManager();
          const roomId = await manager.createRoom(message.signalingUrl);
          sendResponse({ success: true, roomId });
          return;
        }

        case 'REMOTE_OFFSCREEN_JOIN_ROOM': {
          const manager = ensureWebRTCManager();
          await manager.joinRoom(message.roomId, message.signalingUrl);
          sendResponse({ success: true, roomId: message.roomId });
          return;
        }

        case 'REMOTE_OFFSCREEN_SEND_SYNC': {
          const manager = ensureWebRTCManager();
          const sent = manager.sendSyncMessage(message.message);
          sendResponse({ success: sent });
          return;
        }

        case 'REMOTE_OFFSCREEN_STOP': {
          cleanupWebRTC();
          sendResponse({ success: true });
          return;
        }

        default:
          break;
      }
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message || 'Unknown offscreen error'
      });
    }
  })();

  return true;
});
