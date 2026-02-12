# Video Sync Player Extension

Synchronize video players across tabs or across the internet!

**NEW**: Remote sync now available! Watch videos together with friends on different computers. See [Remote Sync Quick Start →](REMOTE_SYNC_GUIDE.md)

## Features

- **Local Sync**: Sync two tabs in the same browser
- **Remote Sync**: Sync videos across different computers via WebRTC
- Sync **play / pause**
- Sync **seek/jump**
- Sync **playback speed**
- Keeps tabs aligned with periodic time correction
- Works with:
  - YouTube
  - Crunchyroll
  - Netflix
  - Other sites with standard HTML5 video (best effort)

## Requirements

- Chromium-based browser (Google Chrome, Microsoft Edge, Brave, Opera)

## Install (Developer Mode)

### Chrome / Edge

1. Download or clone this folder.
2. Open extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select this folder: `video-sync-extension`.
6. Pin **Video Sync Player** from the extensions toolbar (optional but recommended).

## How to use

### Local Sync (Same Browser)

1. Open two tabs with videos (for example YouTube + Netflix).
2. Let both players load completely.
3. Click the extension icon to open the popup.
4. Stay on **"Local Sync"** tab (default).
5. Select exactly **2** video tabs:
   - First selected tab = **Primary** (controller)
   - Second selected tab = **Secondary** (follower)
6. Click **Start Local Sync**.
7. Control the **Primary** tab:
   - Play/pause
   - Seek
   - Change playback speed
8. Click **Stop Sync** to end syncing.

### Remote Sync (Different Computers/Browsers)

**Prerequisites**: You need a running signaling server. See [Signaling Server Setup](#signaling-server-setup) below.

**Person A (Host - Creates Room):**
1. Start the signaling server (or use a deployed one)
2. Open a video in your browser
3. Click the extension icon
4. Switch to **"Remote Sync"** tab
5. Enter your signaling server URL (e.g., `ws://localhost:8080` or your deployed URL)
6. Select your video tab
7. Click **"Create Room & Get Code"**
8. Share the 6-character room code with Person B

**Person B (Guest - Joins Room):**
1. Open a video in your browser (same video recommended)
2. Click the extension icon
3. Switch to **"Remote Sync"** tab
4. Enter the same signaling server URL
5. Select your video tab
6. Enter the room code from Person A
7. Click **"Join Room"**

**Both people**: Once connected, both videos will stay in sync. Either person can control (play/pause/seek) and it will sync to the other!

## Signaling Server Setup

The signaling server helps establish WebRTC connections between browsers. You only need one server running that both users connect to.

### Option 1: Run Locally (Quick Test)

```bash
cd signaling-server
npm install
npm start
```

Use URL: `ws://localhost:8080`

**Note**: For remote sync across the internet, you need to deploy the server (see Option 2).

### Option 2: Deploy to Cloud (For Internet Use)

See [`signaling-server/README.md`](signaling-server/README.md) for detailed deployment instructions to:
- Railway (recommended, free tier)
- Glitch (free, easy)
- Render (free tier)
- Heroku
- Your own VPS

Once deployed, use `wss://your-server-url.com` in the extension.

## Tips for best results

- Start both videos before syncing.
- If sync fails, refresh both tabs and try again.
- Keep only the two target videos selected.
- On some streaming pages, wait a few seconds after player UI appears before starting sync.

## Troubleshooting

### Local Sync Issues

**"No video tabs found"**
- Make sure video pages are open in normal tabs (not internal browser pages).
- Refresh the video pages and reopen the popup.

**"Could not connect to video tabs"**
- The player may still be loading.
- Refresh both tabs, press play once on each, then try again.

**Crunchyroll or Netflix not syncing immediately**
- Their players can load inside dynamic frames.
- Wait for playback to start, then start sync again.

### Remote Sync Issues

**"Failed to create/join room"**
- Make sure the signaling server is running
- Check that the signaling URL is correct (starts with `ws://` or `wss://`)
- Verify firewall isn't blocking the connection

**"Connection failed or timed out"**
- Both users must use the same signaling server
- Room codes are case-sensitive
- Room codes expire after 1 hour
- Try creating a new room

**"Connected but not syncing"**
- Make sure both videos are loaded and playing
- Try refreshing both video tabs
- Check that you selected the correct tab before connecting
- Some networks may block WebRTC (try mobile hotspot for testing)

**STUN server limitations**
- Free STUN servers work for most networks
- If connection fails consistently, you may need TURN servers (not included)
- Corporate/restrictive networks may block peer-to-peer connections

## Privacy

**Local Sync**: Runs entirely in your browser. No data leaves your computer.

**Remote Sync**: 
- Only sync control messages (play/pause/seek/speed) are sent through WebRTC
- Video content is NOT transmitted - each person watches from their own streaming service
- The signaling server only helps establish the initial connection
- After connection, data flows directly between peers (peer-to-peer)
- No video data is sent to the signaling server

## Project files

- `manifest.json`: extension configuration
- `background.js`: sync state, message routing, and WebRTC management
- `webrtc-manager.js`: WebRTC connection handling for remote sync
- `ui/popup.html` + `ui/popup.js`: popup UI for local and remote sync
- `players/`: site-specific player handlers (`youtube`, `crunchyroll`, `netflix`, `generic`)
- `signaling-server/`: WebSocket signaling server for WebRTC connections

## Technical Details

### Local Sync Architecture
- Uses Chrome's `chrome.tabs.sendMessage` API
- Background service worker coordinates between tabs
- Direct communication within browser instance

### Remote Sync Architecture
- WebRTC Data Channels for peer-to-peer communication
- WebSocket signaling server for connection establishment
- STUN servers for NAT traversal (Google's public STUN servers)
- Each browser maintains one local video tab
- Control messages synced bidirectionally

### Why Separate Modes?
Local and remote sync are completely isolated to prevent interference:
- Different message routing paths
- Independent state management  
- Local sync remains simple and fast
- Remote sync adds WebRTC only when needed
