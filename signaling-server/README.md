# Video Sync Signaling Server

Simple WebSocket signaling server for establishing WebRTC connections between remote video sync clients.

## Quick Start (Local Development)

### 1. Install Dependencies
```bash
cd signaling-server
npm install
```

### 2. Run the Server
```bash
npm start
```

The server will start on port 8080. You should see:
```
Signaling server running on port 8080
WebSocket URL: ws://localhost:8080
```

### 3. Configure Extension
In the extension popup, use this signaling URL:
```
ws://localhost:8080
```

## Deploy to Cloud (For Remote Use)

### Option 1: Railway (Recommended - Free Tier Available)

1. Create account at [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select this folder or upload files
4. Railway will auto-detect NODE and deploy
5. Copy the provided URL (e.g., `video-sync.up.railway.app`)
6. Use in extension: `wss://video-sync.up.railway.app`

### Option 2: Glitch (Free, Easy)

1. Go to [glitch.com](https://glitch.com)
2. Click "New Project" → "Import from GitHub"
3. Or click "New Project" → "hello-express" and replace files
4. Copy your project URL (e.g., `my-project.glitch.me`)
5. Use in extension: `wss://my-project.glitch.me`

### Option 3: Render (Free Tier)

1. Create account at [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect to Git repository or upload
4. Set build command: `npm install`
5. Set start command: `npm start`
6. Deploy and copy URL
7. Use in extension: `wss://your-service.onrender.com`

### Option 4: Heroku

```bash
# Install Heroku CLI first
heroku login
heroku create video-sync-signal
git init
git add .
git commit -m "Initial commit"
git push heroku main
heroku ps:scale web=1
```

Use: `wss://video-sync-signal.herokuapp.com`

## Environment Variables

- `PORT` - Server port (default: 8080, cloud platforms set this automatically)

## Security Notes

- This is a basic signaling server for development
- For production use, consider adding:
  - Authentication/API keys
  - Rate limiting
  - Room expiration
  - HTTPS/WSS only
  - CORS configuration

## Testing Locally Across Network

To test between two computers on the same network:

1. Find your local IP address:
   - Windows: `ipconfig` (look for IPv4 Address)
   - Mac/Linux: `ifconfig` or `ip addr`

2. Start server on one computer

3. Both computers use: `ws://[YOUR-LOCAL-IP]:8080`
   - Example: `ws://192.168.1.100:8080`

4. Make sure firewall allows port 8080

## Troubleshooting

**Connection refused:**
- Check if server is running
- Verify correct URL
- Check firewall settings

**Room not found:**
- Make sure both users connected to same server
- Room IDs are case-sensitive
- Rooms expire after 1 hour

**WebRTC connection fails:**
- STUN servers are free but not 100% reliable
- Some networks require TURN servers (not included)
- Try different network or use mobile hotspot for testing
