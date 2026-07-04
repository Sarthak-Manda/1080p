const express = require('express');
const http = require('http');
const {Server} = require('socket.io');
const cors = require('cors');;

const app = express();
app.use(cors({
    origin: '*'
}));


const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log('user connected:', socket.id);

    socket.on('join-room', (roomId) => {

        socket.join(roomId);
        console.log(`${socket.id} joined room ${roomId}`);

        socket.to(roomId).emit('user-joined', socket.id);
    });

    socket.on('send-message', ({ roomId, message}) => {
        socket.to(roomId).emit('recieve-message', {
            from: socket.id,
            message: message
        });
    });

    socket.on('disconnect', () => {
        console.log('user disconnected:', socket.id);
    });
})

server.listen(4000, () => {
    console.log('server ruunning on port 4000')
})