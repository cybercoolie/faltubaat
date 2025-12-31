const socket = io();

let currentUser = '';
let currentChat = null;
let currentChatType = 'private'; // 'private' or 'group'
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let notificationsEnabled = true;

// ============================================
// AUTHENTICATION
// ============================================

// Get stored auth token
function getAuthToken() {
    return localStorage.getItem('faltubaat_token');
}

// Set auth token
function setAuthToken(token) {
    localStorage.setItem('faltubaat_token', token);
}

// Clear auth token
function clearAuthToken() {
    localStorage.removeItem('faltubaat_token');
    localStorage.removeItem('faltubaat_user');
}

// Get stored user data
function getStoredUser() {
    const userData = localStorage.getItem('faltubaat_user');
    return userData ? JSON.parse(userData) : null;
}

// Set stored user data
function setStoredUser(user) {
    localStorage.setItem('faltubaat_user', JSON.stringify(user));
}

// Switch between sign-in and sign-up tabs
window.switchAuthTab = function(tab) {
    const signinForm = document.getElementById('signinForm');
    const signupForm = document.getElementById('signupForm');
    const tabs = document.querySelectorAll('.auth-tab');
    
    tabs.forEach(t => t.classList.remove('active'));
    
    if (tab === 'signin') {
        signinForm.style.display = 'block';
        signinForm.classList.add('active');
        signupForm.style.display = 'none';
        signupForm.classList.remove('active');
        tabs[0].classList.add('active');
    } else {
        signinForm.style.display = 'none';
        signinForm.classList.remove('active');
        signupForm.style.display = 'block';
        signupForm.classList.add('active');
        tabs[1].classList.add('active');
    }
    
    // Clear errors
    document.getElementById('signinError').style.display = 'none';
    document.getElementById('signupError').style.display = 'none';
};

// Handle sign-in form submission
window.handleSignIn = async function(event) {
    event.preventDefault();
    
    const username = document.getElementById('signinUsername').value.trim();
    const password = document.getElementById('signinPassword').value;
    const errorDiv = document.getElementById('signinError');
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            errorDiv.textContent = data.error || 'Login failed';
            errorDiv.style.display = 'block';
            return;
        }
        
        // Store token and user data
        setAuthToken(data.token);
        setStoredUser(data.user);
        
        // Complete login process
        completeLogin(data.user);
        
    } catch (error) {
        console.error('Login error:', error);
        errorDiv.textContent = 'Connection error. Please try again.';
        errorDiv.style.display = 'block';
    }
};

// Handle sign-up form submission
window.handleSignUp = async function(event) {
    event.preventDefault();
    
    const firstName = document.getElementById('signupFirstName').value.trim();
    const lastName = document.getElementById('signupLastName').value.trim();
    const username = document.getElementById('signupUsername').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('signupConfirmPassword').value;
    const gender = document.getElementById('signupGender').value;
    const about = document.getElementById('signupAbout').value.trim();
    const errorDiv = document.getElementById('signupError');
    
    // Validate passwords match
    if (password !== confirmPassword) {
        errorDiv.textContent = 'Passwords do not match';
        errorDiv.style.display = 'block';
        return;
    }
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName, lastName, username, password, gender, about })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            errorDiv.textContent = data.error || 'Registration failed';
            errorDiv.style.display = 'block';
            return;
        }
        
        // Store token and user data
        setAuthToken(data.token);
        setStoredUser(data.user);
        
        // Complete login process
        completeLogin(data.user);
        
    } catch (error) {
        console.error('Registration error:', error);
        errorDiv.textContent = 'Connection error. Please try again.';
        errorDiv.style.display = 'block';
    }
};

// Complete the login process after authentication
function completeLogin(user) {
    currentUser = user.username;
    
    // Join socket with username (wait for connection if needed)
    if (socket.connected) {
        socket.emit('join', user.username);
        console.log('Joined socket immediately:', socket.id);
    } else {
        // Wait for socket to connect, then join
        socket.once('connect', () => {
            socket.emit('join', user.username);
            console.log('Joined socket after connect:', socket.id);
        });
    }
    
    // Update UI with user info
    updateUserDisplay(user);
    
    // Navigate to user home
    showSection('userHome');
    
    // Request notification permission
    requestNotificationPermission();
    
    console.log('Logged in as:', user.username);
}

// Update UI with user information
function updateUserDisplay(user) {
    const firstName = user.firstName || user.username;
    const lastName = user.lastName || '';
    const fullName = lastName ? `${firstName} ${lastName}` : firstName;
    
    // Update header with full name
    const userDisplayName = document.getElementById('userDisplayName');
    if (userDisplayName) {
        userDisplayName.textContent = `Welcome, ${fullName}!`;
    }
    
    // Update sidebar first names
    const sidebarFirstNames = ['profileFirstName', 'friendsProfileFirstName'];
    sidebarFirstNames.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = firstName;
    });
    
    // Update sidebar usernames
    const sidebarUsernames = ['profileUsername', 'friendsProfileUsername'];
    sidebarUsernames.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = `@${user.username}`;
    });
    
    // Update streamer display name if present
    const streamerDisplayName = document.getElementById('streamerDisplayName');
    if (streamerDisplayName) streamerDisplayName.textContent = fullName;
}

