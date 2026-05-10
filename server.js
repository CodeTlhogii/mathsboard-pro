const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Store users (in-memory)
const users = new Map();

// ============ AUTH ROUTES ============

// Register
app.post('/api/register', (req, res) => {
  const { email, username, password, name } = req.body;
  
  console.log('Register attempt:', { email, username });
  
  if (!email || !username || !password) {
    return res.json({ success: false, error: 'All fields required' });
  }
  
  if (users.has(email)) {
    return res.json({ success: false, error: 'Email already registered' });
  }
  
  const id = uuidv4();
  users.set(email, {
    id,
    email,
    username,
    password: password,
    name: name || username,
    avatar: `https://ui-avatars.com/api/?background=667eea&color=fff&name=${encodeURIComponent(name || username)}`,
    createdAt: new Date().toISOString()
  });
  
  console.log('User registered:', email);
  res.json({ success: true, message: 'Registration successful!' });
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  console.log('Login attempt:', email);
  
  const user = users.get(email);
  if (!user) {
    return res.json({ success: false, error: 'Email not found' });
  }
  
  if (user.password !== password) {
    return res.json({ success: false, error: 'Invalid password' });
  }
  
  console.log('Login successful:', email);
  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      avatar: user.avatar
    }
  });
});

// Get all users (for debugging)
app.get('/api/users', (req, res) => {
  const userList = Array.from(users.values()).map(u => ({ email: u.email, username: u.username, name: u.name }));
  res.json({ users: userList });
});

// ============ SOCKET.IO ============
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('🟢 User connected:', socket.id);

  socket.on('login', (user) => {
    socket.user = user;
    console.log(`✅ ${user.name} logged in`);
  });

  socket.on('create-room', () => {
    const roomId = uuidv4().substring(0, 8);
    rooms.set(roomId, {
      startTime: Date.now(),
      participants: new Set(),
      drawings: [],
      messages: [],
      currentPdf: null
    });
    socket.join(roomId);
    socket.roomId = roomId;
    rooms.get(roomId).participants.add(socket.id);
    socket.emit('room-created', { roomId });
    console.log(`📁 Room ${roomId} created by ${socket.user?.name}`);
  });

  socket.on('join-room', (roomId) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    socket.join(roomId);
    socket.roomId = roomId;
    room.participants.add(socket.id);
    
    socket.emit('room-joined', {
      roomId,
      drawings: room.drawings,
      messages: room.messages || [],
      currentPdf: room.currentPdf,
      participantsCount: room.participants.size
    });
    socket.to(roomId).emit('user-joined', { name: socket.user.name });
    console.log(`🚪 ${socket.user?.name} joined ${roomId}`);
  });

  socket.on('draw', (data) => {
    const room = rooms.get(socket.roomId);
    if (room) {
      room.drawings.push(data);
      socket.to(socket.roomId).emit('draw', data);
    }
  });

  socket.on('clear-drawings', () => {
    const room = rooms.get(socket.roomId);
    if (room) {
      room.drawings = [];
      io.to(socket.roomId).emit('clear-drawings');
    }
  });

  socket.on('chat-message', (msg) => {
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    const user = socket.user;
    
    if (room && user && roomId) {
      const messageData = {
        userId: socket.id,
        userName: user.name,
        userAvatar: user.avatar,
        message: msg,
        timestamp: new Date().toISOString()
      };
      if (!room.messages) room.messages = [];
      room.messages.push(messageData);
      io.to(roomId).emit('chat-message', messageData);
      console.log(`💬 ${user.name}: ${msg}`);
    }
  });

  socket.on('pdf-loaded', ({ pdfData }) => {
    const room = rooms.get(socket.roomId);
    if (room) {
      room.currentPdf = pdfData;
      socket.to(socket.roomId).emit('pdf-loaded', { pdfData });
    }
  });

  socket.on('pdf-cleared', () => {
    const room = rooms.get(socket.roomId);
    if (room) {
      room.currentPdf = null;
      io.to(socket.roomId).emit('pdf-cleared');
    }
  });

  socket.on('pdf-page-change', ({ pageNum }) => {
    socket.to(socket.roomId).emit('pdf-page-change', { pageNum });
  });

  socket.on('disconnect', () => {
    console.log(`🔴 User disconnected: ${socket.id}`);
    if (socket.roomId) {
      socket.to(socket.roomId).emit('user-left');
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`========================================`);
  console.log(`\n📝 Sign up with any email to create an account`);
});