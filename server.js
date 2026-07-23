const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
// Serve local qrcode library
app.use('/js/qrcode', express.static(path.join(__dirname, 'node_modules/qrcode/build')));

// Store rooms in memory
// roomId -> { topic, gridSize: { rows, cols }, targetBingo, hostSocketId, players: { name -> { socketId, board, stamped, ready, won } }, status, turnSequence, turnIndex, drawnWords, winners, allTimeWinners }
const rooms = {};

// Helper to get local network IP address (filtering out virtual adapters)
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    
    // Skip virtual/tunnel adapters
    if (
      lowerName.includes('virtual') || 
      lowerName.includes('vethernet') || 
      lowerName.includes('vmware') || 
      lowerName.includes('docker') || 
      lowerName.includes('wsl') || 
      lowerName.includes('bluetooth') ||
      lowerName.includes('hyper-v') ||
      lowerName.includes('loopback')
    ) {
      continue;
    }

    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({ name, address: iface.address });
      }
    }
  }

  // Prioritize Wi-Fi, Ethernet, or 192.168.x.x IPs
  candidates.sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    
    const aIsWifi = aName.includes('wi-fi') || aName.includes('wifi') || aName.includes('wireless') || aName.includes('와이파이');
    const bIsWifi = bName.includes('wi-fi') || bName.includes('wifi') || bName.includes('wireless') || bName.includes('와이파이');
    if (aIsWifi && !bIsWifi) return -1;
    if (!aIsWifi && bIsWifi) return 1;

    const aIsEth = aName.includes('ethernet') || aName.includes('이더넷');
    const bIsEth = bName.includes('ethernet') || bName.includes('이더넷');
    if (aIsEth && !bIsEth) return -1;
    if (!aIsEth && bIsEth) return 1;

    const a192 = a.address.startsWith('192.168.');
    const b192 = b.address.startsWith('192.168.');
    if (a192 && !b192) return -1;
    if (!a192 && b192) return 1;

    return 0;
  });

  if (candidates.length > 0) {
    console.log('Selected Physical Local IP:', candidates[0].name, '->', candidates[0].address);
    return candidates[0].address;
  }

  // Fallback if filtering removed all
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }

  return '127.0.0.1';
}

const { exec } = require('child_process');
const LOCAL_IP = getLocalIpAddress();

let publicTunnelUrl = null;

function startTunnel() {
  // Completely skip local tunnel tools when deployed on Cloud (Render, Heroku, etc.) or Linux servers
  if (process.env.RENDER || process.env.PORT || process.env.NODE_ENV === 'production' || process.platform !== 'win32') {
    console.log('Cloud environment or non-Windows OS detected. Local tunnel disabled.');
    return;
  }

  try {
    const cmd = process.platform === 'win32' ? 'npx.cmd -y tunnelmole 3000' : 'npx -y tunnelmole 3000';
    const tunnelProc = exec(cmd);
    
    if (tunnelProc.stdout) {
      tunnelProc.stdout.on('data', (data) => {
        const match = data.toString().match(/https:\/\/[a-z0-9\-]+\.tunnelmole\.net/i);
        if (match) {
          publicTunnelUrl = match[0];
          console.log('--------------------------------------------------');
          console.log('🌐 Direct Mobile Tunnel Ready (No IP prompt):', publicTunnelUrl);
          console.log('--------------------------------------------------');
        }
      });
    }

    if (tunnelProc.stderr) {
      tunnelProc.stderr.on('data', () => {});
    }

    tunnelProc.on('error', (err) => {
      console.log('Tunnel process error ignored:', err.message);
    });
  } catch (e) {
    console.log('Tunnel init warning:', e.message);
  }
}

