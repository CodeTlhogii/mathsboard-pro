const express = require('express');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ============ SERVE FROM 'public' FOLDER ============
const publicPath = path.join(__dirname, 'public');
console.log('📁 Serving static files from:', publicPath);

// Check if index.html exists (only declare once)
const indexPath = path.join(publicPath, 'index.html');
if (fs.existsSync(indexPath)) {
  console.log('✅ index.html found at:', indexPath);
} else {
  console.log('❌ index.html NOT found at:', indexPath);
}

app.use(express.static(publicPath));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/', (req, res) => {
  res.sendFile(indexPath);
});

// ============ AUTH ROUTES ============

// Store users (in-memory)
const users = new Map();

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

app.get('/api/users', (req, res) => {
  const userList = Array.from(users.values()).map(u => ({ email: u.email, username: u.username, name: u.name }));
  res.json({ users: userList });
});

// ============ SOCKET.IO ============
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('🟢 User connected:', socket.id);

  socket.on('heartbeat', () => {
    socket.emit('heartbeat');
  });

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
      shapes: [],
      messages: [],
      currentPdf: null,
      createdBy: socket.user?.name || 'Unknown',
      createdAt: new Date().toISOString()
    });
    socket.join(roomId);
    socket.roomId = roomId;
    rooms.get(roomId).participants.add(socket.id);
    socket.emit('room-created', { roomId });
    console.log(`📁 Room ${roomId} created by ${socket.user?.name}`);
  });

  socket.on('join-room', (roomId) => {
    const cleanRoomId = roomId.trim().toLowerCase();
    const room = rooms.get(cleanRoomId);
    
    console.log(`🔍 Join attempt: "${roomId}" -> cleaned: "${cleanRoomId}"`);
    
    if (!room) {
      socket.emit('error', `Room "${roomId}" not found`);
      return;
    }
    
    if (socket.roomId) {
      socket.leave(socket.roomId);
      const oldRoom = rooms.get(socket.roomId);
      if (oldRoom) {
        oldRoom.participants.delete(socket.id);
      }
    }
    
    socket.join(cleanRoomId);
    socket.roomId = cleanRoomId;
    room.participants.add(socket.id);
    
    socket.emit('room-joined', {
      roomId: cleanRoomId,
      drawings: room.drawings,
      shapes: room.shapes || [],
      messages: room.messages || [],
      currentPdf: room.currentPdf,
      participantsCount: room.participants.size
    });
    
    socket.to(cleanRoomId).emit('user-joined', { 
      name: socket.user?.name,
      count: room.participants.size 
    });
  });

  socket.on('draw', (data) => {
    const room = rooms.get(socket.roomId);
    if (room) {
      room.drawings.push(data);
      socket.to(socket.roomId).emit('draw', data);
    }
  });

  socket.on('draw-shape', (shapeData) => {
    const room = rooms.get(socket.roomId);
    if (room) {
      room.shapes = room.shapes || [];
      room.shapes.push(shapeData);
      socket.to(socket.roomId).emit('draw-shape', shapeData);
    }
  });

  socket.on('clear-drawings', () => {
    const room = rooms.get(socket.roomId);
    if (room) {
      room.drawings = [];
      room.shapes = [];
      io.to(socket.roomId).emit('clear-drawings');
    }
  });

  socket.on('chat-message', (msg) => {
    const room = rooms.get(socket.roomId);
    const user = socket.user;
    
    if (room && user) {
      const messageData = {
        userId: socket.id,
        userName: user.name,
        userAvatar: user.avatar,
        message: msg,
        timestamp: new Date().toISOString()
      };
      if (!room.messages) room.messages = [];
      room.messages.push(messageData);
      io.to(socket.roomId).emit('chat-message', messageData);
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
      const room = rooms.get(socket.roomId);
      if (room) {
        room.participants.delete(socket.id);
        socket.to(socket.roomId).emit('user-left', { 
          userId: socket.id,
          name: socket.user?.name,
          count: room.participants.size 
        });
        
        if (room.participants.size === 0) {
          rooms.delete(socket.roomId);
          console.log(`🗑️ Room ${socket.roomId} deleted`);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`🚀 MathsBoard Pro running on http://localhost:${PORT}`);
  console.log(`========================================`);
});