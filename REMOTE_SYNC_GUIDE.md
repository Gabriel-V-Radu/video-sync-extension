# Remote Video Sync - Quick Start Guide

This guide will help you set up video synchronization between two different computers using WebRTC.

## What You Need

- ✅ Video Sync Extension installed on both browsers
- ✅ A signaling server running (see setup below)
- ✅ Both people have the video they want to watch open

## Step-by-Step Setup

### Step 1: Start the Signaling Server

#### Option A: Quick Local Test (Same Network)

If both computers are on the same WiFi/network:

**On one computer:**
```bash
cd signaling-server
npm install
npm start
```

**Find your local IP:**
- Windows: Open CMD, type `ipconfig`, look for "IPv4 Address" (e.g., 192.168.1.100)
- Mac: Open Terminal, type `ifconfig | grep inet`, look for 192.168.x.x address
- Linux: Open Terminal, type `ip addr`, look for 192.168.x.x address

**Both computers use:** `ws://[YOUR-IP]:8080` (e.g., `ws://192.168.1.100:8080`)

#### Option B: Deploy for Internet Use (Recommended)

For syncing over the internet, deploy to a free service:

**Railway (Easiest, Free Tier):**
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Fork/upload the `signaling-server` folder
5. Railway auto-deploys in ~2 minutes
6. Copy your URL: `your-app.up.railway.app`
7. Use: `wss://your-app.up.railway.app`

**Glitch (No GitHub needed):**
1. Go to [glitch.com](https://glitch.com)
2. Click "New Project" → "Import from GitHub"
3. Or create new project and copy files from `signaling-server`
4. Your URL: `your-project.glitch.me`
5. Use: `wss://your-project.glitch.me`

### Step 2: Person A Creates Room

1. Open your video (YouTube, Netflix, etc.)
2. Click the **Video Sync** extension icon
3. Switch to **"🌐 Remote Sync"** tab
4. Enter signaling server URL (from Step 1)
5. Click on your video tab to select it
6. Click **"Create Room & Get Code"**
7. Wait for 6-character code to appear (e.g., `ABC123`)
8. **Share this code** with Person B (via text, Discord, etc.)

### Step 3: Person B Joins Room

1. Open the **same video** (or different video to compare)
2. Click the **Video Sync** extension icon
3. Switch to **"🌐 Remote Sync"** tab
4. Enter the **same signaling server URL**
5. Click on your video tab to select it
6. Enter the **room code** from Person A
7. Click **"Join Room"**
8. Wait for "CONNECTED" status

### Step 4: Start Watching Together!

✅ Once both see "● CONNECTED":
- Either person can play, pause, or seek
- Videos stay synchronized automatically
- Works even on different streaming sites!

## Common Issues & Solutions

### ❌ "Failed to create/join room"

**Solution:**
- Check signaling server is running
- Verify URL is correct (`ws://` for local, `wss://` for deployed)
- Try refreshing both browsers

### ❌ "Connection timed out"

**Solution:**
- Make sure both people use the **exact same signaling URL**
- Check room code is correct (case-sensitive)
- Try creating a new room
- Check firewalls aren't blocking connections

### ❌ "Connected but videos don't sync"

**Solution:**
- Make sure videos are loaded and playing first
- Try clicking play on both videos
- Refresh video tabs and reconnect
- Check that you selected the correct tab before connecting

### ⚠️ Connection keeps failing

**Possible causes:**
- Corporate/school networks may block WebRTC
- Some VPNs interfere with peer connections
- Try using mobile hotspot for testing
- Free STUN servers may be unreliable (works 90% of time)

## Advanced: Testing Different Videos

You can sync different videos to watch together:

- **Watch party**: Person A watches Episode 1, Person B watches Episode 2
- **Comparison**: Same show on different streaming services
- **Commentary**: One person's screen recording, other watches original

The sync works regardless of the actual video content!

## Bandwidth & Performance

- **Bandwidth used**: ~1-10 KB/second (just control messages)
- **No video streaming**: Each person watches from their own source
- **Latency**: Typically 50-200ms depending on connection
- **Works with**: Any video player that supports HTML5 video

## Security & Privacy

✅ Video content stays on streaming servers (Netflix, YouTube, etc.)
✅ Only play/pause/seek commands are shared
✅ Peer-to-peer connection (data doesn't go through signaling server)
✅ Room codes expire after 1 hour
✅ No login or account required

## Tips for Best Experience

1. **Start videos before connecting** - Load and play videos first
2. **Use same streaming quality** - Reduces desyncing
3. **Stable internet** - Both people need decent connections
4. **Same video recommended** - But not required!
5. **Refresh if needed** - If sync breaks, just reconnect

## Need Help?

Check the main [README.md](README.md) for:
- Full troubleshooting guide
- Signaling server deployment options
- Technical architecture details
- Local sync mode (same browser/computer)

---

**Enjoy watching videos together! 🎬🍿**
