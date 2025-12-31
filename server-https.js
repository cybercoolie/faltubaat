require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { 
    initDatabase, 
    createUser, 
    findUserByUsername, 
    findUserById,
    findUserByIdWithPassword,
    verifyPassword, 
    updateLastLogin,
    updateUserProfile,
    updateUsername,
    updatePassword,
    deleteUser
} = require('./db');

// Initialize database on startup
initDatabase();

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_IN_PRODUCTION';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Security warning for default JWT secret
if (JWT_SECRET === 'CHANGE_THIS_IN_PRODUCTION' && process.env.NODE_ENV === 'production') {
    console.error('⚠️  CRITICAL: Using default JWT secret in production! Set JWT_SECRET in .env');
    process.exit(1); // Exit in production with insecure config
} else if (JWT_SECRET === 'CHANGE_THIS_IN_PRODUCTION') {
    console.warn('⚠️  WARNING: Using default JWT secret. Set JWT_SECRET in .env for production');
}

// ============================================
// BROADCAST LIMITS CONFIGURATION (from env)
// ============================================
const BROADCAST_LIMITS = {
    maxConcurrentStreams: parseInt(process.env.MAX_CONCURRENT_STREAMS) || 10,
    streamCooldownMs: parseInt(process.env.STREAM_COOLDOWN_MS) || 10000,
    maxStreamDurationMs: parseInt(process.env.MAX_STREAM_DURATION_MS) || 4 * 60 * 60 * 1000,
};

const app = express();

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Helmet for security headers (configured for WebRTC/streaming compatibility)
app.use(helmet({
    contentSecurityPolicy: false, // Disabled for inline scripts - enable in production with proper CSP
    crossOriginEmbedderPolicy: false, // Required for WebRTC
    crossOriginOpenerPolicy: false, // Required for WebRTC
}));

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limit for stream key requests (relaxed since frontend prevents spam)
const streamKeyLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: { error: 'Too many stream key requests. Please wait a moment.' },
});

// Apply rate limiting to API routes
app.use('/api/', apiLimiter);
app.use('/api/get-stream-key', streamKeyLimiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per 15 minutes
    message: { error: 'Too many authentication attempts. Please try again later.' },
});
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);

// Middleware
app.use(express.static('public'));
app.use(express.json({ limit: '10kb' })); // Limit body size

// ============================================
// JWT AUTHENTICATION MIDDLEWARE
// ============================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// Optional authentication - doesn't fail if no token
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (!err) {
                req.user = user;
            }
        });
    }
    next();
}

// ============================================
// INPUT VALIDATION HELPERS
// ============================================
function isValidSocketId(socketId) {
    return typeof socketId === 'string' && socketId.length > 0 && socketId.length < 50;
}

function sanitizeString(str, maxLength = 100) {
    if (typeof str !== 'string') return '';
    return str.slice(0, maxLength).replace(/[<>]/g, '');
}

// ============================================
// AUTHENTICATION API ENDPOINTS
// ============================================

// Check username availability
app.get('/api/check-username/:username', (req, res) => {
    const { username } = req.params;
    
    // Username validation
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
        return res.json({ available: false, error: 'Invalid username format' });
    }
    
    // Check if username exists (case-insensitive)
    const existingUser = findUserByUsername(username);
    res.json({ available: !existingUser });
});

// User Registration
app.post('/api/register', (req, res) => {
    const { username, password, gender, about, firstName, lastName } = req.body;
    
    // Input validation
    if (!username || !password || !gender) {
        return res.status(400).json({ error: 'Username, password, and gender are required' });
    }
    
    // Username validation
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
        return res.status(400).json({ 
            error: 'Username must be 3-20 characters, alphanumeric and underscores only' 
        });
    }
    
    // Password validation
    if (password.length < 6 || password.length > 100) {
        return res.status(400).json({ error: 'Password must be 6-100 characters' });
    }
    
    // Gender validation
    const validGenders = ['male', 'female', 'other'];
    if (!validGenders.includes(gender)) {
        return res.status(400).json({ error: 'Invalid gender selection' });
    }
    
    // Sanitize fields
    const sanitizedAbout = sanitizeString(about || '', 500);
    const sanitizedFirstName = sanitizeString(firstName || '', 50);
    const sanitizedLastName = sanitizeString(lastName || '', 50);
    
    // Check if username already exists (case-insensitive)
    const existingUser = findUserByUsername(username);
    if (existingUser) {
        return res.status(400).json({ error: 'Username already taken. Please choose a different one.' });
    }
    
    // Create user
    const result = createUser(username, password, gender, sanitizedAbout, sanitizedFirstName, sanitizedLastName);
    
    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }
    
    // Generate JWT token
    const token = jwt.sign(
        { userId: result.userId, username },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
    
    console.log(`New user registered: ${username}`);
    res.status(201).json({ 
        success: true, 
        token,
        user: { username, gender, about: sanitizedAbout, firstName: sanitizedFirstName, lastName: sanitizedLastName }
    });
});

