const socket = io('http://localhost:4000');

let currentRoom = null;
let isHost = false;
let isSeeking = false;
let username = null;
let localVideo = null;
let localStream = null;
const peerConnections = {};

const iceConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ]
};

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  const target = document.getElementById(screenId);
  target.classList.remove('hidden');
  target.classList.add('active');
}

function showPanel(type) {
  // hide both first
  document.getElementById('create-panel').classList.remove('visible');
  document.getElementById('join-panel').classList.remove('visible');
  document.getElementById('create-panel').classList.add('hidden');
  document.getElementById('join-panel').classList.add('hidden');

  // show the right one with smooth transition
  const target = document.getElementById(`${type}-panel`);
  target.classList.remove('hidden');
  // small delay so browser registers the class change before animating
  requestAnimationFrame(() => {
    target.classList.add('visible');
  });
}


function setEntryStatus(text) {
  document.getElementById('entry-status').textContent = text;
}

function setHostStatus(text) {
  document.getElementById('host-status').textContent = '> ' + text;
}


function buildRoomKey(roomId, password) {
  return `${roomId.trim()}__${password.trim()}`;
}


function createRoom() {
  const roomId = document.getElementById('create-room-id').value.trim();
  const password = document.getElementById('create-password').value.trim();

  if (!roomId || !password) {
    setEntryStatus('enter room name and password');
    return;
  }

  const roomKey = buildRoomKey(roomId, password);
  currentRoom = roomKey;
  isHost = true;

  socket.emit('create-room', roomKey);
}

function joinRoom() {
  const roomId = document.getElementById('join-room-id').value.trim();
  const password = document.getElementById('join-password').value.trim();

  if (!roomId || !password) {
    setEntryStatus('enter room name and password');
    return;
  }

  const roomKey = buildRoomKey(roomId, password);
  currentRoom = roomKey;
  isHost = false;

  const name = document.getElementById('join-username').value.trim();
  username = name;
  socket.emit('join-room', {roomKey,username});
  setTimeout(() => {
  showScreen('viewer-screen');
  initViewerScreen();
}, 500);
}


socket.on('room-created', () => {
  setEntryStatus('room created — loading host screen...');
  setTimeout(() => {
    showScreen('host-screen');
    initHostScreen();
  }, 800);
});

socket.on('error', (message) => {
  setEntryStatus(message);
  showScreen('entry-screen');
});

socket.on('join-room-success', () => {
  setEntryStatus('joined — loading viewer screen...');
});


function initHostScreen() {
  localVideo = document.getElementById('localVideo');

  document.getElementById('host-room-display').textContent =
    currentRoom.split('__')[0];

    const seekBar = document.getElementById('seekBar');
    seekBar.addEventListener('mousedown', () => { isSeeking = true; });
    seekBar.addEventListener('mouseup', () => { isSeeking = false;
      hostSeek();
     });

  localVideo.addEventListener('timeupdate', () => {
    const duration = localVideo.duration || 0;
    const current = localVideo.currentTime || 0;

    if(!isSeeking){
    const pct = duration ? (current / duration) * 100 : 0;
    seekBar.value = pct;
    seekBar.style.setProperty('--seek-fill', `${pct}%`);
    }
    
    document.getElementById('timeDisplay').textContent =
      `${formatTime(current)} / ${formatTime(duration)}`;
  });

  document.getElementById('videoWrapper').addEventListener('click', (e) => {
    if (!localStream) return;
    if (e.target.closest('#hostControls')) return;
    togglePlayPause();
  });

  let hideTimeout;
  const wrapper = document.getElementById('videoWrapper');

  wrapper.addEventListener('mousemove', () => {
    wrapper.classList.remove('idle');
    clearTimeout(hideTimeout);

    hideTimeout = setTimeout(() => {
      if(!localVideo.paused){
        wrapper.classList.add('idle');
      }
    },2500)
  })

  wrapper.addEventListener('mouseleave', () => {
    if(!localVideo.paused) wrapper.classList.add('idle')
  });

  setHostStatus('waiting for file...');
}


function handleFileLoad(event) {
  const file = event.target.files[0];
  if(!file) return;

  document.getElementById('file-name').textContent = file.name;

  const url = URL.createObjectURL(file);
  localVideo.src = url;

  localVideo.onloadedmetadata = async () => {
    localStream = localVideo.captureStream(30);

    for(const [viewerId, pc] of Object.entries(peerConnections)){

      pc.getSenders().forEach(sender => pc.removeTrack(sender));

      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('offer', {to: viewerId, offer: offer})
      setHostStatus(`renegotiating stream with ${viewerId}...`)
    }

    enableControls();
    document.getElementById('video-placeholder').style.display = 'none';
    setHostStatus('file loaded - ready to stream');
  }
}

function hostSeek() {
  const seekBar = document.getElementById('seekBar');
  const seekTo = (seekBar.value / 100) * (localVideo.duration || 0);
  localVideo.currentTime = seekTo;
  socket.emit('sync-seek', {
    roomId: currentRoom,
    currentTime: seekTo
  });
}


setInterval(() => {
  if (!localVideo || !currentRoom || !isHost) return;
  if (localVideo.paused) return;
  socket.emit('sync-heartbeat', {
    roomId: currentRoom,
    currentTime: localVideo.currentTime,
    playing: !localVideo.paused
  });
}, 5000);


