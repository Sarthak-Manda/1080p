const socket = io('http://localhost:4000');

let currentRoom = null;

socket.on('recieve-message', ({from,message}) => {
    addMessageToUI(`${from.slice(0.6)}: ${message}`);
});

socket.on('user-joined', (userId) => {
    addMessageToUI(`${userId.slice(0,6)} joined the room`);
});

function joinRoom(){
    const roomId = document.getElementById('roomInput').value;
    if(!roomId) return;
    currentRoom = roomId;
    socket.emit('join-room', roomId);
    addMessageToUI(`you joined room: ${roomId}`);
}

function addMessageToUI(text){
    const div = document.createElement('div');
    div.textContent = text;
    document.getElementById('messages').appendChild(div);
}

function sendMessage() {
  const message = document.getElementById('messageInput').value;
  if (!message || !currentRoom) return;
  socket.emit('send-message', { roomId: currentRoom, message });
  addMessageToUI(`you: ${message}`);
  document.getElementById('messageInput').value = '';
}