// Check if user is already logged in on page load
async function checkExistingSession() {
    const token = getAuthToken();
    if (!token) return;
    
    try {
        const response = await fetch('/api/verify-token', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.valid) {
                setStoredUser(data.user);
                completeLogin(data.user);
            }
        } else {
            // Token invalid, clear it
            clearAuthToken();
        }
    } catch (error) {
        console.error('Session check error:', error);
    }
}

// Logout function
window.logout = function() {
    clearAuthToken();
    currentUser = '';
    socket.emit('user-disconnected');
    showSection('login');
    console.log('Logged out');
};

// Check session on page load
document.addEventListener('DOMContentLoaded', () => {
    checkExistingSession();
});

const servers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Join chat with username
function joinChat() {
    const username = document.getElementById('usernameInput').value.trim();
    if (username) {
        currentUser = username;
        socket.emit('join', username);
        
        // Update UI with current user name
        document.getElementById('currentUserName').textContent = username;
        
        document.getElementById('loginForm').classList.add('hidden');
        document.getElementById('chatInterface').classList.remove('hidden');
        
        // Request notification permission
        requestNotificationPermission();
    }
}

// Request notification permission
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                console.log('Notification permission granted');
            }
        });
    }
}

// Show notification
function showNotification(title, message) {
    // Check if notifications are enabled
    if (!notificationsEnabled) return;
    
    // Browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(title, {
            body: message,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: 'chat-message'
        });
        
        // Auto close after 5 seconds
        setTimeout(() => notification.close(), 5000);
        
        // Focus window when notification is clicked
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }
    
    // In-app notification
    showInAppNotification(title, message);
}

// Toggle notifications
function toggleNotifications() {
    notificationsEnabled = document.getElementById('notificationToggle').checked;
    
    if (notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    // Show feedback
    const status = notificationsEnabled ? 'enabled' : 'disabled';
    showInAppNotification('Notifications', `Notifications ${status}`);
}

// Show in-app notification (global function for use across scripts)
window.showInAppNotification = function(title, message) {
    const notification = document.createElement('div');
    notification.className = 'in-app-notification';
    
    // Create elements safely to prevent XSS
    const content = document.createElement('div');
    content.className = 'notification-content';
    
    const titleEl = document.createElement('strong');
    titleEl.textContent = title;
    
    const msgEl = document.createElement('p');
    msgEl.textContent = message;
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'notification-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = function() { notification.remove(); };
    
    content.appendChild(titleEl);
    content.appendChild(msgEl);
    notification.appendChild(content);
    notification.appendChild(closeBtn);
    
    document.body.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

// Play notification sound
function playNotificationSound() {
    // Create audio context for notification sound
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
    } catch (error) {
        console.log('Audio notification not supported');
    }
}

// Update user list
socket.on('users-update', (users) => {
    const userList = document.getElementById('userList');
    const onlineUsersCount = document.getElementById('onlineUsers');
    const onlineFriendsList = document.getElementById('onlineFriendsList');
    
    if (userList) {
        userList.innerHTML = '';
        
        users.forEach(user => {
            if (user.username !== currentUser) {
                const userDiv = document.createElement('div');
                userDiv.className = 'user-item';
                userDiv.textContent = user.username;
                userDiv.onclick = () => startPrivateChat(user.username, user.socketId);
                userList.appendChild(userDiv);
            }
        });
    }
    
    // Update dashboard stats
    if (onlineUsersCount) {
        onlineUsersCount.textContent = users.length;
    }
    
    // Update friends page list
    const friendsPageList = document.getElementById('friendsPageList');
    if (friendsPageList) {
        console.log('Users count:', users.length);
        if (users.length <= 1) {
            friendsPageList.innerHTML = '<div class="no-friends" style="text-align: center; opacity: 0.7; padding: 2rem; grid-column: 1 / -1;">No friends online</div>';
        } else {
            const filteredUsers = users.filter(user => user.username !== currentUser);
            friendsPageList.innerHTML = '';
            
            filteredUsers.forEach(user => {
                const card = document.createElement('div');
                card.className = 'friend-card';
                card.style.cssText = 'background: rgba(255,255,255,0.1); border-radius: 15px; padding: 1.5rem; text-align: center; cursor: pointer; transition: transform 0.3s;';
                card.onclick = function() {
                    startPrivateConversation(user.username, user.socketId);
                    window.showUserSection('messages');
                };
                card.onmouseover = function() { this.style.transform = 'translateY(-5px)'; };
                card.onmouseout = function() { this.style.transform = 'translateY(0)'; };
                
                const avatar = document.createElement('div');
                avatar.style.cssText = 'width: 60px; height: 60px; background: linear-gradient(45deg, #3498db, #2980b9); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; margin: 0 auto 1rem;';
                avatar.textContent = '👤';
                
                const nameEl = document.createElement('h4');
                nameEl.style.cssText = 'margin: 0 0 0.5rem 0; color: white;';
                nameEl.textContent = user.username;
                
                const statusEl = document.createElement('p');
                statusEl.style.cssText = 'margin: 0; opacity: 0.7; color: white;';
                statusEl.textContent = 'Online';
                
                card.appendChild(avatar);
                card.appendChild(nameEl);
                card.appendChild(statusEl);
                friendsPageList.appendChild(card);
            });
        }
    }
});

// Start private chat
function startPrivateChat(username, socketId) {
    // Check if this is a new chat (not already active)
    const isNewChat = !currentChat || currentChat.socketId !== socketId;
    
    currentChat = { username, socketId, type: 'private' };
    currentChatType = 'private';
    
    // Set header safely
    const chatHeader = document.getElementById('chatHeader');
    chatHeader.innerHTML = '';
    const h3 = document.createElement('h3');
    h3.textContent = 'Private Chat with ' + username;
    chatHeader.appendChild(h3);
    
    // Only clear messages for new chats, keep existing messages for same chat
    if (isNewChat) {
        document.getElementById('messages').innerHTML = '';
    }
    
    console.log(`Starting private chat with ${username}`);
    
    // Only send notification for new chats, not when switching back to existing chat
    if (isNewChat) {
        socket.emit('private-chat-request', {
            targetUserId: socketId,
            targetUsername: username
        });
    }
    
    socket.emit('join-private-chat', {
        userId: socket.id,
        targetUserId: socketId
    });
}

// Join group chat
function joinGroup(groupId) {
    currentChat = { groupId, type: 'group' };
    currentChatType = 'group';
    
    // Set header safely
    const chatHeader = document.getElementById('chatHeader');
    chatHeader.innerHTML = '';
    const h3 = document.createElement('h3');
    h3.textContent = 'Group: ' + groupId;
    chatHeader.appendChild(h3);
    
    document.getElementById('messages').innerHTML = '';
    
    // Emit join-group event to server
    socket.emit('join-group', groupId);
    
    console.log(`Joined group: ${groupId}`);
}

// Send message
function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (message && currentChat) {
        if (currentChatType === 'private') {
            // Display own message immediately
            displayMessage({
                senderName: currentUser,
                message: message,
                timestamp: new Date().toLocaleTimeString()
            }, true);
            
            // Send to server
            socket.emit('private-message', {
                senderId: socket.id,
                receiverId: currentChat.socketId,
                senderName: currentUser,
                message: message
            });
        } else {
            socket.emit('group-message', {
                senderId: socket.id,
                senderName: currentUser,
                groupId: currentChat.groupId,
                message: message
            });
        }
        
        messageInput.value = '';
    }
}