socket.on('viewer-joined', async ({viewerId,username}) => {
  if (!isHost) return;
  setHostStatus(`${username} joined — connecting...`);
  addViewerToList(viewerId,username);

  const pc = new RTCPeerConnection(iceConfig);
  peerConnections[viewerId] = pc;

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit('ice-candidate', { to: viewerId, candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    setHostStatus(`viewer ${username}: ${pc.connectionState}`);
  };

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { to: viewerId, offer });
  setHostStatus('offer sent — waiting for answer...');
});


socket.on('answer', async ({ from, answer }) => {
  if (!isHost) return;
  const pc = peerConnections[from];
  if (pc) await pc.setRemoteDescription(answer);
  setHostStatus('connected to viewer');
});


socket.on('ice-candidate', async ({ from, candidate }) => {
  const pc = peerConnections[from];
  if (pc) await pc.addIceCandidate(candidate);
});


function addViewerToList(viewerId,username) {
  const ul = document.getElementById('viewer-list-ul');
  const placeholder = ul.querySelector('.no-viewers');
  if (placeholder) placeholder.remove();
  const li = document.createElement('li');
  li.id = `viewer-${viewerId}`;
  li.textContent = `> ${username}`;
  ul.appendChild(li);
}


function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function initViewerScreen(){
  document.getElementById('viewer-room-display').textContent =
    currentRoom.split('__')[0];
  setViewerStatus('connecting...');  
}


function setViewerStatus(text){
  document.getElementById('viewer-status').textContent = '> ' + text;
}


socket.on('offer', async ({ from, offer }) => {
  if (isHost) return;

  setViewerStatus('offer received - connecting...');

  let pc = peerConnections[from];

  if (!pc) {
    
    pc = new RTCPeerConnection(iceConfig);
    peerConnections[from] = pc;

    pc.ontrack = ({ streams }) => {
      const remoteVideo = document.getElementById('remoteVideo');
      remoteVideo.srcObject = streams[0];
      document.getElementById('viewer-placeholder').style.display = 'none';
      setViewerStatus('connected - receiving stream');
      remoteVideo.play().catch(() => {});
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socket.emit('ice-candidate', { to: from, candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      setViewerStatus(pc.connectionState);
    };
  }


  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { to: from, answer });

  setViewerStatus('answer sent - waiting for stream...');
});

socket.on('sync-play',({ currentTime }) => {
  if(isHost) return;
  const video = document.getElementById('remoteVideo');
  video.currentTime = currentTime;
  video.play().catch(() => {});
});

socket.on('sync-pause', ({ currentTime }) => {
  if (isHost) return;
  const video = document.getElementById('remoteVideo');
  video.pause();
});

socket.on('sync-seek', ({ currentTime }) => {
  if (isHost) return;
  const video = document.getElementById('remoteVideo');
  video.currentTime = currentTime;
});

socket.on('sync-heartbeat', ({currentTime, playing}) => {
  if(isHost) return;
  const video = document.getElementById('remoteVideo');
  if(!video.srcObject) return;


  const drift = Math.abs(video.currentTime - currentTime);

  if(drift < 0.3){

  }else if(drift < 2.0){
    video.playbackRate = video.currentTime < currentTime ? 1.05 : 0.95;
    setTimeout(() => { video.playbackRate =  1.0; }, 3000);
  }else{
    video.currentTime = currentTime;
  }


  if(playing && video.paused) video.play().catch(() => {});
  if(!playing && !video.paused) video.pause();
})

socket.on('host-left', () => {
  if(isHost) return;
  setViewerStatus('host left - stream ended');
  const video = document.getElementById('remoteVideo')
  video.srcObject = null;
})

function togglePlayPause(){
  if(!localVideo) return;

   const play_pause_btn = document.getElementById('playPauseBtn');
   
  if (localVideo.paused) {
    localVideo.play();
    play_pause_btn.textContent = '⏸';
    socket.emit('sync-play', {
      roomId: currentRoom,
      currentTime: localVideo.currentTime
    });
  }else{
    localVideo.pause();
    play_pause_btn.textContent = '▶';
    socket.emit('sync-pause', {
      roomId: currentRoom,
      currentTime: localVideo.currentTime
    });
  }
}

function hostRewind() {
  localVideo.currentTime = Math.max(0, localVideo.currentTime - 30);

  socket.emit('sync-seek', {
    roomId: currentRoom,
    currentTime: localVideo.currentTime
  });
}

function hostFastForward(){
  localVideo.currentTime = Math.min(localVideo.duration, localVideo.currentTime + 30);

  socket.emit('sync-seek',{
    roomId: currentRoom,
    currentTime: localVideo.currentTime
  })
}

function toggleMute() {
  if (!localVideo) return;
  localVideo.muted = !localVideo.muted;
  document.getElementById('volumeBtn').textContent =
    localVideo.muted ? '🔇' : '🔊';
}

function toggleFullscreen(){
  const container = document.querySelector('.video-wrapper')

  if(!document.fullscreenElement){
    if(container.requestFullscreen){
      container.requestFullscreen();
    }
  }else{
    if(document.exitFullscreen){
      document.exitFullscreen();
    }
  }
}


function enableControls() {
  document.getElementById('playPauseBtn').disabled = false;
  document.getElementById('rewindBtn').disabled = false;
  document.getElementById('fastForwardBtn').disabled = false;
  document.getElementById('seekBar').disabled = false;
}


function handleVolume() {
  const slider = document.getElementById('volumeSlider');
  localVideo.volume = slider.value / 100;
  const btn = document.getElementById('volumeBtn');
  if (localVideo.volume === 0) btn.textContent = '🔇';
  else if (localVideo.volume < 0.5) btn.textContent = '🔉';
  else btn.textContent = '🔊';
}