# Video Sync Player Extension

Synchronize two video tabs so one tab controls playback in the other.

## Features

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

1. Open two tabs with videos (for example YouTube + Netflix).
2. Let both players load completely.
3. Click the extension icon to open the popup.
4. Select exactly **2** video tabs:
   - First selected tab = **Primary** (controller)
   - Second selected tab = **Secondary** (follower)
5. Click **Start Sync**.
6. Control the **Primary** tab:
   - Play/pause
   - Seek
   - Change playback speed
7. Click **Stop Sync** to end syncing.

## Tips for best results

- Start both videos before syncing.
- If sync fails, refresh both tabs and try again.
- Keep only the two target videos selected.
- On some streaming pages, wait a few seconds after player UI appears before starting sync.

## Troubleshooting

### “No video tabs found”

- Make sure video pages are open in normal tabs (not internal browser pages).
- Refresh the video pages and reopen the popup.

### “Could not connect to video tabs”

- The player may still be loading.
- Refresh both tabs, press play once on each, then try again.

### Crunchyroll or Netflix not syncing immediately

- Their players can load inside dynamic frames.
- Wait for playback to start, then start sync again.

## Privacy

This extension runs locally in your browser and does not send video data to external servers.

## Project files

- `manifest.json`: extension configuration
- `background.js`: sync state and message routing
- `ui/popup.html` + `ui/popup.js`: popup UI to choose tabs and start/stop sync
- `players/`: site player handlers (`youtube`, `crunchyroll`, `netflix`, `generic`)