// Handle Enter key press
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// Display message (XSS-safe)
function displayMessage(data, isOwn = false) {
    const messagesDiv = document.getElementById('chatMessages') || document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own' : ''}`;
    
    // Create elements safely
    const senderEl = document.createElement('strong');
    senderEl.textContent = data.senderName + ':';
    
    const msgText = document.createTextNode(' ' + data.message);
    
    const timestampEl = document.createElement('div');
    timestampEl.style.cssText = 'font-size: 0.8em; color: #666; margin-top: 5px;';
    timestampEl.textContent = data.timestamp;
    
    messageDiv.appendChild(senderEl);
    messageDiv.appendChild(msgText);
    messageDiv.appendChild(timestampEl);
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Safe message display that preserves layout (XSS-safe)
function safeDisplayMessage(conversationId, messageData) {
    if (activeConversation !== conversationId) return;
    
    const messagesContainer = document.getElementById('conversationMessages');
    if (!messagesContainer) return;
    
    // Create message element with proper styling
    const messageEl = document.createElement('div');
    messageEl.className = `message ${messageData.isOwn ? 'own' : ''}`;
    messageEl.style.cssText = 'margin: 10px 0; padding: 10px; background: #ecf0f1; border-radius: 5px; color: #333;';
    if (messageData.isOwn) {
        messageEl.style.cssText += 'background: #3498db; color: white; margin-left: 50px;';
    }
    
    // Create elements safely
    const senderEl = document.createElement('strong');
    senderEl.textContent = messageData.senderName + ':';
    
    const msgText = document.createTextNode(' ' + messageData.message);
    
    const timestampEl = document.createElement('div');
    timestampEl.style.cssText = 'font-size: 0.8em; opacity: 0.7; margin-top: 5px;';
    timestampEl.textContent = messageData.timestamp;
    
    messageEl.appendChild(senderEl);
    messageEl.appendChild(msgText);
    messageEl.appendChild(timestampEl);
    
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Receive private messages
socket.on('receive-message', (data) => {
    console.log('Received message:', data);
    const isOwn = data.senderName === currentUser;
    
    // Update message count for all navigation areas
    if (!isOwn) {
        updateMessageCount();
    }
    
    // Add to inbox conversation
    if (typeof window.handleNewMessage === 'function') {
        window.handleNewMessage(data);
    }
    
    // Only display in legacy chat if currently in that chat
    if (currentChat && currentChat.username === data.senderName) {
        displayMessage(data, isOwn);
    }
    
    // Show notification for incoming messages (not own messages)
    if (!isOwn) {
        showNotification(`New message from ${data.senderName}`, data.message);
        playNotificationSound();
    }
});

// Receive group messages
socket.on('receive-group-message', (data) => {
    console.log('Received group message:', data);
    const isOwn = data.senderName === currentUser;
    displayMessage(data, isOwn);
    
    // Show notification for group messages (not own messages)
    if (!isOwn) {
        showNotification(`${data.groupId} - ${data.senderName}`, data.message);
        playNotificationSound();
    }
});

// Video calling functions
async function startVideoCall() {
    if (!currentChat || currentChatType !== 'private') {
        alert('Select a user for video call');
        return;
    }
    
    try {
        // Check available devices first
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasVideo = devices.some(device => device.kind === 'videoinput');
        const hasAudio = devices.some(device => device.kind === 'audioinput');
        
        console.log('Available devices:', devices);
        console.log('Has video:', hasVideo, 'Has audio:', hasAudio);
        
        if (!hasVideo && !hasAudio) {
            alert('No camera or microphone detected. Please connect a webcam or use a device with built-in camera.');
            return;
        }
        
        // Request only available media
        const constraints = {
            video: hasVideo,
            audio: hasAudio
        };
        
        console.log('Requesting media with constraints:', constraints);
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('videoContainer').style.display = 'block';
        
        peerConnection = new RTCPeerConnection(servers);
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        peerConnection.ontrack = (event) => {
            remoteStream = event.streams[0];
            document.getElementById('remoteVideo').srcObject = remoteStream;
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', {
                    targetSocketId: currentChat.socketId,
                    candidate: event.candidate
                });
            }
        };
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('video-call-offer', {
            targetSocketId: currentChat.socketId,
            offer: offer
        });
        
    } catch (error) {
        console.error('Error starting video call:', error);
        
        let errorMessage = 'Video call failed: ';
        
        if (error.name === 'NotAllowedError') {
            errorMessage += 'Please allow camera/microphone access when prompted.';
        } else if (error.name === 'NotFoundError') {
            errorMessage += 'No camera or microphone found. Connect a webcam or use a device with camera.';
        } else {
            errorMessage += error.message || 'Unknown error occurred.';
        }
        
        alert(errorMessage);
    }
}

