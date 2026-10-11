const express = require('express');
const http = require('http');
const {Server} = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors({origin: '*'}));

const server = http.createServer(app);

const io = new Server(server, {
    cors: {origin: '*', methods: ['GET', 'POST'] }
});

const rooms = {};

io.on('connection', (socket) => {
    console.log('connected:', socket.id);

    socket.on('join-room', ({ roomKey, username }) => {
        console.log('join-room received:', roomKey, username);
    if (!rooms[roomKey]) {
        socket.emit('error', 'room not found');
        return;
    }
    socket.join(roomKey);
    console.log(`viewer ${socket.id} (${username}) joined room ${roomKey}`);
    io.to(rooms[roomKey]).emit('viewer-joined', { 
        viewerId: socket.id, 
        username 
     });
  });

    socket.on('create-room', (roomId) => {
    rooms[roomId] = socket.id;
    socket.join(roomId);
    console.log(`room created: ${roomId} by ${socket.id}`);
    socket.emit('room-created', roomId);
    });

    socket.on('offer', ({to, offer}) => {
        io.to(to).emit('offer', {from: socket.id, offer});
    });

    socket.on('answer', ({to, answer}) => {
        io.to(to).emit('answer', {from: socket.id, answer});
    })

    socket.on('ice-candidate', ({to,candidate}) => {
        io.to(to).emit('ice-candidate', { from: socket.id, candidate});
    })

    socket.on('sync-play', ({roomId, currentTime}) => {
        socket.to(roomId).emit('sync-play', {currentTime});
    })

    socket.on('sync-pause', ({ roomId, currentTime }) => {
    socket.to(roomId).emit('sync-pause', { currentTime });
    });

  socket.on('sync-seek', ({ roomId, currentTime }) => {
    socket.to(roomId).emit('sync-seek', { currentTime });
    });

    socket.on('sync-heartbeat', ({ roomId, currentTime, playing }) => {
    socket.to(roomId).emit('sync-heartbeat', { currentTime, playing });
    });

    socket.on('disconnect', () => {
        for(const [roomId, hostId] of Object.entries(rooms)) {
            if(hostId == socket.id){
                io.to(roomId).emit('host-left');
                delete rooms[roomId];
                console.log(`host left, room ${roomId} closed`);
            }
        }
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`video room server running on port ${PORT}`)
});