// User Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    // Input validation
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Find user
    const user = findUserByUsername(username);
    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Verify password
    if (!verifyPassword(password, user.password)) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Update last login
    updateLastLogin(user.id);
    
    // Generate JWT token
    const token = jwt.sign(
        { userId: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
    
    console.log(`User logged in: ${username}`);
    res.json({ 
        success: true, 
        token,
        user: { 
            username: user.username, 
            firstName: user.first_name || '',
            lastName: user.last_name || '',
            gender: user.gender, 
            about: user.about 
        }
    });
});

// Get current user profile (protected)
app.get('/api/profile', authenticateToken, (req, res) => {
    const user = findUserById(req.user.userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
        username: user.username,
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        gender: user.gender,
        about: user.about,
        createdAt: user.created_at,
        lastLogin: user.last_login
    });
});

// Update user profile (protected)
app.put('/api/profile', authenticateToken, (req, res) => {
    const { about, gender, firstName, lastName } = req.body;
    const updates = {};
    
    if (about !== undefined) {
        updates.about = sanitizeString(about, 500);
    }
    
    if (gender !== undefined) {
        const validGenders = ['male', 'female', 'other'];
        if (!validGenders.includes(gender)) {
            return res.status(400).json({ error: 'Invalid gender selection' });
        }
        updates.gender = gender;
    }
    
    if (firstName !== undefined) {
        updates.first_name = sanitizeString(firstName, 50);
    }
    
    if (lastName !== undefined) {
        updates.last_name = sanitizeString(lastName, 50);
    }
    
    const result = updateUserProfile(req.user.userId, updates);
    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true, message: 'Profile updated' });
});

// Verify token validity (for frontend session check)
app.get('/api/verify-token', authenticateToken, (req, res) => {
    const user = findUserById(req.user.userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ 
        valid: true, 
        user: { 
            username: user.username,
            firstName: user.first_name || '',
            lastName: user.last_name || '',
            gender: user.gender, 
            about: user.about 
        } 
    });
});

// Change username (protected)
app.post('/api/auth/change-username', authenticateToken, (req, res) => {
    const { newUsername } = req.body;
    
    // Input validation
    if (!newUsername || typeof newUsername !== 'string') {
        return res.status(400).json({ error: 'New username is required' });
    }
    
    const sanitizedUsername = sanitizeString(newUsername, 20);
    
    // Validate username format
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(sanitizedUsername)) {
        return res.status(400).json({ error: 'Username must be 3-20 characters, letters, numbers, underscores only' });
    }
    
    // Check if username already taken (case-insensitive)
    const existingUser = findUserByUsername(sanitizedUsername);
    if (existingUser && existingUser.id !== req.user.userId) {
        return res.status(400).json({ error: 'Username already taken' });
    }
    
    // Update username
    const result = updateUsername(req.user.userId, sanitizedUsername);
    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }
    
    console.log(`User ${req.user.userId} changed username to: ${sanitizedUsername}`);
    res.json({ success: true, username: sanitizedUsername });
});

// Change password (protected)
app.post('/api/auth/change-password', authenticateToken, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    // Input validation
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password are required' });
    }
    
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    
    // Get user with password for verification
    const user = findUserByIdWithPassword(req.user.userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify current password
    if (!verifyPassword(currentPassword, user.password)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Update password
    const result = updatePassword(req.user.userId, newPassword);
    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }
    
    console.log(`User ${req.user.userId} changed password`);
    res.json({ success: true, message: 'Password updated successfully' });
});

// Delete account (protected)
app.delete('/api/auth/delete-account', authenticateToken, (req, res) => {
    const { password } = req.body;
    
    // Input validation
    if (!password) {
        return res.status(400).json({ error: 'Password is required to confirm account deletion' });
    }
    
    // Get user with password for verification
    const user = findUserByIdWithPassword(req.user.userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify password
    if (!verifyPassword(password, user.password)) {
        return res.status(401).json({ error: 'Incorrect password' });
    }
    
    // Delete user
    const result = deleteUser(req.user.userId);
    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }
    
    console.log(`User ${req.user.userId} (${user.username}) deleted their account`);
    res.json({ success: true, message: 'Account deleted successfully' });
});