// Handle incoming video call
socket.on('video-call-offer', async (data) => {
    const accept = confirm(`Incoming video call from ${data.callerName}. Accept?`);
    
    if (accept) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            document.getElementById('localVideo').srcObject = localStream;
            document.getElementById('videoContainer').style.display = 'block';
            
            peerConnection = new RTCPeerConnection(servers);
            
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
            
            peerConnection.ontrack = (event) => {
                remoteStream = event.streams[0];
                document.getElementById('remoteVideo').srcObject = remoteStream;
            };
            
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice-candidate', {
                        targetSocketId: data.callerSocketId,
                        candidate: event.candidate
                    });
                }
            };
            
            await peerConnection.setRemoteDescription(data.offer);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.emit('video-call-answer', {
                callerSocketId: data.callerSocketId,
                answer: answer
            });
            
        } catch (error) {
            console.error('Error accepting video call:', error);
        }
    }
});

// Handle video call answer
socket.on('video-call-answer', async (data) => {
    await peerConnection.setRemoteDescription(data.answer);
});

// Handle ICE candidates
socket.on('ice-candidate', async (data) => {
    await peerConnection.addIceCandidate(data.candidate);
});

// End video call
function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection) {
        peerConnection.close();
    }
    
    document.getElementById('videoContainer').style.display = 'none';
    localStream = null;
    remoteStream = null;
    peerConnection = null;
}

// Live streaming state
let isStartingStream = false;

// Live streaming with WebRTC broadcasting
async function startLiveStream() {
    // Prevent multiple simultaneous requests
    if (isStartingStream) {
        showInAppNotification('Please Wait', 'Stream is being initialized...');
        return;
    }
    
    // First, check broadcast availability and get a stream key
    try {
        // Verify socket is connected and user is logged in
        if (!socket.connected) {
            showInAppNotification('Connecting...', 'Waiting for server connection...');
            // Wait for socket to connect, then retry
            socket.once('connect', () => {
                setTimeout(() => startLiveStream(), 500);
            });
            return;
        }
        
        if (!currentUser) {
            showInAppNotification('Login Required', 'Please log in before starting a stream.');
            return;
        }
        
        // Lock the function
        isStartingStream = true;
        updateGoLiveButtons(true, 'Starting...');
        
        console.log('Starting stream - Socket ID:', socket.id, 'User:', currentUser);
        
        // Check if platform has available slots
        const statusResponse = await fetch('/api/broadcast-status');
        const status = await statusResponse.json();
        
        if (!status.available) {
            showInAppNotification('Stream Limit Reached', 
                `Maximum ${status.maxStreams} streams are already live. Please try again later.`);
            isStartingStream = false;
            updateGoLiveButtons(false);
            return;
        }
        
        // Request a stream key from the server
        const keyResponse = await fetch('/api/get-stream-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ socketId: socket.id })
        });
        
        if (!keyResponse.ok) {
            const error = await keyResponse.json();
            console.error('Stream key error:', error, 'Socket ID:', socket.id);
            showInAppNotification('Cannot Start Stream', error.error || 'Unable to start stream');
            isStartingStream = false;
            updateGoLiveButtons(false);
            return;
        }
        
        const { streamKey } = await keyResponse.json();
        window.currentStreamKey = streamKey;
        
        // Now get camera/microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        
        // Store stream for broadcasting
        window.broadcastStream = stream;
        window.streamViewers = new Map();
        window.streamStartTime = Date.now();
        
        // Set up streamer video
        const streamerVideo = document.getElementById('streamerVideo');
        if (streamerVideo) {
            streamerVideo.srcObject = stream;
        }
        
        // Update stream title and key
        document.getElementById('streamTitle').textContent = `${currentUser}'s Live Stream`;
        const streamKeyElement = document.getElementById('streamKey');
        if (streamKeyElement) {
            streamKeyElement.textContent = streamKey;
        }
        
        // Show streamer dashboard
        window.showSection('streamerDashboard');
        
        // Start duration timer
        startStreamTimer();
        
        // Notify other users about the stream
        socket.emit('start-stream', {
            streamKey: streamKey,
            title: `${currentUser}'s Live Stream`,
            streamerId: socket.id
        });
        
        showInAppNotification('🔴 You are LIVE!', 'Your stream has started successfully.');
        
        // Unlock after success (stream is now active)
        isStartingStream = false;
        updateGoLiveButtons(false);
        
    } catch (error) {
        console.error('Error starting live stream:', error);
        
        // Unlock on error
        isStartingStream = false;
        updateGoLiveButtons(false);
        
        // Clean up stream key if we got one but failed later
        if (window.currentStreamKey) {
            window.currentStreamKey = null;
        }
        
        let errorMessage = 'Error starting stream: ';
        if (error.name === 'NotAllowedError') {
            errorMessage = 'Please allow camera/microphone access when prompted.';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'No camera or microphone found. Connect a webcam or use a device with camera.';
        } else {
            errorMessage = error.message || 'Unknown error occurred.';
        }
        
        showInAppNotification('Stream Error', errorMessage);
    }
}