startTunnel();

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // 1. Create Room (Host)
  socket.on('createRoom', ({ topic, rows, cols, targetBingo }) => {
    // Generate a unique 4-digit room code
    let roomId;
    do {
      roomId = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[roomId]);

    rooms[roomId] = {
      id: roomId,
      topic: topic || '자유 주제',
      gridSize: {
        rows: parseInt(rows) || 5,
        cols: parseInt(cols) || 5
      },
      targetBingo: parseInt(targetBingo) || 2,
      hostSocketId: socket.id,
      players: {},
      status: 'lobby', // lobby, playing, finished
      turnSequence: [],
      turnIndex: 0,
      drawnWords: [],
      winners: [],
      allTimeWinners: []
    };

    socket.join(roomId);
    socket.roomId = roomId;
    socket.isHost = true;

    console.log(`Room created: ${roomId} by host socket ${socket.id}`);
    
    socket.emit('roomCreated', {
      roomId,
      localIp: publicTunnelUrl || LOCAL_IP,
      port: PORT,
      settings: rooms[roomId]
    });
  });

// Helper for clean string & Unicode NFC normalization (resolving iOS Safari NFD Hangul issues)
function cleanString(str) {
  if (!str) return '';
  return String(str).trim().normalize('NFC');
}

  // 2. Join Room (Student or Host reconnecting)
  socket.on('joinRoom', ({ roomId, name, role }) => {
    const cleanRoomId = cleanString(roomId);
    const room = rooms[cleanRoomId];
    if (!room) {
      socket.emit('errorMsg', '방이 존재하지 않습니다. 방 번호를 다시 확인해주세요.');
      return;
    }

    socket.join(cleanRoomId);
    socket.roomId = cleanRoomId;

    if (role === 'host') {
      room.hostSocketId = socket.id;
      socket.isHost = true;
      console.log(`Host reconnected to room ${cleanRoomId} with socket ${socket.id}`);
      socket.emit('roomJoined', {
        role: 'host',
        roomId: cleanRoomId,
        settings: {
          topic: room.topic,
          gridSize: room.gridSize,
          targetBingo: room.targetBingo,
          status: room.status
        },
        players: getPlayerList(room),
        drawnWords: room.drawnWords,
        winners: room.winners,
        allTimeWinners: room.allTimeWinners,
        activeTurnPlayer: room.turnSequence[room.turnIndex] || null,
        turnSequence: room.turnSequence
      });
      return;
    }

    // Student joining
    const trimmedName = cleanString(name);
    if (!trimmedName) {
      socket.emit('errorMsg', '이름을 입력해주세요.');
      return;
    }

    socket.playerName = trimmedName;
    socket.isHost = false;

    // Check if player already exists in this room (direct match or normalized match)
    let existingPlayer = room.players[trimmedName];
    if (!existingPlayer) {
      existingPlayer = Object.values(room.players).find(p => cleanString(p.name) === trimmedName);
    }

    if (existingPlayer) {
      // Reconnection or update
      console.log(`Player [${existingPlayer.name}] reconnecting/updating in room ${cleanRoomId}`);
      existingPlayer.socketId = socket.id;
      
      socket.emit('roomJoined', {
        role: 'student',
        roomId: cleanRoomId,
        name: existingPlayer.name,
        settings: {
          topic: room.topic,
          gridSize: room.gridSize,
          targetBingo: room.targetBingo,
          status: room.status
        },
        board: existingPlayer.board,
        stamped: existingPlayer.stamped,
        ready: existingPlayer.ready,
        won: existingPlayer.won,
        drawnWords: room.drawnWords,
        winners: room.winners,
        activeTurnPlayer: room.turnSequence[room.turnIndex] || null,
        turnSequence: room.turnSequence
      });
    } else {
      // New player
      if (room.status !== 'lobby') {
        socket.emit('errorMsg', '이미 게임이 진행 중입니다. 새로운 게임이 시작되면 참가해 주세요.');
        return;
      }

      room.players[trimmedName] = {
        name: trimmedName,
        socketId: socket.id,
        board: [],
        stamped: Array(room.gridSize.rows).fill(null).map(() => Array(room.gridSize.cols).fill(false)),
        ready: false,
        won: false
      };

      console.log(`Student [${trimmedName}] joined room ${cleanRoomId}`);
      socket.emit('roomJoined', {
        role: 'student',
        roomId: cleanRoomId,
        name: trimmedName,
        settings: {
          topic: room.topic,
          gridSize: room.gridSize,
          targetBingo: room.targetBingo,
          status: room.status
        },
        board: [],
        stamped: room.players[trimmedName].stamped,
        ready: false,
        won: false,
        drawnWords: room.drawnWords,
        winners: room.winners,
        activeTurnPlayer: null,
        turnSequence: []
      });
    }

    // Notify the room (especially host) about updated player list
    io.to(cleanRoomId).emit('playersUpdated', getPlayerList(room));
  });

  // 3. Submit Board Words (Student)
  socket.on('submitBoard', ({ roomId, name, board }) => {
    const cleanRoomId = cleanString(roomId);
    const room = rooms[cleanRoomId];
    if (!room) {
      console.log(`submitBoard failed: room [${cleanRoomId}] not found`);
      return;
    }

    const targetName = cleanString(name);

    // 4-layer player lookup fallback strategy
    let player = room.players[targetName];
    if (!player) {
      player = Object.values(room.players).find(p => p.socketId === socket.id);
    }
    if (!player && socket.playerName) {
      player = room.players[cleanString(socket.playerName)];
    }
    if (!player && targetName) {
      player = Object.values(room.players).find(p => cleanString(p.name) === targetName);
    }

    if (!player) {
      console.log(`submitBoard failed: player [${targetName}] not found in room [${cleanRoomId}]. Current players:`, Object.keys(room.players));
      return;
    }

    // Ensure socket room association & credentials (in case of mobile socket reconnection)
    socket.join(cleanRoomId);
    socket.roomId = cleanRoomId;
    socket.playerName = player.name;
    player.socketId = socket.id;

    player.board = board; // 1D array of length rows * cols
    player.ready = true;
    
    // Reset stamps just in case
    player.stamped = Array(room.gridSize.rows).fill(null).map(() => Array(room.gridSize.cols).fill(false));
    player.won = false;

    console.log(`Player [${player.name}] submitted board in room ${cleanRoomId}`);

    // Notify room of player list update (ready status changed)
    io.to(cleanRoomId).emit('playersUpdated', getPlayerList(room));
    socket.emit('boardSubmittedSuccess');
  });

  // 4. Edit Player Name (Host)
  socket.on('editPlayerName', ({ roomId, oldName, newName }) => {
    const cleanRoomId = roomId ? String(roomId).trim() : '';
    const room = rooms[cleanRoomId];
    if (!room || !socket.isHost) return;

    const cleanOld = oldName ? String(oldName).trim() : '';
    const cleanNew = newName ? String(newName).trim() : '';

    if (!cleanNew) {
      socket.emit('errorMsg', '새 이름을 입력해주세요.');
      return;
    }

    if (!room.players[cleanOld]) {
      socket.emit('errorMsg', '해당 학생을 찾을 수 없습니다.');
      return;
    }

    if (cleanOld !== cleanNew && room.players[cleanNew]) {
      socket.emit('errorMsg', '이미 동일한 이름의 학생이 방에 존재합니다.');
      return;
    }

    const playerObj = room.players[cleanOld];
    playerObj.name = cleanNew;

    delete room.players[cleanOld];
    room.players[cleanNew] = playerObj;

    // Update target student socket
    const studentSocket = io.sockets.sockets.get(playerObj.socketId);
    if (studentSocket) {
      studentSocket.playerName = cleanNew;
      studentSocket.emit('nameUpdatedByHost', { newName: cleanNew });
    }

    console.log(`Host renamed [${cleanOld}] to [${cleanNew}] in room ${cleanRoomId}`);
    io.to(cleanRoomId).emit('playersUpdated', getPlayerList(room));
  });

  // 5. Kick Player (Host)
  socket.on('kickPlayer', ({ roomId, targetName }) => {
    const cleanRoomId = roomId ? String(roomId).trim() : '';
    const room = rooms[cleanRoomId];
    if (!room || !socket.isHost) return;

    const cleanTarget = targetName ? String(targetName).trim() : '';
    const playerObj = room.players[cleanTarget];
    if (!playerObj) return;

    const studentSocket = io.sockets.sockets.get(playerObj.socketId);
    if (studentSocket) {
      studentSocket.emit('kickedFromRoom');
      studentSocket.leave(cleanRoomId);
      studentSocket.roomId = null;
      studentSocket.playerName = null;
    }

    delete room.players[cleanTarget];
    console.log(`Host kicked student [${cleanTarget}] from room ${cleanRoomId}`);

    io.to(cleanRoomId).emit('playersUpdated', getPlayerList(room));
  });

  // 6. Start Game (Host)
  socket.on('startGame', ({ roomId }) => {
    const cleanRoomId = cleanString(roomId);
    const room = rooms[cleanRoomId];
    if (!room || !socket.isHost) return;

    const allPlayers = Object.values(room.players);
    if (allPlayers.length === 0) {
      socket.emit('errorMsg', '참가한 학생이 없습니다.');
      return;
    }

    // Filter only READY players (who pressed '입력 완료')
    const readyPlayers = allPlayers.filter(p => p.ready);
    if (readyPlayers.length === 0) {
      socket.emit('errorMsg', '아직 단어 입력을 완료한 학생이 한 명도 없습니다.');
      return;
    }

    // Evict unready players from the room so they don't get turns or block game progress
    const unreadyPlayers = allPlayers.filter(p => !p.ready);
    unreadyPlayers.forEach(p => {
      const studentSocket = io.sockets.sockets.get(p.socketId);
      if (studentSocket) {
        studentSocket.emit('kickedFromRoom');
        studentSocket.leave(cleanRoomId);
        studentSocket.roomId = null;
        studentSocket.playerName = null;
      }
      delete room.players[p.name];
    });

    const activePlayers = Object.values(room.players);
    room.status = 'playing';
    room.drawnWords = [];
    room.winners = [];

    activePlayers.forEach(p => {
      p.won = false;
      p.stamped = Array(room.gridSize.rows).fill(null).map(() => Array(room.gridSize.cols).fill(false));
    });

    const names = activePlayers.map(p => p.name);
    room.turnSequence = shuffleArray(names);
    room.turnIndex = 0;

    console.log(`Game started in room ${cleanRoomId} with ${names.length} READY players. Turn sequence:`, room.turnSequence);

    io.to(cleanRoomId).emit('gameStarted', {
      status: room.status,
      activeTurnPlayer: room.turnSequence[0],
      turnSequence: room.turnSequence,
      settings: {
        topic: room.topic,
        gridSize: room.gridSize,
        targetBingo: room.targetBingo,
        status: room.status
      },
      players: getPlayerList(room)
    });
  });

  // 5. Select Word (Turn Player or Host)
  socket.on('selectWord', ({ roomId, name, word }) => {
    const cleanRoomId = cleanString(roomId);
    const room = rooms[cleanRoomId];
    if (!room || room.status !== 'playing') return;

    const activePlayerName = room.turnSequence[room.turnIndex];
    if (activePlayerName !== name && !socket.isHost) {
      socket.emit('errorMsg', '자신의 차례가 아닙니다.');
      return;
    }

    const cleanWord = word.trim();
    if (!cleanWord || room.drawnWords.includes(cleanWord)) {
      socket.emit('errorMsg', '이미 선택된 단어이거나 유효하지 않은 단어입니다.');
      return;
    }

    // Add to drawn words list
    room.drawnWords.push(cleanWord);
    console.log(`Word selected in room ${roomId}: "${cleanWord}" by ${name}`);

    // Update stamps for all players containing this word
    const rows = room.gridSize.rows;
    const cols = room.gridSize.cols;

    Object.values(room.players).forEach(player => {
      // Find matches in the player board
      // Board is a 1D array of size rows * cols
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const index = r * cols + c;
          if (player.board[index] && player.board[index].trim() === cleanWord) {
            player.stamped[r][c] = true;
          }
        }
      }
    });

    // Determine next player's turn
    // Skip players who have already won (if any are archived)
    let nextTurnIndex = room.turnIndex;
    let nextPlayerName = null;
    
    // Find next active player who hasn't won yet
    for (let i = 1; i <= room.turnSequence.length; i++) {
      const idx = (room.turnIndex + i) % room.turnSequence.length;
      const testName = room.turnSequence[idx];
      const testPlayer = room.players[testName];
      if (testPlayer && !testPlayer.won) {
        nextTurnIndex = idx;
        nextPlayerName = testName;
        break;
      }
    }

    // If no one is found (all won), we'll keep the current index
    if (nextPlayerName) {
      room.turnIndex = nextTurnIndex;
    } else {
      nextPlayerName = activePlayerName; // Fallback
    }

    // Broadcast the selection to all players
    io.to(roomId).emit('wordSelected', {
      word: cleanWord,
      selectedBy: name,
      nextTurnPlayer: nextPlayerName,
      players: getPlayerList(room), // Update student layouts and stamp statuses
      drawnWords: room.drawnWords
    });
  });

  // 6. Claim Bingo Success (Student)
  socket.on('claimBingo', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;

    const player = room.players[name];
    if (!player || player.won) return;

    // Mark player as won in this round
    player.won = true;
    
    if (!room.winners.includes(name)) {
      room.winners.push(name);
    }

    console.log(`Player ${name} completed bingo in room ${roomId}!`);

    // Broadcast bingo success
    io.to(roomId).emit('bingoCompleted', {
      winners: room.winners,
      winnerName: name,
      players: getPlayerList(room)
    });
    
    // Pause game state to finished/victory screen
    room.status = 'finished';
  });

  // 7. Continue Game (Host)
  socket.on('continueGame', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !socket.isHost || room.status !== 'finished') return;

    console.log(`Continuing game in room ${roomId}. Archive current winners: ${room.winners.join(', ')}`);

    // Move current winners to allTimeWinners
    room.winners.forEach(w => {
      if (!room.allTimeWinners.includes(w)) {
        room.allTimeWinners.push(w);
      }
    });

    // Clear current winners list
    room.winners = [];

    // Filter remaining players who haven't won yet
    const activePlayers = Object.values(room.players).filter(p => !p.won);

    if (activePlayers.length === 0) {
      socket.emit('errorMsg', '더 이상 게임을 계속할 참가자가 없습니다. 모든 학생이 빙고를 완성했습니다!');
      return;
    }

    // Re-create turn sequence from remaining active players
    const names = activePlayers.map(p => p.name);
    room.turnSequence = shuffleArray(names);
    room.turnIndex = 0;
    
    room.status = 'playing';

    io.to(roomId).emit('gameContinued', {
      turnSequence: room.turnSequence,
      activeTurnPlayer: room.turnSequence[0],
      allTimeWinners: room.allTimeWinners,
      players: getPlayerList(room),
      status: room.status
    });
  });

  // 8. End Game (Host)
  socket.on('endGame', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !socket.isHost) return;

    console.log(`Game ended in room ${roomId}`);

    // Create final podium list
    // Add any remaining winners in this round to allTimeWinners
    room.winners.forEach(w => {
      if (!room.allTimeWinners.includes(w)) {
        room.allTimeWinners.push(w);
      }
    });

    io.to(roomId).emit('gameEnded', {
      allTimeWinners: room.allTimeWinners,
      players: getPlayerList(room)
    });

    // Clean up room
    delete rooms[roomId];
  });

  // 9. Handle Disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    // Find room associated with this socket
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      
      if (socket.isHost) {
        console.log(`Host disconnected from room ${roomId}. Waiting to reconnect or terminate.`);
        // We don't immediately delete the room in case host page refreshes.
        // But we notify players that host disconnected.
        io.to(roomId).emit('hostDisconnected');
      } else if (socket.playerName) {
        console.log(`Student ${socket.playerName} disconnected from room ${roomId}`);
        // We don't delete student board, in case of brief disconnect/refresh
        // Just mark as offline or keep their status
        io.to(roomId).emit('playersUpdated', getPlayerList(room));
      }
    }
  });
});

// Helper: Convert players map to clean list for clients
function getPlayerList(room) {
  return Object.values(room.players).map(p => {
    // Determine connection state by matching active socket
    const activeSocket = io.sockets.sockets.get(p.socketId);
    return {
      name: p.name,
      ready: p.ready,
      won: p.won,
      board: p.board, // Needed for Host dashboard to display boards
      stamped: p.stamped,
      online: !!(activeSocket && activeSocket.connected)
    };
  });
}

// Helper: Fisher-Yates shuffle
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`--------------------------------------------------`);
  console.log(`Magic Bingo (마법빙고) Server Running!`);
  console.log(`Local Access: http://localhost:${PORT}`);
  console.log(`LAN Access:   http://${LOCAL_IP}:${PORT}`);
  console.log(`--------------------------------------------------`);
});
