// Simple WebSocket Signaling Server for WebRTC
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Store active rooms: roomId -> { host: WebSocket, guest: WebSocket }
const rooms = new Map();

console.log(`Signaling server starting on port ${PORT}...`);

wss.on('connection', (ws) => {
  console.log('New client connected');
  let currentRoomId = null;
  let isHost = false;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data.type, data.roomId);

      switch (data.type) {
        case 'create-room':
          handleCreateRoom(ws, data);
          currentRoomId = data.roomId;
          isHost = true;
          break;

        case 'join-room':
          handleJoinRoom(ws, data);
          currentRoomId = data.roomId;
          isHost = false;
          break;

        case 'offer':
        case 'answer':
        case 'ice-candidate':
          relayMessage(ws, data);
          break;

        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({ type: 'error', error: error.message }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    
    // Clean up room if this client was in one
    if (currentRoomId && rooms.has(currentRoomId)) {
      const room = rooms.get(currentRoomId);
      
      if (isHost && room.host === ws) {
        // Host left, notify guest if present
        if (room.guest) {
          room.guest.send(JSON.stringify({ type: 'host-left' }));
        }
        rooms.delete(currentRoomId);
        console.log('Room deleted:', currentRoomId);
      } else if (!isHost && room.guest === ws) {
        // Guest left, notify host
        if (room.host) {
          room.host.send(JSON.stringify({ type: 'guest-left' }));
        }
        room.guest = null;
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

function handleCreateRoom(ws, data) {
  const roomId = data.roomId;
  
  if (rooms.has(roomId)) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      error: 'Room already exists' 
    }));
    return;
  }

  rooms.set(roomId, {
    host: ws,
    guest: null,
    createdAt: Date.now()
  });

  ws.send(JSON.stringify({ 
    type: 'room-created', 
    roomId: roomId 
  }));

  console.log('Room created:', roomId);
}

function handleJoinRoom(ws, data) {
  const roomId = data.roomId;
  
  if (!rooms.has(roomId)) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      error: 'Room not found' 
    }));
    return;
  }

  const room = rooms.get(roomId);
  
  if (room.guest) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      error: 'Room is full' 
    }));
    return;
  }

  room.guest = ws;
  
  ws.send(JSON.stringify({ 
    type: 'room-joined', 
    roomId: roomId 
  }));

  // Notify host that guest joined
  if (room.host) {
    room.host.send(JSON.stringify({ 
      type: 'guest-joined' 
    }));
  }

  console.log('Guest joined room:', roomId);
}

function relayMessage(senderWs, data) {
  const roomId = data.roomId;
  
  if (!rooms.has(roomId)) {
    console.error('Cannot relay message: room not found');
    return;
  }

  const room = rooms.get(roomId);
  const message = JSON.stringify(data);

  if (senderWs === room.host) {
    if (room.guest) {
      room.guest.send(message);
    }
    return;
  }

  if (senderWs === room.guest) {
    if (room.host) {
      room.host.send(message);
    }
    return;
  }

  console.error('Cannot relay message: sender is not in room');
}

// Cleanup old rooms every 5 minutes
setInterval(() => {
  const now = Date.now();
  const MAX_AGE = 60 * 60 * 1000; // 1 hour
  
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.createdAt > MAX_AGE) {
      rooms.delete(roomId);
      console.log('Cleaned up old room:', roomId);
    }
  }
}, 5 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`WebSocket URL: ws://localhost:${PORT}`);
});