// Helper function to update Go Live button states
function updateGoLiveButtons(disabled, text = null) {
    const buttons = [
        document.getElementById('goLiveButton'),
        document.getElementById('goLiveButton2'),
        document.querySelector('button[onclick="startLiveStream()"]')
    ];
    
    buttons.forEach(btn => {
        if (btn) {
            if (disabled) {
                btn.style.opacity = '0.6';
                btn.style.pointerEvents = 'none';
                if (text) {
                    btn.dataset.originalText = btn.textContent || btn.innerText;
                    btn.textContent = text;
                }
            } else {
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
                if (btn.dataset.originalText) {
                    btn.textContent = btn.dataset.originalText;
                    delete btn.dataset.originalText;
                }
            }
        }
    });
}

// Stop streaming function
function stopStreaming() {
    if (window.broadcastStream) {
        // Stop all tracks
        window.broadcastStream.getTracks().forEach(track => track.stop());
        
        // Close all viewer connections
        if (window.streamViewers) {
            window.streamViewers.forEach(pc => pc.close());
            window.streamViewers.clear();
        }
        
        // Stop timer
        if (window.streamTimer) {
            clearInterval(window.streamTimer);
        }
        
        // Notify viewers that stream ended (include stream key for cleanup)
        socket.emit('stop-stream', { streamKey: window.currentStreamKey || 'ended' });
        
        window.broadcastStream = null;
        window.currentStreamKey = null;
        
        showInAppNotification('Stream Ended', 'Your live stream has ended.');
        
        // Go back to user home
        window.showSection('userHome');
    }
}

