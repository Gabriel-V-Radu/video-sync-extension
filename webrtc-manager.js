// WebRTC Connection Manager for Remote Video Sync
class WebRTCManager {
  constructor() {
    this.peerConnection = null;
    this.dataChannel = null;
    this.signalingSocket = null;
    this.roomId = null;
    this.isHost = false;
    this.connectionState = 'disconnected'; // disconnected, connecting, connected
    this.onMessageCallback = null;
    this.onStateChangeCallback = null;
    
    // STUN servers (Google's public STUN servers)
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];
  }

  // Set callback for receiving remote messages
  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  // Set callback for connection state changes
  onStateChange(callback) {
    this.onStateChangeCallback = callback;
  }

  // Update connection state and notify
  updateState(newState) {
    this.connectionState = newState;
    console.log('WebRTC state changed:', newState);
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(newState);
    }
  }

  // Connect to signaling server
  async connectToSignaling(signalingUrl) {
    return new Promise((resolve, reject) => {
      try {
        this.signalingSocket = new WebSocket(signalingUrl);
        
        this.signalingSocket.onopen = () => {
          console.log('Connected to signaling server');
          resolve();
        };

        this.signalingSocket.onerror = (error) => {
          console.error('Signaling socket error:', error);
          reject(error);
        };

        this.signalingSocket.onmessage = async (event) => {
          await this.handleSignalingMessage(JSON.parse(event.data));
        };

        this.signalingSocket.onclose = () => {
          console.log('Signaling socket closed');
          if (this.connectionState === 'connecting') {
            this.updateState('disconnected');
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  // Create a new room (host)
  async createRoom(signalingUrl) {
    this.isHost = true;
    this.roomId = this.generateRoomId();
    this.updateState('connecting');

    try {
      await this.connectToSignaling(signalingUrl);
      
      // Register as host
      this.sendSignalingMessage({
        type: 'create-room',
        roomId: this.roomId
      });

      // Create peer connection and data channel
      this.createPeerConnection();
      this.dataChannel = this.peerConnection.createDataChannel('sync');
      this.setupDataChannel(this.dataChannel);

      console.log('Room created:', this.roomId);
      return this.roomId;
    } catch (error) {
      console.error('Failed to create room:', error);
      this.updateState('disconnected');
      throw error;
    }
  }

  // Join an existing room (guest)
  async joinRoom(roomId, signalingUrl) {
    this.isHost = false;
    this.roomId = roomId;
    this.updateState('connecting');

    try {
      await this.connectToSignaling(signalingUrl);
      
      // Register as guest
      this.sendSignalingMessage({
        type: 'join-room',
        roomId: this.roomId
      });

      // Create peer connection
      this.createPeerConnection();

      console.log('Joining room:', this.roomId);
    } catch (error) {
      console.error('Failed to join room:', error);
      this.updateState('disconnected');
      throw error;
    }
  }

  // Create WebRTC peer connection
  createPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignalingMessage({
          type: 'ice-candidate',
          roomId: this.roomId,
          candidate: event.candidate
        });
      }
    };

    // Handle connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      console.log('Peer connection state:', this.peerConnection.connectionState);
      
      switch (this.peerConnection.connectionState) {
        case 'connected':
          this.updateState('connected');
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          this.updateState('disconnected');
          break;
      }
    };

    // Handle incoming data channel (for guest)
    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel(this.dataChannel);
      console.log('Data channel received');
    };
  }

  // Setup data channel event handlers
  setupDataChannel(channel) {
    channel.onopen = () => {
      console.log('Data channel opened');
      this.updateState('connected');
    };

    channel.onclose = () => {
      console.log('Data channel closed');
      this.updateState('disconnected');
    };

    channel.onerror = (error) => {
      console.error('Data channel error:', error);
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Received remote message:', message);
        if (this.onMessageCallback) {
          this.onMessageCallback(message);
        }
      } catch (error) {
        console.error('Failed to parse data channel message:', error);
      }
    };
  }

  // Handle signaling messages
  async handleSignalingMessage(message) {
    console.log('Signaling message:', message.type);

    switch (message.type) {
      case 'room-created':
        // Host: wait for guest to join
        console.log('Waiting for guest to join...');
        break;

      case 'guest-joined':
        // Host: create and send offer
        if (this.isHost) {
          await this.createAndSendOffer();
        }
        break;

      case 'offer':
        // Guest: receive offer and send answer
        await this.handleOffer(message.offer);
        break;

      case 'answer':
        // Host: receive answer
        await this.handleAnswer(message.answer);
        break;

      case 'ice-candidate':
        // Both: add ICE candidate
        await this.handleIceCandidate(message.candidate);
        break;

      case 'error':
        console.error('Signaling error:', message.error);
        this.updateState('disconnected');
        break;
    }
  }

  // Create and send SDP offer (host only)
  async createAndSendOffer() {
    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      
      this.sendSignalingMessage({
        type: 'offer',
        roomId: this.roomId,
        offer: offer
      });
    } catch (error) {
      console.error('Failed to create offer:', error);
    }
  }

  // Handle incoming offer (guest only)
  async handleOffer(offer) {
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      
      this.sendSignalingMessage({
        type: 'answer',
        roomId: this.roomId,
        answer: answer
      });
    } catch (error) {
      console.error('Failed to handle offer:', error);
    }
  }

  // Handle incoming answer (host only)
  async handleAnswer(answer) {
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error('Failed to handle answer:', error);
    }
  }

  // Handle incoming ICE candidate
  async handleIceCandidate(candidate) {
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Failed to add ICE candidate:', error);
    }
  }

  // Send message through signaling server
  sendSignalingMessage(message) {
    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify(message));
    } else {
      console.error('Signaling socket not ready');
    }
  }

  // Send sync message through data channel
  sendSyncMessage(message) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(message));
      return true;
    } else {
      console.error('Data channel not ready');
      return false;
    }
  }

  // Disconnect and cleanup
  disconnect() {
    console.log('Disconnecting WebRTC...');

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.signalingSocket) {
      this.signalingSocket.close();
      this.signalingSocket = null;
    }

    this.roomId = null;
    this.isHost = false;
    this.updateState('disconnected');
  }

  // Generate random room ID
  generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars
    let roomId = '';
    for (let i = 0; i < 6; i++) {
      roomId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return roomId;
  }

  // Get current connection state
  getState() {
    return {
      connectionState: this.connectionState,
      roomId: this.roomId,
      isHost: this.isHost
    };
  }
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebRTCManager;
}