// Stream notification endpoints (called by Nginx RTMP)
app.post('/stream/start', (req, res) => {
  const streamKey = req.body.name;
  
  // Validate the stream key
  if (!isValidStreamKey(streamKey)) {
    console.log('RTMP: Rejected invalid stream key attempt');
    return res.status(403).send('Invalid stream key');
  }
  
  const streamInfo = streamKeys.get(streamKey);
  
  // Check if user already has an active stream
  if (streamInfo && userHasActiveStream(streamInfo.streamerName)) {
    console.log(`RTMP: Rejected - ${streamInfo.streamerName} already has an active stream`);
    return res.status(403).send('You already have an active stream');
  }
  
  // Track the stream by username for RTMP streams
  if (streamInfo && streamInfo.streamerName) {
    activeStreamsByUser.set(streamInfo.streamerName.toLowerCase(), streamInfo.streamerId);
  }
  
  console.log(`RTMP: Stream started by ${streamInfo?.streamerName || 'unknown'}`);
  io.emit('stream-started', { streamerName: streamInfo?.streamerName });
  res.status(200).send('OK');
});

app.post('/stream/stop', (req, res) => {
  const streamKey = req.body.name;
  
  const streamInfo = streamKeys.get(streamKey);
  if (streamInfo) {
    console.log(`RTMP: Stream stopped by ${streamInfo.streamerName}`);
    // Set cooldown for the user
    userStreamCooldowns.set(streamInfo.streamerId, Date.now());
    
    // Remove from username tracking
    if (streamInfo.streamerName) {
      activeStreamsByUser.delete(streamInfo.streamerName.toLowerCase());
    }
    
    // Invalidate the stream key
    validStreamKeys.delete(streamKey);
    streamKeys.delete(streamKey);
  }
  
  io.emit('stream-stopped', { streamerName: streamInfo?.streamerName });
  res.status(200).send('OK');
});

// API endpoint to get a new stream key
app.post('/api/get-stream-key', (req, res) => {
  const { socketId } = req.body;
  
  // Input validation with detailed error
  if (!socketId) {
    console.log('Stream key request: Missing socketId');
    return res.status(400).json({ error: 'Socket connection required. Please refresh the page.' });
  }
  
  if (!isValidSocketId(socketId)) {
    console.log('Stream key request: Invalid socketId format:', socketId);
    return res.status(400).json({ error: 'Invalid socket connection. Please refresh the page.' });
  }
  
  if (!users.has(socketId)) {
    console.log('Stream key request: User not found for socketId:', socketId);
    return res.status(401).json({ error: 'Please log in before starting a stream.' });
  }
  
  const canStream = canUserStream(socketId);
  if (!canStream.allowed) {
    return res.status(429).json({ error: canStream.reason });
  }
  
  const user = users.get(socketId);
  const streamKey = generateStreamKey();
  
  // Store the stream key
  streamKeys.set(streamKey, {
    streamerId: socketId,
    streamerName: sanitizeString(user.username),
    createdAt: Date.now()
  });
  validStreamKeys.add(streamKey);
  
  // Auto-expire stream key after 5 minutes if not used
  setTimeout(() => {
    if (validStreamKeys.has(streamKey) && !activeStreams.has(socketId)) {
      validStreamKeys.delete(streamKey);
      streamKeys.delete(streamKey);
      console.log('Stream key expired (unused)');
    }
  }, 5 * 60 * 1000);
  
  console.log(`Stream key generated for ${sanitizeString(user.username)}`);
  res.json({ streamKey });
});

// API endpoint to check broadcast limits status
app.get('/api/broadcast-status', (req, res) => {
  res.json({
    activeStreams: activeStreams.size,
    maxStreams: BROADCAST_LIMITS.maxConcurrentStreams,
    available: activeStreams.size < BROADCAST_LIMITS.maxConcurrentStreams
  });
});

// Store connected users
const users = new Map();
const rooms = new Map();
const chatRequests = new Set();
const activeStreams = new Map(); // Track active streams by socketId
const activeStreamsByUser = new Map(); // Track active streams by username (for per-user limit)
const streamViewers = new Map(); // Track viewers for each stream: streamerId -> Set of viewerIds