// Start stream duration timer
function startStreamTimer() {
    window.streamTimer = setInterval(() => {
        const duration = Date.now() - window.streamStartTime;
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);
        document.getElementById('streamDuration').textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
}

// Update viewer count
function updateViewerCount() {
    const count = window.streamViewers ? window.streamViewers.size : 0;
    const viewerCountElement = document.getElementById('viewerCount');
    if (viewerCountElement) {
        viewerCountElement.textContent = count;
        console.log('Updated viewer count to:', count);
    }
}

// Handle viewer count updates
socket.on('viewer-count-update', (data) => {
    console.log('Viewer count update:', data);
    
    // Update streamer dashboard viewer count
    const viewerCountElement = document.getElementById('viewerCount');
    if (viewerCountElement) {
        viewerCountElement.textContent = data.count;
    }
    
    // Update stream viewer page viewer count
    const streamViewerCountElement = document.getElementById('streamViewerCount');
    if (streamViewerCountElement && window.currentStreamData && window.currentStreamData.streamerId === data.streamerId) {
        streamViewerCountElement.textContent = data.count;
    }
});

// Handle new live streams
socket.on('new-stream', (data) => {
    console.log('New stream started:', data.streamerName);
    
    // Add to current live streams
    if (!window.currentLiveStreams) {
        window.currentLiveStreams = [];
    }
    window.currentLiveStreams.push(data);
    
    // Update dashboard directly
    updateLiveStreamsDisplay();
});

// Helper function to safely render live streams (XSS-safe)
function updateLiveStreamsDisplay() {
    const dashboardLiveStreams = document.getElementById('dashboardLiveStreams');
    if (!dashboardLiveStreams || !window.currentLiveStreams || window.currentLiveStreams.length === 0) {
        if (dashboardLiveStreams) {
            dashboardLiveStreams.innerHTML = '<div class="no-streams-msg">No live streams at the moment</div>';
        }
        return;
    }
    
    dashboardLiveStreams.innerHTML = '';
    
    window.currentLiveStreams.forEach(stream => {
        const card = document.createElement('div');
        card.className = 'youtube-stream-card';
        card.dataset.streamId = stream.streamerId;
        card.dataset.streamName = stream.streamerName;
        card.dataset.streamTitle = stream.title;
        
        const thumbnail = document.createElement('div');
        thumbnail.className = 'stream-thumbnail';
        
        const liveBadge = document.createElement('div');
        liveBadge.className = 'live-badge';
        liveBadge.textContent = 'LIVE';
        
        const preview = document.createElement('div');
        preview.className = 'stream-preview';
        preview.textContent = '📺';
        
        thumbnail.appendChild(liveBadge);
        thumbnail.appendChild(preview);
        
        const details = document.createElement('div');
        details.className = 'stream-details';
        
        const title = document.createElement('h4');
        title.textContent = stream.title;
        
        const streamer = document.createElement('p');
        streamer.textContent = stream.streamerName;
        
        const viewerCount = document.createElement('span');
        viewerCount.className = 'viewer-count';
        viewerCount.textContent = 'Live now';
        
        details.appendChild(title);
        details.appendChild(streamer);
        details.appendChild(viewerCount);
        
        card.appendChild(thumbnail);
        card.appendChild(details);
        
        card.onclick = () => {
            window.joinLiveStream(stream.streamerId, stream.streamerName, stream.title);
        };
        
        dashboardLiveStreams.appendChild(card);
    });
}

// Handle stream ended
socket.on('stream-ended', (data) => {
    // Remove from current live streams
    if (window.currentLiveStreams) {
        window.currentLiveStreams = window.currentLiveStreams.filter(stream => stream.streamerId !== data.streamerId);
        
        // Update dashboard using helper function
        updateLiveStreamsDisplay();
    }
    
    alert(`${data.streamerName}'s stream has ended.`);
    
    // If viewing this stream, go back to user home
    if (currentStreamData && currentStreamData.streamerId === data.streamerId) {
        window.showSection('userHome');
    }
});

// Handle stream errors (e.g., broadcast limits)
socket.on('stream-error', (data) => {
    console.log('Stream error:', data);
    showInAppNotification('Stream Error', data.error || 'Unable to start stream');
});

// Handle stream duration limit notification
socket.on('stream-duration-limit', (data) => {
    console.log('Stream duration limit:', data);
    showInAppNotification('⏰ Stream Duration Limit', data.message || 'Maximum stream duration reached');
    // Don't auto-stop, just warn the user
});

// Load and display live streams in sidebar
function loadLiveStreamsInSidebar() {
    // This function is now handled in index.html
}

// Handle stream viewer request
socket.on('stream-viewer-request', async (data) => {
    console.log('Stream viewer request received:', data);
    if (window.broadcastStream) {
        console.log('Broadcast stream exists, setting up peer connection');
        try {
            const peerConnection = new RTCPeerConnection(servers);
            
            // Add stream tracks to peer connection
            window.broadcastStream.getTracks().forEach(track => {
                console.log('Adding track to peer connection:', track.kind);
                peerConnection.addTrack(track, window.broadcastStream);
            });
            
            // Handle ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('Sending ICE candidate to viewer:', data.viewerId);
                    socket.emit('stream-ice-candidate', {
                        viewerId: data.viewerId,
                        candidate: event.candidate
                    });
                }
            };
            
            // Handle connection state changes
            peerConnection.onconnectionstatechange = () => {
                console.log('Viewer connection state:', peerConnection.connectionState);
                if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
                    window.streamViewers.delete(data.viewerId);
                    updateViewerCount();
                }
            };
            
            // Create offer for viewer
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            console.log('Created offer, storing viewer connection');
            // Initialize streamViewers if not exists
            if (!window.streamViewers) {
                window.streamViewers = new Map();
            }
            window.streamViewers.set(data.viewerId, peerConnection);
            updateViewerCount();
            
            // Send offer to viewer
            socket.emit('stream-offer', {
                viewerId: data.viewerId,
                offer: offer
            });
            
        } catch (error) {
            console.error('Error setting up stream for viewer:', error);
        }
    } else {
        console.log('No broadcast stream available');
    }
});

// Handle stream offer (as viewer)
socket.on('stream-offer', async (data) => {
    console.log('Received stream offer:', data);
    try {
        if (!window.viewerPeerConnection) {
            console.log('Creating viewer peer connection');
            window.viewerPeerConnection = new RTCPeerConnection(servers);
            
            // Handle incoming stream
            window.viewerPeerConnection.ontrack = (event) => {
                console.log('Received remote stream track:', event);
                console.log('Event streams:', event.streams);
                const remoteStream = event.streams[0];
                const streamPlayer = document.getElementById('streamViewerVideo');
                if (streamPlayer) {
                    console.log('Setting stream to streamViewerVideo player');
                    streamPlayer.srcObject = remoteStream;
                    console.log('Video player srcObject set to:', remoteStream);
                    
                    // Force play
                    streamPlayer.play().then(() => {
                        console.log('Video started playing');
                    }).catch(err => {
                        console.error('Error playing video:', err);
                    });
                } else {
                    console.log('streamViewerVideo player not found!');
                }
            };
            
            // Handle ICE candidates
            window.viewerPeerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('Sending ICE candidate to streamer');
                    socket.emit('stream-ice-candidate', {
                        streamerId: data.streamerId,
                        candidate: event.candidate
                    });
                }
            };
        }
        
        console.log('Setting remote description and creating answer');
        await window.viewerPeerConnection.setRemoteDescription(data.offer);
        const answer = await window.viewerPeerConnection.createAnswer();
        await window.viewerPeerConnection.setLocalDescription(answer);
        
        console.log('Sending answer to streamer');
        socket.emit('stream-answer', {
            streamerId: data.streamerId,
            answer: answer
        });
        
        // Request current viewer count after connection
        setTimeout(() => {
            socket.emit('request-viewer-count', { streamerId: data.streamerId });
        }, 1000);
        
    } catch (error) {
        console.error('Error handling stream offer:', error);
    }
});

