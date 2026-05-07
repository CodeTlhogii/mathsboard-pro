const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));

const users = new Map();
const rooms = new Map();

users.set('demo', { password: 'demo123', name: 'Tutor', avatar: 'https://ui-avatars.com/api/?background=667eea&color=fff&name=Tutor' });
users.set('student', { password: 'student123', name: 'Student', avatar: 'https://ui-avatars.com/api/?background=764ba2&color=fff&name=Student' });

app.post('/api/login', (req, res) => {
    const user = users.get(req.body.username);
    if (user && user.password === req.body.password) {
        res.json({ success: true, user: { username: req.body.username, name: user.name, avatar: user.avatar } });
    } else {
        res.json({ success: false, error: 'Invalid credentials' });
    }
});

app.post('/api/register', (req, res) => {
    if (users.has(req.body.username)) {
        res.json({ success: false, error: 'Username exists' });
    } else {
        users.set(req.body.username, { 
            password: req.body.password, 
            name: req.body.name || req.body.username, 
            avatar: `https://ui-avatars.com/api/?background=667eea&color=fff&name=${encodeURIComponent(req.body.name || req.body.username)}` 
        });
        res.json({ success: true });
    }
});

io.on('connection', (socket) => {
    socket.on('login', (user) => {
        socket.user = user;
        console.log(`${user.name} connected`);
    });

    socket.on('create-room', () => {
        const roomId = uuidv4().substring(0, 8);
        rooms.set(roomId, { drawings: [], messages: [] });
        socket.join(roomId);
        socket.roomId = roomId;
        socket.emit('room-created', { roomId });
        console.log(`Room ${roomId} created`);
    });

    socket.on('join-room', (roomId) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }
        socket.join(roomId);
        socket.roomId = roomId;
        socket.emit('room-joined', {
            roomId,
            drawings: room.drawings,
            messages: room.messages
        });
        socket.to(roomId).emit('user-joined', { name: socket.user.name });
        console.log(`${socket.user.name} joined ${roomId}`);
    });

    socket.on('draw', (data) => {
        const room = rooms.get(socket.roomId);
        if (room) room.drawings.push(data);
        socket.to(socket.roomId).emit('draw', data);
    });

    socket.on('clear-drawings', () => {
        const room = rooms.get(socket.roomId);
        if (room) room.drawings = [];
        io.to(socket.roomId).emit('clear-drawings');
    });

    socket.on('chat-message', (msg) => {
        const messageData = {
            userId: socket.id,
            userName: socket.user.name,
            userAvatar: socket.user.avatar,
            message: msg,
            timestamp: new Date().toISOString()
        };
        const room = rooms.get(socket.roomId);
        if (room) room.messages.push(messageData);
        io.to(socket.roomId).emit('chat-message', messageData);
    });

    socket.on('pdf-loaded', ({ pdfData }) => {
        socket.to(socket.roomId).emit('pdf-loaded', { pdfData });
    });

    socket.on('pdf-cleared', () => {
        socket.to(socket.roomId).emit('pdf-cleared');
    });

    socket.on('pdf-page-change', ({ pageNum }) => {
        socket.to(socket.roomId).emit('pdf-page-change', { pageNum });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-left');
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:3000`);
    console.log('\nDemo accounts:');
    console.log('  Tutor: demo / demo123');
    console.log('  Student: student / student123');
});