// ============================================
// STREAM KEY MANAGEMENT
// ============================================
const streamKeys = new Map();           // streamKey -> { oderId, odername, createdAt }
const userStreamCooldowns = new Map();   // oderId -> lastStreamEndTime
const validStreamKeys = new Set();       // Set of currently valid stream keys

// Generate secure random stream key
function generateStreamKey() {
    return crypto.randomBytes(16).toString('hex');
}

// Validate stream key for RTMP publish
function isValidStreamKey(streamKey) {
    return validStreamKeys.has(streamKey);
}

// Check if user already has an active stream (by username)
function userHasActiveStream(username) {
    if (!username) return false;
    const normalizedUsername = username.toLowerCase();
    return activeStreamsByUser.has(normalizedUsername);
}

// Check if user can start a new stream
function canUserStream(socketId) {
    const user = users.get(socketId);
    if (!user) {
        return { allowed: false, reason: 'User not found' };
    }
    
    // Check if user already has an active stream
    // Check if user already has an active stream (by socket ID)
    if (activeStreams.has(socketId)) {
        return { allowed: false, reason: 'You already have an active stream' };
    }
    
    // Check per-user limit (1 stream per user, regardless of browser or OBS)
    if (userHasActiveStream(user.username)) {
        return { allowed: false, reason: 'You can only have one active stream at a time. Stop your current stream first.' };
    }
    
    // Check platform-wide stream limit
    if (activeStreams.size >= BROADCAST_LIMITS.maxConcurrentStreams) {
        return { allowed: false, reason: 'Platform stream limit reached. Please try again later.' };
    }
    
    // Check cooldown
    const lastStreamEnd = userStreamCooldowns.get(socketId);
    if (lastStreamEnd) {
        const timeSinceLastStream = Date.now() - lastStreamEnd;
        if (timeSinceLastStream < BROADCAST_LIMITS.streamCooldownMs) {
            const remainingSeconds = Math.ceil((BROADCAST_LIMITS.streamCooldownMs - timeSinceLastStream) / 1000);
            return { allowed: false, reason: `Please wait ${remainingSeconds} seconds before starting a new stream` };
        }
    }
    
    return { allowed: true };
}

// Try to create HTTPS server, fallback to HTTP
let server;
let io;

try {
  // Create self-signed certificate if it doesn't exist
  const keyPath = path.join(__dirname, 'key.pem');
  const certPath = path.join(__dirname, 'cert.pem');
  
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.log('HTTPS certificates not found. Run: npm run generate-cert');
    console.log('Falling back to HTTP server...');
    throw new Error('No certificates');
  }
  
  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  
  server = https.createServer(options, app);
  console.log('HTTPS server created');
} catch (error) {
  server = http.createServer(app);
  console.log('HTTP server created (video calls may not work on remote devices)');
}

io = socketIo(server);

