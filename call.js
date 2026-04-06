// ========================================
// ConnectX — Multi-User Video Call Logic
// Mesh WebRTC via PeerJS
// ========================================

(() => {
    'use strict';

    // ---- DOM References ----
    const callLobby = document.getElementById('callLobby');
    const callScreen = document.getElementById('callScreen');
    const callCodeInput = document.getElementById('callCode');
    const userNameInput = document.getElementById('userName');
    const generateCodeBtn = document.getElementById('generateCodeBtn');
    const copyCodeBtn = document.getElementById('copyCodeBtn');
    const joinCallBtn = document.getElementById('joinCallBtn');
    const togglePreviewBtn = document.getElementById('togglePreviewBtn');
    const previewVideo = document.getElementById('previewVideo');
    const previewOverlay = document.getElementById('previewOverlay');
    const lobbyStatus = document.getElementById('lobbyStatus');

    // Call screen elements
    const videoGrid = document.getElementById('videoGrid');
    const localVideo = document.getElementById('localVideo');
    const localNameTag = document.getElementById('localNameTag');
    const activeCallCode = document.getElementById('activeCallCode');
    const callTimer = document.getElementById('callTimer');
    const callQuality = document.getElementById('callQuality');
    const participantNum = document.getElementById('participantNum');
    const toggleMicBtn = document.getElementById('toggleMicBtn');
    const toggleCamBtn = document.getElementById('toggleCamBtn');
    const switchCamBtn = document.getElementById('switchCamBtn');
    const screenShareBtn = document.getElementById('screenShareBtn');
    const endCallBtn = document.getElementById('endCallBtn');

    // ---- State ----
    let peer = null;
    let localStream = null;
    let timerInterval = null;
    let callSeconds = 0;
    let isMicMuted = false;
    let isCamOff = false;
    let isScreenSharing = false;
    let originalVideoTrack = null;
    let previewActive = false;
    let currentCallCode = '';
    let myDisplayName = 'You';
    let facingMode = 'user'; // for camera switching

    // Multi-user state: Map<peerId, { call, dataConn, stream, name, tile }>
    const peers = new Map();

    // Prefix for PeerJS room IDs
    const PEER_PREFIX = 'connectx-room-';

    // Max participants
    const MAX_PARTICIPANTS = 8;

    // ========================================
    // UTILITY FUNCTIONS
    // ========================================

    function generateRandomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 8; i++) {
            if (i === 4) code += '-';
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    function generatePeerId() {
        // Unique peer ID: prefix + code + random suffix
        const suffix = Math.random().toString(36).substring(2, 8);
        return PEER_PREFIX + currentCallCode + '-' + suffix;
    }

    function setStatus(message, type = 'info', showSpinner = false) {
        lobbyStatus.className = `lobby-status ${type}`;
        lobbyStatus.innerHTML = showSpinner
            ? `<span class="status-spinner"></span>${message}`
            : message;
    }

    function clearStatus() {
        lobbyStatus.className = 'lobby-status';
        lobbyStatus.innerHTML = '';
    }

    function showToast(message, type = 'info') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 3500);
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    }

    function startTimer() {
        callSeconds = 0;
        callTimer.textContent = '00:00';
        timerInterval = setInterval(() => {
            callSeconds++;
            callTimer.textContent = formatTime(callSeconds);
        }, 1000);
    }

    function stopTimer() {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    function updateParticipantCount() {
        const count = peers.size + 1; // +1 for self
        participantNum.textContent = count;
        videoGrid.setAttribute('data-count', Math.min(count, 8));
    }

    function getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    }

    // ========================================
    // CAMERA / MEDIA
    // ========================================

    async function getLocalStream(videoFacingMode = 'user') {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: videoFacingMode
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            return stream;
        } catch (err) {
            console.error('Camera/Mic access error:', err);
            if (err.name === 'NotAllowedError') {
                setStatus('⚠️ Camera & microphone access denied. Please allow access in your browser settings.', 'error');
            } else if (err.name === 'NotFoundError') {
                setStatus('⚠️ No camera or microphone found on this device.', 'error');
            } else {
                setStatus(`⚠️ Could not access camera: ${err.message}`, 'error');
            }
            return null;
        }
    }

    function stopStream(stream) {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    }

    // ========================================
    // PREVIEW CAMERA
    // ========================================

    async function togglePreview() {
        if (previewActive) {
            stopStream(localStream);
            localStream = null;
            previewVideo.srcObject = null;
            previewVideo.classList.remove('active');
            previewOverlay.classList.remove('hidden');
            previewActive = false;
            togglePreviewBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                </svg>
                Enable Camera Preview
            `;
        } else {
            setStatus('Accessing camera...', 'info', true);
            localStream = await getLocalStream(facingMode);
            if (localStream) {
                previewVideo.srcObject = localStream;
                previewVideo.classList.add('active');
                previewOverlay.classList.add('hidden');
                previewActive = true;
                clearStatus();
                togglePreviewBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                        <polygon points="23 7 16 12 23 17 23 7"></polygon>
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                    </svg>
                    Disable Camera Preview
                `;
            }
        }
    }

    // ========================================
    // VIDEO TILE MANAGEMENT
    // ========================================

    function createRemoteTile(peerId, displayName) {
        const tile = document.createElement('div');
        tile.className = 'video-tile';
        tile.id = `tile-${peerId}`;
        tile.setAttribute('data-peer', peerId);

        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.id = `video-${peerId}`;

        const nameTag = document.createElement('div');
        nameTag.className = 'video-name-tag';
        nameTag.id = `name-${peerId}`;
        nameTag.textContent = displayName || 'Participant';

        // Placeholder for when video is off
        const placeholder = document.createElement('div');
        placeholder.className = 'tile-placeholder';
        placeholder.id = `placeholder-${peerId}`;
        placeholder.style.display = 'none';
        placeholder.innerHTML = `
            <div class="avatar-circle">${getInitials(displayName || 'P')}</div>
            <div class="avatar-name">${displayName || 'Participant'}</div>
        `;

        // Fullscreen button
        const fsBtn = document.createElement('button');
        fsBtn.className = 'fullscreen-btn';
        fsBtn.title = 'Toggle Fullscreen';
        fsBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
            </svg>
        `;
        fsBtn.onclick = () => toggleFullscreen(video);

        tile.appendChild(video);
        tile.appendChild(nameTag);
        tile.appendChild(placeholder);
        tile.appendChild(fsBtn);
        videoGrid.appendChild(tile);

        return { tile, video, nameTag, placeholder, fsBtn };
    }

    function removeRemoteTile(peerId) {
        const tile = document.getElementById(`tile-${peerId}`);
        if (tile) {
            tile.style.animation = 'tileAppear 0.3s cubic-bezier(0.4, 0, 0.2, 1) reverse';
            setTimeout(() => tile.remove(), 300);
        }
    }

    function toggleFullscreen(videoElement) {
        if (!videoElement) return;

        if (!document.fullscreenElement) {
            if (videoElement.requestFullscreen) {
                videoElement.requestFullscreen();
            } else if (videoElement.webkitRequestFullscreen) {
                videoElement.webkitRequestFullscreen();
            } else if (videoElement.msRequestFullscreen) {
                videoElement.msRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }

    // ========================================
    // PEER CONNECTION (WebRTC via PeerJS)
    // ========================================

    function createPeer(peerId) {
        return new Promise((resolve, reject) => {
            const p = new Peer(peerId, {
                debug: 1,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' },
                        { urls: 'stun:stun3.l.google.com:19302' },
                        { urls: 'stun:stun4.l.google.com:19302' }
                    ]
                }
            });

            p.on('open', (id) => {
                console.log('My Peer ID:', id);
                resolve(p);
            });

            p.on('error', (err) => {
                console.error('Peer error:', err);
                if (err.type === 'unavailable-id') {
                    // Try again with different ID
                    reject(new Error('ID collision, please try again.'));
                } else if (err.type === 'peer-unavailable') {
                    // This is expected when trying to connect to peers that left
                    console.warn('Peer unavailable:', err);
                } else {
                    reject(err);
                }
            });

            p.on('disconnected', () => {
                console.log('Peer disconnected, attempting reconnect...');
                p.reconnect();
            });
        });
    }

    // ========================================
    // MULTI-USER: ROOM DISCOVERY VIA PEER IDS
    // We use a "coordinator" pattern:
    // - Each participant registers as PREFIX + CODE + '-' + randomSuffix
    // - When joining, you try to connect to known peers
    // - Each peer shares the list of all other peers in the room
    // ========================================

    async function joinRoom() {
        const code = callCodeInput.value.trim().toUpperCase();
        if (!code) {
            setStatus('⚠️ Please enter or generate a code first.', 'error');
            callCodeInput.focus();
            return;
        }

        const name = userNameInput.value.trim() || 'Guest';
        myDisplayName = name;
        currentCallCode = code;

        joinCallBtn.disabled = true;
        setStatus('Accessing camera & microphone...', 'info', true);

        // Get media stream
        if (!localStream) {
            localStream = await getLocalStream(facingMode);
        }
        if (!localStream) {
            joinCallBtn.disabled = false;
            return;
        }

        setStatus('Joining call room...', 'info', true);

        try {
            const myPeerId = generatePeerId();
            peer = await createPeer(myPeerId);

            // Enter call screen
            enterCallScreen(code);
            startTimer();

            // Listen for incoming calls from new participants
            peer.on('call', (incomingCall) => {
                console.log('Incoming call from:', incomingCall.peer);
                incomingCall.answer(localStream);

                incomingCall.on('stream', (remoteStream) => {
                    handleNewPeerStream(incomingCall.peer, incomingCall, remoteStream);
                });

                incomingCall.on('close', () => {
                    handlePeerLeft(incomingCall.peer);
                });

                incomingCall.on('error', (err) => {
                    console.error('Incoming call error:', err);
                });
            });

            // Listen for data connections from new participants
            peer.on('connection', (conn) => {
                console.log('Incoming data connection from:', conn.peer);
                setupDataConnection(conn);
            });

            // Now announce ourselves to all existing peers in this room
            // We do this by trying to connect to known peer IDs
            // First, we register ourselves via a known "registry" peer
            // Since PeerJS doesn't have room discovery, we use the first peer
            // as a lightweight coordinator

            // Try to connect to the room coordinator
            const coordinatorId = PEER_PREFIX + code + '-coordinator';

            try {
                // Try to become the coordinator
                const coordPeer = new Peer(coordinatorId, {
                    debug: 0,
                    config: {
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:stun1.l.google.com:19302' }
                        ]
                    }
                });

                await new Promise((resolve, reject) => {
                    coordPeer.on('open', () => {
                        console.log('I am the room coordinator!');
                        // I'm the first one in the room
                        // Set up coordinator to help others discover peers
                        setupCoordinator(coordPeer, myPeerId);
                        resolve();
                    });

                    coordPeer.on('error', (err) => {
                        if (err.type === 'unavailable-id') {
                            // Coordinator already exists — connect to it
                            console.log('Coordinator exists, joining existing room...');
                            coordPeer.destroy();
                            connectToCoordinator(coordinatorId, myPeerId);
                            resolve();
                        } else {
                            reject(err);
                        }
                    });
                });

            } catch (err) {
                console.error('Coordinator setup error:', err);
            }

            showToast(`📞 You joined room ${code}. Waiting for others...`, 'info');

        } catch (err) {
            setStatus(`❌ ${err.message}`, 'error');
            joinCallBtn.disabled = false;
        }
    }

    // Coordinator: manages the list of peer IDs in the room
    let coordinatorPeer = null;
    const roomPeerIds = new Set(); // Only used by coordinator

    function setupCoordinator(coordPeer, myPeerId) {
        coordinatorPeer = coordPeer;
        roomPeerIds.add(myPeerId);

        coordPeer.on('connection', (conn) => {
            conn.on('open', () => {
                conn.on('data', (data) => {
                    if (data.type === 'register') {
                        console.log('New peer registered:', data.peerId);
                        // Send existing peer list to the new peer
                        conn.send({
                            type: 'peer-list',
                            peers: Array.from(roomPeerIds),
                            names: data.name ? { [data.peerId]: data.name } : {}
                        });
                        roomPeerIds.add(data.peerId);

                        // Notify existing peers about the new peer
                        // (but each peer will discover via its own connections)
                    } else if (data.type === 'unregister') {
                        roomPeerIds.delete(data.peerId);
                    }
                });
            });
        });
    }

    function connectToCoordinator(coordinatorId, myPeerId) {
        const conn = peer.connect(coordinatorId, { reliable: true });

        conn.on('open', () => {
            // Register ourselves
            conn.send({
                type: 'register',
                peerId: myPeerId,
                name: myDisplayName
            });
        });

        conn.on('data', (data) => {
            if (data.type === 'peer-list') {
                console.log('Received peer list:', data.peers);
                // Connect to each peer in the list
                data.peers.forEach(remotePeerId => {
                    if (remotePeerId !== peer.id && !peers.has(remotePeerId)) {
                        connectToPeer(remotePeerId);
                    }
                });
            }
        });

        conn.on('error', (err) => {
            console.error('Coordinator connection error:', err);
        });
    }

    function connectToPeer(remotePeerId) {
        if (peers.has(remotePeerId) || remotePeerId === peer.id) return;
        if (peers.size >= MAX_PARTICIPANTS - 1) {
            showToast('⚠️ Maximum participants reached', 'error');
            return;
        }

        console.log('Connecting to peer:', remotePeerId);

        // Establish data connection
        const dataConn = peer.connect(remotePeerId, { reliable: true });
        setupDataConnection(dataConn);

        // Make video call
        const call = peer.call(remotePeerId, localStream);

        call.on('stream', (remoteStream) => {
            handleNewPeerStream(remotePeerId, call, remoteStream);
        });

        call.on('close', () => {
            handlePeerLeft(remotePeerId);
        });

        call.on('error', (err) => {
            console.error(`Call error with ${remotePeerId}:`, err);
        });
    }

    function setupDataConnection(conn) {
        conn.on('open', () => {
            // Send our info
            conn.send({
                type: 'user-info',
                name: myDisplayName,
                peerId: peer.id
            });

            // Store or update peer data
            const existing = peers.get(conn.peer);
            if (existing) {
                existing.dataConn = conn;
            } else {
                peers.set(conn.peer, {
                    call: null,
                    dataConn: conn,
                    stream: null,
                    name: 'Participant',
                    tile: null
                });
            }
        });

        conn.on('data', (data) => {
            handleDataMessage(conn.peer, data);
        });

        conn.on('close', () => {
            handlePeerLeft(conn.peer);
        });

        conn.on('error', (err) => {
            console.error(`Data connection error with ${conn.peer}:`, err);
        });
    }

    function handleNewPeerStream(remotePeerId, call, remoteStream) {
        console.log('Got stream from:', remotePeerId);

        let peerData = peers.get(remotePeerId);
        if (!peerData) {
            peerData = {
                call: call,
                dataConn: null,
                stream: remoteStream,
                name: 'Participant',
                tile: null
            };
            peers.set(remotePeerId, peerData);
        } else {
            peerData.call = call;
            peerData.stream = remoteStream;
        }

        // Create or update video tile
        if (!peerData.tile) {
            const tileElements = createRemoteTile(remotePeerId, peerData.name);
            peerData.tile = tileElements;
        }

        peerData.tile.video.srcObject = remoteStream;
        updateParticipantCount();
        showToast(`🎉 ${peerData.name} joined the call!`, 'success');
    }

    function handlePeerLeft(remotePeerId) {
        const peerData = peers.get(remotePeerId);
        if (!peerData) return;

        const name = peerData.name || 'A participant';

        // Close call
        if (peerData.call) {
            peerData.call.close();
        }
        if (peerData.dataConn) {
            peerData.dataConn.close();
        }

        // Remove tile
        removeRemoteTile(remotePeerId);

        // Remove from map
        peers.delete(remotePeerId);
        updateParticipantCount();

        showToast(`👋 ${name} left the call.`, 'info');
    }

    function handleDataMessage(fromPeerId, data) {
        console.log('Data from', fromPeerId, ':', data);

        const peerData = peers.get(fromPeerId);

        switch (data.type) {
            case 'user-info':
                if (peerData) {
                    peerData.name = data.name || 'Participant';
                    // Update name tag
                    const nameEl = document.getElementById(`name-${fromPeerId}`);
                    if (nameEl) nameEl.textContent = peerData.name;
                    // Update placeholder
                    const placeholder = document.getElementById(`placeholder-${fromPeerId}`);
                    if (placeholder) {
                        placeholder.innerHTML = `
                            <div class="avatar-circle">${getInitials(peerData.name)}</div>
                            <div class="avatar-name">${peerData.name}</div>
                        `;
                    }
                }
                break;

            case 'ended':
                handlePeerLeft(fromPeerId);
                break;

            case 'screen-share-start':
                if (peerData && peerData.tile) {
                    peerData.tile.tile.classList.add('screen-sharing');
                    // Add screen share badge
                    let badge = peerData.tile.tile.querySelector('.screen-share-badge');
                    if (!badge) {
                        badge = document.createElement('div');
                        badge.className = 'screen-share-badge';
                        badge.innerHTML = '🖥️ Screen';
                        peerData.tile.tile.appendChild(badge);
                    }
                }
                showToast(`🖥️ ${peerData?.name || 'Someone'} is sharing their screen`, 'info');
                break;

            case 'screen-share-stop':
                if (peerData && peerData.tile) {
                    peerData.tile.tile.classList.remove('screen-sharing');
                    const badge = peerData.tile.tile.querySelector('.screen-share-badge');
                    if (badge) badge.remove();
                }
                break;

            case 'cam-off':
                if (peerData && peerData.tile) {
                    peerData.tile.placeholder.style.display = 'flex';
                    peerData.tile.video.style.opacity = '0';
                }
                break;

            case 'cam-on':
                if (peerData && peerData.tile) {
                    peerData.tile.placeholder.style.display = 'none';
                    peerData.tile.video.style.opacity = '1';
                }
                break;

            case 'mic-muted':
                // Show muted indicator
                if (peerData && peerData.tile) {
                    let indicator = peerData.tile.tile.querySelector('.video-muted-indicator');
                    if (!indicator) {
                        indicator = document.createElement('div');
                        indicator.className = 'video-muted-indicator';
                        indicator.innerHTML = '🔇 Muted';
                        peerData.tile.tile.appendChild(indicator);
                    }
                }
                break;

            case 'mic-unmuted':
                if (peerData && peerData.tile) {
                    const indicator = peerData.tile.tile.querySelector('.video-muted-indicator');
                    if (indicator) indicator.remove();
                }
                break;
        }
    }

    // Broadcast a message to all connected peers
    function broadcastData(data) {
        peers.forEach((peerData, peerId) => {
            if (peerData.dataConn && peerData.dataConn.open) {
                peerData.dataConn.send(data);
            }
        });
    }

    // ========================================
    // CALL MANAGEMENT
    // ========================================

    function enterCallScreen(code) {
        callLobby.style.display = 'none';
        callScreen.classList.add('active');
        activeCallCode.textContent = code;
        localNameTag.textContent = myDisplayName;

        // Set local video
        localVideo.srcObject = localStream;

        // Stop preview
        if (previewActive) {
            previewVideo.classList.remove('active');
            previewActive = false;
        }

        updateParticipantCount();
    }

    function exitCallScreen() {
        callScreen.classList.remove('active');
        callLobby.style.display = '';

        // Reset local video
        localVideo.srcObject = null;

        // Remove all remote tiles
        const remoteTiles = videoGrid.querySelectorAll('.video-tile:not(#localTile)');
        remoteTiles.forEach(tile => tile.remove());

        // Reset state
        stopTimer();
        callTimer.textContent = '00:00';
        isMicMuted = false;
        isCamOff = false;
        isScreenSharing = false;
        toggleMicBtn.classList.remove('muted');
        toggleCamBtn.classList.remove('muted');
        screenShareBtn.classList.remove('active');
        switchCamBtn.classList.remove('active');
        joinCallBtn.disabled = false;
        clearStatus();
        updateParticipantCount();
    }

    function endCall() {
        // Notify all peers
        broadcastData({ type: 'ended', message: 'User left the call' });

        // Close all peer connections
        peers.forEach((peerData, peerId) => {
            if (peerData.call) peerData.call.close();
            if (peerData.dataConn) peerData.dataConn.close();
        });
        peers.clear();

        // Unregister from coordinator
        if (coordinatorPeer) {
            coordinatorPeer.destroy();
            coordinatorPeer = null;
            roomPeerIds.clear();
        }

        // Stop local stream
        stopStream(localStream);
        localStream = null;

        // Stop screen share stream if active
        if (isScreenSharing) {
            const localTile = document.getElementById('localTile');
            const vid = localTile?.querySelector('video');
            if (vid && vid.srcObject && vid.srcObject !== localStream) {
                vid.srcObject.getTracks().forEach(t => t.stop());
            }
        }

        cleanupPeer();
        exitCallScreen();
        showToast('Call ended.', 'info');
    }

    function cleanupPeer() {
        if (peer) {
            peer.destroy();
            peer = null;
        }
    }

    // ========================================
    // CALL CONTROLS
    // ========================================

    function toggleMic() {
        if (!localStream) return;
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            isMicMuted = !isMicMuted;
            audioTrack.enabled = !isMicMuted;
            toggleMicBtn.classList.toggle('muted', isMicMuted);
            showToast(isMicMuted ? '🔇 Microphone muted' : '🎤 Microphone unmuted', 'info');

            // Notify peers
            broadcastData({ type: isMicMuted ? 'mic-muted' : 'mic-unmuted' });
        }
    }

    function toggleCam() {
        if (!localStream) return;
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            isCamOff = !isCamOff;
            videoTrack.enabled = !isCamOff;
            toggleCamBtn.classList.toggle('muted', isCamOff);
            showToast(isCamOff ? '📷 Camera off' : '📸 Camera on', 'info');

            // Notify peers
            broadcastData({ type: isCamOff ? 'cam-off' : 'cam-on' });
        }
    }

    async function switchCamera() {
        if (!localStream || isScreenSharing) return;

        // Toggle facing mode
        facingMode = facingMode === 'user' ? 'environment' : 'user';

        try {
            // Get new stream with opposite camera
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: facingMode
                },
                audio: false // Keep existing audio
            });

            const newVideoTrack = newStream.getVideoTracks()[0];
            const oldVideoTrack = localStream.getVideoTracks()[0];

            // Replace track in all peer connections
            peers.forEach((peerData) => {
                if (peerData.call) {
                    const sender = peerData.call.peerConnection
                        .getSenders()
                        .find(s => s.track && s.track.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(newVideoTrack);
                    }
                }
            });

            // Replace in local stream
            localStream.removeTrack(oldVideoTrack);
            localStream.addTrack(newVideoTrack);
            oldVideoTrack.stop();

            // Update local video
            localVideo.srcObject = localStream;

            // Apply muted state if camera was off
            if (isCamOff) {
                newVideoTrack.enabled = false;
            }

            switchCamBtn.classList.add('active');
            setTimeout(() => switchCamBtn.classList.remove('active'), 1000);

            showToast(facingMode === 'user' ? '📸 Front camera' : '📸 Rear camera', 'success');
        } catch (err) {
            console.error('Switch camera error:', err);
            // Revert facing mode
            facingMode = facingMode === 'user' ? 'environment' : 'user';
            showToast('⚠️ Could not switch camera. This device may have only one camera.', 'error');
        }
    }

    async function toggleScreenShare() {
        if (!localStream) return;

        if (!isScreenSharing) {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: 'always' },
                    audio: false
                });

                const screenTrack = screenStream.getVideoTracks()[0];
                originalVideoTrack = localStream.getVideoTracks()[0];

                // Replace video track in all peer connections
                peers.forEach((peerData) => {
                    if (peerData.call) {
                        const sender = peerData.call.peerConnection
                            .getSenders()
                            .find(s => s.track && s.track.kind === 'video');
                        if (sender) {
                            sender.replaceTrack(screenTrack);
                        }
                    }
                });

                // Update local video
                localVideo.srcObject = screenStream;

                // Update local tile style
                const localTile = document.getElementById('localTile');
                localTile.classList.add('screen-sharing');

                isScreenSharing = true;
                screenShareBtn.classList.add('active');
                showToast('🖥️ Screen sharing started', 'success');

                // Notify peers
                broadcastData({ type: 'screen-share-start' });

                // Handle when user stops sharing from browser UI
                screenTrack.onended = () => {
                    stopScreenShare();
                };
            } catch (err) {
                console.error('Screen share error:', err);
                if (err.name !== 'AbortError') {
                    showToast('⚠️ Could not share screen', 'error');
                }
            }
        } else {
            stopScreenShare();
        }
    }

    async function stopScreenShare() {
        if (!originalVideoTrack) return;

        // Replace the screen track with original video track in all connections
        peers.forEach((peerData) => {
            if (peerData.call) {
                const sender = peerData.call.peerConnection
                    .getSenders()
                    .find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(originalVideoTrack);
                }
            }
        });

        // Stop screen stream tracks
        if (localVideo.srcObject && localVideo.srcObject !== localStream) {
            localVideo.srcObject.getTracks().forEach(t => t.stop());
        }

        localVideo.srcObject = localStream;

        // Remove screen sharing style from local tile
        const localTile = document.getElementById('localTile');
        localTile.classList.remove('screen-sharing');

        isScreenSharing = false;
        screenShareBtn.classList.remove('active');
        originalVideoTrack = null;

        // Notify peers
        broadcastData({ type: 'screen-share-stop' });

        showToast('🖥️ Screen sharing stopped', 'info');
    }

    // ========================================
    // EVENT LISTENERS
    // ========================================

    // Generate code
    generateCodeBtn.addEventListener('click', () => {
        callCodeInput.value = generateRandomCode();
        callCodeInput.focus();
        showToast('🔑 New code generated! Share it with your team.', 'success');
    });

    // Copy code
    copyCodeBtn.addEventListener('click', () => {
        const code = callCodeInput.value.trim();
        if (!code) {
            showToast('No code to copy. Generate one first!', 'error');
            return;
        }
        navigator.clipboard.writeText(code).then(() => {
            showToast('📋 Code copied to clipboard!', 'success');
        }).catch(() => {
            callCodeInput.select();
            document.execCommand('copy');
            showToast('📋 Code copied!', 'success');
        });
    });

    // Join call
    joinCallBtn.addEventListener('click', joinRoom);

    // Preview toggle
    togglePreviewBtn.addEventListener('click', togglePreview);

    // Call controls
    toggleMicBtn.addEventListener('click', toggleMic);
    toggleCamBtn.addEventListener('click', toggleCam);
    switchCamBtn.addEventListener('click', switchCamera);
    screenShareBtn.addEventListener('click', toggleScreenShare);
    endCallBtn.addEventListener('click', endCall);

    // Fullscreen for local video
    const localFsBtn = document.querySelector('#localTile .fullscreen-btn');
    if (localFsBtn) {
        localFsBtn.addEventListener('click', () => toggleFullscreen(localVideo));
    }

    // Auto-format code input
    callCodeInput.addEventListener('input', () => {
        callCodeInput.value = callCodeInput.value.toUpperCase();
    });

    // Enter key to join call
    callCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            joinCallBtn.click();
        }
    });

    // Warn before leaving during an active call
    window.addEventListener('beforeunload', (e) => {
        if (peer) {
            e.preventDefault();
            e.returnValue = 'You are in an active call. Are you sure you want to leave?';
        }
    });

    // Cleanup on page unload
    window.addEventListener('unload', () => {
        broadcastData({ type: 'ended', message: 'User left the page' });
        if (coordinatorPeer) {
            coordinatorPeer.destroy();
        }
        cleanupPeer();
        stopStream(localStream);
    });

    // ========================================
    // INIT
    // ========================================

    // Auto-generate a code on page load
    callCodeInput.value = generateRandomCode();

    // Set default name
    const defaultNames = ['Phoenix', 'Aurora', 'Spark', 'Nova', 'Blaze', 'Echo', 'Pulse', 'Drift'];
    userNameInput.value = '';
    userNameInput.placeholder = `e.g. ${defaultNames[Math.floor(Math.random() * defaultNames.length)]}`;

})();