// Handle stream answer (as streamer)
socket.on('stream-answer', async (data) => {
    console.log('Received stream answer:', data);
    try {
        if (window.streamViewers && window.streamViewers.has(data.viewerId)) {
            const peerConnection = window.streamViewers.get(data.viewerId);
            console.log('Setting remote description with answer');
            await peerConnection.setRemoteDescription(data.answer);
            console.log('Remote description set successfully');
        } else {
            console.log('No viewer connection found for answer');
        }
    } catch (error) {
        console.error('Error handling stream answer:', error);
    }
});

// Handle stream ICE candidates
socket.on('stream-ice-candidate', async (data) => {
    console.log('Received ICE candidate:', data);
    try {
        if (data.viewerId && window.streamViewers && window.streamViewers.has(data.viewerId)) {
            // As streamer, add candidate to viewer's connection
            console.log('Adding ICE candidate to viewer connection');
            const peerConnection = window.streamViewers.get(data.viewerId);
            await peerConnection.addIceCandidate(data.candidate);
            console.log('ICE candidate added successfully');
        } else if (data.streamerId && window.viewerPeerConnection) {
            // As viewer, add candidate to streamer's connection
            console.log('Adding ICE candidate to streamer connection');
            await window.viewerPeerConnection.addIceCandidate(data.candidate);
            console.log('ICE candidate added successfully');
        } else {
            console.log('No matching connection found for ICE candidate');
            console.log('viewerId:', data.viewerId, 'streamViewers exists:', !!window.streamViewers);
            console.log('streamerId:', data.streamerId, 'viewerPeerConnection exists:', !!window.viewerPeerConnection);
        }
    } catch (error) {
        console.error('Error handling ICE candidate:', error);
    }
});

// Handle stream chat messages
socket.on('streamer-receives-chat', (data) => {
    console.log('Streamer received chat message:', data);
    if (window.broadcastStream && document.getElementById('streamerMessages')) {
        displayStreamerMessage(data, false);
    }
});

socket.on('viewer-receives-chat', (data) => {
    console.log('Viewer received chat message:', data);
    if (window.currentStreamData && document.getElementById('streamMessages') && !window.broadcastStream) {
        displayStreamMessage(data, false);
    }
});

// Handle streamer chat messages (for viewers)
socket.on('streamer-chat-received', (data) => {
    // Show in viewer's chat
    if (document.getElementById('streamMessages')) {
        displayStreamMessage(data, false);
    }
    // Show in streamer's own chat
    if (document.getElementById('streamerMessages')) {
        displayStreamerMessage(data, false);
    }
});

// Handle stream chat
function sendStreamChat() {
    const input = document.getElementById('streamChatInput');
    const message = input.value.trim();
    
    console.log('sendStreamChat called:', { message, currentStreamData, currentUser });
    
    if (message && window.currentStreamData && currentUser) {
        // Display own message immediately
        displayStreamMessage({
            senderName: currentUser,
            message: message,
            timestamp: new Date().toLocaleTimeString()
        }, true);
        
        // Send to streamer and other viewers
        socket.emit('stream-chat-message', {
            streamerId: window.currentStreamData.streamerId,
            senderName: currentUser,
            message: message
        });
        
        input.value = '';
    } else {
        console.log('Cannot send message:', { 
            hasMessage: !!message, 
            hasStreamData: !!window.currentStreamData, 
            hasCurrentUser: !!currentUser 
        });
    }
}

function handleStreamChatKeyPress(event) {
    if (event.key === 'Enter') {
        sendStreamChat();
    }
}