// Socket.IO connection handling (same as before)
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (username) => {
    users.set(socket.id, { username, socketId: socket.id });
    socket.username = username;
    io.emit('users-update', Array.from(users.values()));
    
    // Send existing live streams to new user
    if (activeStreams.size > 0) {
      Array.from(activeStreams.values()).forEach(stream => {
        socket.emit('new-stream', stream);
      });
    }
    
    console.log(`${username} joined`);
  });

  socket.on('private-chat-request', (data) => {
    const requesterUser = users.get(socket.id);
    const requestKey = `${socket.id}-${data.targetUserId}`;
    
    if (requesterUser && !chatRequests.has(requestKey)) {
      chatRequests.add(requestKey);
      
      socket.to(data.targetUserId).emit('private-chat-notification', {
        fromUser: requesterUser.username,
        fromSocketId: socket.id
      });
      
      console.log(`Sent chat request notification from ${requesterUser.username} to ${data.targetUserId}`);
      
      setTimeout(() => {
        chatRequests.delete(requestKey);
      }, 30000);
    }
  });

  socket.on('join-private-chat', (data) => {
    const roomId = [data.userId, data.targetUserId].sort().join('-');
    socket.join(roomId);
    socket.to(data.targetUserId).emit('force-join-room', { roomId });
    console.log(`${socket.username} joined private chat: ${roomId}`);
  });

  socket.on('join-group', (groupId) => {
    socket.join(groupId);
    if (!rooms.has(groupId)) {
      rooms.set(groupId, { name: groupId, members: [] });
    }
    rooms.get(groupId).members.push(socket.username);
    console.log(`${socket.username} joined group: ${groupId}`);
  });

  socket.on('private-message', (data) => {
    console.log(`Sending message from ${data.senderName} to ${data.receiverId}`, data);
    socket.to(data.receiverId).emit('receive-message', {
      ...data,
      timestamp: new Date().toLocaleTimeString()
    });
  });

  socket.on('group-message', (data) => {
    io.to(data.groupId).emit('receive-group-message', {
      ...data,
      timestamp: new Date().toLocaleTimeString()
    });
  });

  socket.on('video-call-offer', (data) => {
    socket.to(data.targetSocketId).emit('video-call-offer', {
      ...data,
      callerSocketId: socket.id,
      callerName: socket.username
    });
  });

  socket.on('video-call-answer', (data) => {
    socket.to(data.callerSocketId).emit('video-call-answer', data);
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.targetSocketId).emit('ice-candidate', data);
  });

  socket.on('start-stream', (streamData) => {
    // Check if user can stream
    const canStream = canUserStream(socket.id);
    if (!canStream.allowed) {
      socket.emit('stream-error', { error: canStream.reason });
      return;
    }
    
    const streamInfo = {
      ...streamData,
      streamerName: socket.username,
      streamerId: socket.id,
      startedAt: Date.now()
    };
    
    // Store active stream (by socket ID and username)
    activeStreams.set(socket.id, streamInfo);
    activeStreamsByUser.set(socket.username.toLowerCase(), socket.id);
    
    // Set max duration timeout
    setTimeout(() => {
      if (activeStreams.has(socket.id)) {
        console.log(`Stream duration limit reached for ${socket.username}`);
        socket.emit('stream-duration-limit', { 
          message: 'Maximum stream duration reached (4 hours)' 
        });
        // Don't force stop, just notify
      }
    }, BROADCAST_LIMITS.maxStreamDurationMs);
    
    console.log(`Stream started: ${socket.username} (Active streams: ${activeStreams.size}/${BROADCAST_LIMITS.maxConcurrentStreams})`);
    
    // Broadcast to all users
    socket.broadcast.emit('new-stream', streamInfo);
  });

  // Handle request for current viewer count
  socket.on('request-viewer-count', (data) => {
    const viewerCount = streamViewers.has(data.streamerId) ? streamViewers.get(data.streamerId).size : 0;
    socket.emit('viewer-count-update', { streamerId: data.streamerId, count: viewerCount });
  });

  // Handle stream viewer request
  socket.on('request-stream', (data) => {
    console.log('Stream request from viewer:', data.viewerId, 'to streamer:', data.streamerId);
    
    // Add viewer to stream
    if (!streamViewers.has(data.streamerId)) {
      streamViewers.set(data.streamerId, new Set());
    }
    streamViewers.get(data.streamerId).add(data.viewerId);
    
    // Send updated viewer count to everyone immediately
    const viewerCount = streamViewers.get(data.streamerId).size;
    io.emit('viewer-count-update', { streamerId: data.streamerId, count: viewerCount });
    
    // Also send directly to the new viewer
    socket.emit('viewer-count-update', { streamerId: data.streamerId, count: viewerCount });
    
    socket.to(data.streamerId).emit('stream-viewer-request', {
      viewerId: data.viewerId
    });
  });

  // Handle stream offer
  socket.on('stream-offer', (data) => {
    console.log('Stream offer from streamer to viewer:', data.viewerId);
    socket.to(data.viewerId).emit('stream-offer', {
      ...data,
      streamerId: socket.id
    });
  });

  // Handle stream answer
  socket.on('stream-answer', (data) => {
    console.log('Stream answer from viewer to streamer:', data.streamerId);
    
    // Ensure viewer is tracked when connection is established
    if (!streamViewers.has(data.streamerId)) {
      streamViewers.set(data.streamerId, new Set());
    }
    streamViewers.get(data.streamerId).add(socket.id);
    
    // Send updated viewer count to streamer and all viewers
    const viewerCount = streamViewers.get(data.streamerId).size;
    io.emit('viewer-count-update', { streamerId: data.streamerId, count: viewerCount });
    
    socket.to(data.streamerId).emit('stream-answer', {
      ...data,
      viewerId: socket.id
    });
  });

  // Handle stream ICE candidates
  socket.on('stream-ice-candidate', (data) => {
    console.log('Server received ICE candidate:', data);
    if (data.viewerId) {
      console.log('Routing ICE candidate to viewer:', data.viewerId);
      socket.to(data.viewerId).emit('stream-ice-candidate', {
        streamerId: socket.id,
        candidate: data.candidate
      });
    } else if (data.streamerId) {
      console.log('Routing ICE candidate to streamer:', data.streamerId);
      socket.to(data.streamerId).emit('stream-ice-candidate', {
        viewerId: socket.id,
        candidate: data.candidate
      });
    }
  });

  // Handle leave stream
  socket.on('leave-stream', (data) => {
    console.log('User leaving stream:', socket.id, 'from streamer:', data.streamerId);
    
    if (streamViewers.has(data.streamerId)) {
      streamViewers.get(data.streamerId).delete(socket.id);
      const viewerCount = streamViewers.get(data.streamerId).size;
      io.emit('viewer-count-update', { streamerId: data.streamerId, count: viewerCount });
    }
  });

  // Handle stop stream
  socket.on('stop-stream', (data) => {
    // Set cooldown for the user
    userStreamCooldowns.set(socket.id, Date.now());
    
    // Invalidate the stream key if provided
    if (data.streamKey && validStreamKeys.has(data.streamKey)) {
      validStreamKeys.delete(data.streamKey);
      streamKeys.delete(data.streamKey);
    }
    
    // Remove from active streams (by socket ID and username)
    activeStreams.delete(socket.id);
    if (socket.username) {
      activeStreamsByUser.delete(socket.username.toLowerCase());
    }
    
    console.log(`Stream stopped: ${socket.username} (Active streams: ${activeStreams.size}/${BROADCAST_LIMITS.maxConcurrentStreams})`);
    
    socket.broadcast.emit('stream-ended', {
      streamKey: data.streamKey,
      streamerName: socket.username,
      streamerId: socket.id
    });
  });
  
  // Handle stream chat messages
  socket.on('stream-chat-message', (data) => {
    console.log('Stream chat message:', data);
    const messageData = {
      ...data,
      timestamp: new Date().toLocaleTimeString()
    };
    
    // Send to streamer with different event name
    socket.to(data.streamerId).emit('streamer-receives-chat', messageData);
    
    // Send to all viewers with different event name
    socket.broadcast.emit('viewer-receives-chat', messageData);
  });
  
  // Handle streamer chat messages
  socket.on('streamer-chat-message', (data) => {
    console.log('Streamer chat message:', data);
    // Broadcast to all connected users
    socket.broadcast.emit('streamer-chat-received', {
      ...data,
      timestamp: new Date().toLocaleTimeString()
    });
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      console.log(`${socket.username} disconnected`);
      users.delete(socket.id);
      
      // Remove from stream viewers and update counts
      streamViewers.forEach((viewers, streamerId) => {
        if (viewers.has(socket.id)) {
          viewers.delete(socket.id);
          const viewerCount = viewers.size;
          io.emit('viewer-count-update', { streamerId: streamerId, count: viewerCount });
        }
      });
      
      // Remove from active streams if streaming
      if (activeStreams.has(socket.id)) {
        // Set cooldown
        userStreamCooldowns.set(socket.id, Date.now());
        
        // Clean up any stream keys for this user
        streamKeys.forEach((info, key) => {
          if (info.streamerId === socket.id) {
            validStreamKeys.delete(key);
            streamKeys.delete(key);
          }
        });
        
        activeStreams.delete(socket.id);
        if (socket.username) {
          activeStreamsByUser.delete(socket.username.toLowerCase());
        }
        streamViewers.delete(socket.id); // Remove viewer tracking for this stream
        
        console.log(`Stream ended (disconnect): ${socket.username} (Active streams: ${activeStreams.size}/${BROADCAST_LIMITS.maxConcurrentStreams})`);
        
        socket.broadcast.emit('stream-ended', {
          streamKey: 'disconnected',
          streamerName: socket.username,
          streamerId: socket.id
        });
      }
      
      io.emit('users-update', Array.from(users.values()));
    }
  });
});

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

if (server.constructor.name === 'Server') {
  // HTTP server
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP Server running on http://0.0.0.0:${PORT}`);
  });
} else {
  // HTTPS server
  server.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`HTTPS Server running on https://0.0.0.0:${HTTPS_PORT}`);
  });
  
  // Also start HTTP server for redirect
  const httpApp = express();
  httpApp.get('*', (req, res) => {
    res.redirect(`https://${req.headers.host.split(':')[0]}:${HTTPS_PORT}${req.url}`);
  });
  httpApp.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP Redirect server running on http://0.0.0.0:${PORT}`);
  });
}