// Display stream chat message
function displayStreamMessage(data, isOwn = false) {
    const messagesDiv = document.getElementById('streamMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message' + (isOwn ? ' own' : '');
    
    const sender = document.createElement('strong');
    sender.textContent = data.senderName + ':';
    const msgText = document.createTextNode(' ' + data.message);
    const timestamp = document.createElement('div');
    timestamp.style.cssText = 'font-size: 0.8em; color: #666; margin-top: 5px;';
    timestamp.textContent = data.timestamp;
    
    messageDiv.appendChild(sender);
    messageDiv.appendChild(msgText);
    messageDiv.appendChild(timestamp);
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Display streamer chat message
function displayStreamerMessage(data, isOwn = false) {
    const messagesDiv = document.getElementById('streamerMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message' + (isOwn ? ' own' : '');
    
    const sender = document.createElement('strong');
    sender.textContent = data.senderName + ':';
    const msgText = document.createTextNode(' ' + data.message);
    const timestamp = document.createElement('div');
    timestamp.style.cssText = 'font-size: 0.8em; color: #666; margin-top: 5px;';
    timestamp.textContent = data.timestamp;
    
    messageDiv.appendChild(sender);
    messageDiv.appendChild(msgText);
    messageDiv.appendChild(timestamp);
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Handle streamer chat
function sendStreamerChat() {
    const input = document.getElementById('streamerChatInput');
    const message = input.value.trim();
    
    if (message && currentUser) {
        // Display own message
        displayStreamerMessage({
            senderName: currentUser,
            message: message,
            timestamp: new Date().toLocaleTimeString()
        }, true);
        
        // Send to all viewers
        socket.emit('streamer-chat-message', {
            senderName: currentUser,
            message: message
        });
        
        input.value = '';
    }
}

function handleStreamerChatKeyPress(event) {
    if (event.key === 'Enter') {
        sendStreamerChat();
    }
}

// Open conversation in inbox (XSS-safe)
window.openConversation = function(conversationId) {
    activeConversation = conversationId;
    const conversation = conversations.get(conversationId);
    
    if (!conversation) return;
    
    // Update conversation view with complete structure
    const conversationView = document.getElementById('conversationView');
    conversationView.innerHTML = '';
    
    // Create header
    const header = document.createElement('div');
    header.className = 'conversation-header';
    const h3 = document.createElement('h3');
    h3.textContent = conversation.username;
    const videoBtn = document.createElement('button');
    videoBtn.className = 'video-call-btn';
    videoBtn.textContent = '📹 Video Call';
    videoBtn.onclick = function() { startVideoCallWithUser(conversation.socketId); };
    header.appendChild(h3);
    header.appendChild(videoBtn);
    
    // Create messages container
    const messagesDiv = document.createElement('div');
    messagesDiv.className = 'conversation-messages';
    messagesDiv.id = 'conversationMessages';
    
    conversation.messages.forEach(msg => {
        const msgEl = document.createElement('div');
        msgEl.className = 'message' + (msg.isOwn ? ' own' : '');
        const sender = document.createElement('strong');
        sender.textContent = msg.senderName + ':';
        const msgText = document.createTextNode(' ' + msg.message);
        const timestamp = document.createElement('div');
        timestamp.style.cssText = 'font-size: 0.8em; opacity: 0.7; margin-top: 5px;';
        timestamp.textContent = msg.timestamp;
        msgEl.appendChild(sender);
        msgEl.appendChild(msgText);
        msgEl.appendChild(timestamp);
        messagesDiv.appendChild(msgEl);
    });
    
    // Create input area
    const inputArea = document.createElement('div');
    inputArea.className = 'conversation-input';
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.id = 'conversationInput';
    inputEl.placeholder = 'Type a message...';
    inputEl.onkeypress = function(e) { handleConversationKeyPress(e); };
    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send';
    sendBtn.onclick = function() { sendConversationMessage(); };
    inputArea.appendChild(inputEl);
    inputArea.appendChild(sendBtn);
    
    conversationView.appendChild(header);
    conversationView.appendChild(messagesDiv);
    conversationView.appendChild(inputArea);
    
    // Scroll to bottom
    setTimeout(() => {
        const msgDiv = document.getElementById('conversationMessages');
        if (msgDiv) {
            msgDiv.scrollTop = msgDiv.scrollHeight;
        }
    }, 10);
    
    // Update active conversation in list
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-conversation="${conversationId}"]`)?.classList.add('active');
};

// Handle private chat requests
socket.on('private-chat-notification', (data) => {
    console.log('Received private chat notification:', data);
    showNotification(`${data.fromUser} wants to chat`, 'Click to start private conversation');
    playNotificationSound();
    
    // Auto-switch to private chat with the person who initiated
    setTimeout(() => {
        const userItems = document.querySelectorAll('.user-item');
        userItems.forEach(item => {
            if (item.textContent === data.fromUser) {
                item.style.background = '#e74c3c';
                item.style.animation = 'pulse 1s infinite';
                
                // Remove highlight after 10 seconds
                setTimeout(() => {
                    item.style.background = '#34495e';
                    item.style.animation = 'none';
                }, 10000);
            }
        });
    }, 100);
});

// Handle force room join
socket.on('force-join-room', (data) => {
    socket.join(data.roomId);
    console.log('Force joined room:', data.roomId);
});

// Update message count notification
let unreadMessageCount = 0;

function updateMessageCount() {
    unreadMessageCount++;
    
    // Update all message count badges
    const messageCountElements = [
        document.getElementById('streamerMessageCount'),
        document.getElementById('userMessageCount'),
        document.getElementById('viewerMessageCount')
    ];
    
    messageCountElements.forEach(element => {
        if (element) {
            element.textContent = unreadMessageCount;
            element.style.display = unreadMessageCount > 0 ? 'inline' : 'none';
        }
    });
}

// Clear message count when viewing messages
function clearMessageCount() {
    unreadMessageCount = 0;
    
    const messageCountElements = [
        document.getElementById('streamerMessageCount'),
        document.getElementById('userMessageCount'),
        document.getElementById('viewerMessageCount')
    ];
    
    messageCountElements.forEach(element => {
        if (element) {
            element.style.display = 'none';
        }
    });
}

// Update showUserSection to clear message count when viewing messages
function showUserSection(sectionName) {
    // Clear message count when viewing messages
    if (sectionName === 'messages') {
        clearMessageCount();
    }
    
    // Hide all user sections
    document.querySelectorAll('.user-section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Remove active class from user nav links
    document.querySelectorAll('.user-nav-link').forEach(link => {
        link.classList.remove('active');
    });
    
    // Show selected section
    document.getElementById(sectionName).classList.add('active');
    
    // Add active class to corresponding nav link
    if (event && event.target) {
        event.target.classList.add('active');
    }
}