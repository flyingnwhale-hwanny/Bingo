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
  socket.on('createRoom', ({ topic, rows, cols, targetBingo, fillMode, wordPool }) => {
    // Generate a unique 4-digit room code
    let roomId;
    do {
      roomId = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[roomId]);

    const cleanWordPool = Array.isArray(wordPool) 
      ? wordPool.map(w => cleanString(w)).filter(Boolean) 
      : [];

    rooms[roomId] = {
      id: roomId,
      topic: topic || '자유 주제',
      gridSize: {
        rows: parseInt(rows) || 5,
        cols: parseInt(cols) || 5
      },
      targetBingo: parseInt(targetBingo) || 2,
      fillMode: fillMode === 'direct' ? 'direct' : 'pool',
      wordPool: cleanWordPool,
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

    console.log(`Room created: ${roomId} by host socket ${socket.id} (mode: ${rooms[roomId].fillMode}, pool count: ${cleanWordPool.length})`);
    
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
          fillMode: room.fillMode,
          wordPool: room.wordPool,
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
          fillMode: room.fillMode,
          wordPool: room.wordPool,
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
          fillMode: room.fillMode,
          wordPool: room.wordPool,
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

// Topic-aware word dictionaries for auto-filling missing cells
const topicDictionaries = {
  '동물': [
    '사자', '호랑이', '토끼', '여우', '곰', '기린', '코끼리', '원숭이', '다람쥐', '판다', 
    '펭귄', '돌고래', '고양이', '강아지', '양', '염소', '소', '말', '돼지', '닭', 
    '오리', '거북이', '개구리', '뱀', '악어', '사슴', '늑대', '하마', '코뿔소', '얼룩말',
    '수달', '너구리', '표범', '치타', '낙타', '사막여우', '쿼카', '알파카', '물개', '바다표범'
  ],
  '영어': [
    'Apple', 'Banana', 'Cat', 'Dog', 'Elephant', 'Fox', 'Giraffe', 'Horse', 'Ice', 'Juice',
    'Kangaroo', 'Lion', 'Monkey', 'Nose', 'Orange', 'Pencil', 'Queen', 'Rabbit', 'Snake', 'Tiger',
    'Umbrella', 'Violin', 'Water', 'Xylophone', 'Yellow', 'Zebra', 'Sun', 'Moon', 'Star', 'Tree',
    'Book', 'Desk', 'Chair', 'School', 'Teacher', 'Student', 'Friend', 'Family', 'Love', 'Happy'
  ],
  '교과': [
    '대한민국', '세종대왕', '한글', '무궁화', '애국가', '독도', '백두산', '한강', '경복궁', '태극기',
    '화산', '지진', '퇴적암', '수권', '기권', '태양계', '중력', '마찰력', '광합성', '소화',
    '분수', '소수', '삼각형', '사각형', '원', '덧셈', '뺄셈', '곱셈', '나눗셈', '평균'
  ],
  '나라': [
    '미국', '캐나다', '브라질', '아르헨티나', '멕시코', '칠레', '콜롬비아', '페루', '쿠바', '자메이카',
    '우루과이', '파라과이', '베네수엘라', '에콰도르', '볼리비아', '파나마', '코스타리카', '과테말라', '온두라스', '엘살바도르',
    '한국', '일본', '중국', '영국', '프랑스', '독일', '이탈리아', '스페인', '호주', '뉴질랜드',
    '베트남', '태국', '인도', '이집트', '그리스', '스위스', '네덜란드', '벨기에', '스웨덴', '핀란드'
  ],
  '과일': [
    '사과', '바나나', '포도', '딸기', '수박', '참외', '복숭아', '오렌지', '망고', '파인애플',
    '키위', '자두', '살구', '감', '귤', '한라봉', '체리', '석류', '무화과', '멜론'
  ],
  '음식': [
    '비빔밥', '불고기', '김치찌개', '된장찌개', '떡볶이', '김밥', '라면', '치킨', '피자', '햄버거',
    '삼겹살', '갈비', '잡채', '파전', '냉면', '칼국수', '수제비', '만두', '순대', '족발'
  ],
  '운동': [
    '축구', '야구', '농구', '배구', '수영', '태권도', '테니스', '골프', '탁구', '볼링',
    '배드민턴', '양궁', '펜싱', '유도', '레슬링', '육상', '체조', '스케이트', '스키', '줄넘기'
  ]
};

function getTopicWords(topicName) {
  if (!topicName) return topicDictionaries['동물'];
  const name = String(topicName).toLowerCase().trim();

  if (name.includes('동물')) return topicDictionaries['동물'];
  if (name.includes('영어') || name.includes('english')) return topicDictionaries['영어'];
  if (name.includes('나라') || name.includes('대륙') || name.includes('국가') || name.includes('아메리카') || name.includes('아시아') || name.includes('유럽')) return topicDictionaries['나라'];
  if (name.includes('과일')) return topicDictionaries['과일'];
  if (name.includes('음식') || name.includes('요리')) return topicDictionaries['음식'];
  if (name.includes('운동') || name.includes('스포츠')) return topicDictionaries['운동'];
  if (name.includes('교과') || name.includes('수학') || name.includes('과학') || name.includes('사회') || name.includes('국어')) return topicDictionaries['교과'];

  return topicDictionaries['동물'];
}

  // 3. Submit Board Words (Student)
  socket.on('submitBoard', ({ roomId, name, board, silent }) => {
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
    if (!silent) {
      player.ready = true;
    }
    
    // Reset stamps just in case
    player.stamped = Array(room.gridSize.rows).fill(null).map(() => Array(room.gridSize.cols).fill(false));
    player.won = false;

    console.log(`Player [${player.name}] submitted board in room ${cleanRoomId} (silent: ${!!silent})`);

    // Notify room of player list update (ready status changed)
    io.to(cleanRoomId).emit('playersUpdated', getPlayerList(room));
    if (!silent) {
      socket.emit('boardSubmittedSuccess');
    }
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

    const totalCells = room.gridSize.rows * room.gridSize.cols;
    const sampleWordsPool = (room.fillMode === 'pool' && room.wordPool && room.wordPool.length > 0)
      ? room.wordPool
      : getTopicWords(room.topic);

    // Ensure all players are ready & auto-fill ONLY missing empty cells so NO student's entered word is ever changed!
    allPlayers.forEach(p => {
      p.ready = true;
      if (!p.board || !Array.isArray(p.board)) {
        p.board = [];
      }

      // Collect existing non-empty words entered by the student
      const existingWords = new Set();
      p.board.forEach(w => {
        if (w && String(w).trim() !== '') {
          existingWords.add(cleanString(w));
        }
      });

      const availableSamples = sampleWordsPool.filter(w => !existingWords.has(cleanString(w)));
      shuffleArray(availableSamples);

      const newBoard = [];
      for (let i = 0; i < totalCells; i++) {
        const cellWord = (p.board && p.board[i]) ? String(p.board[i]).trim() : '';
        if (cellWord !== '') {
          newBoard.push(cellWord); // KEEP STUDENT'S ENTERED WORD EXACTLY AS IS!
        } else {
          const fillWord = availableSamples.pop() || `단어${i + 1}`;
          newBoard.push(fillWord);
        }
      }
      p.board = newBoard;

      p.stamped = Array(room.gridSize.rows).fill(null).map(() => Array(room.gridSize.cols).fill(false));
      p.won = false;
    });

    room.status = 'playing';
    room.drawnWords = [];
    room.winners = [];

    const names = allPlayers.map(p => p.name);
    room.turnSequence = shuffleArray(names);
    room.turnIndex = 0;

    console.log(`Game started in room ${cleanRoomId} with ALL ${allPlayers.length} players. Turn sequence:`, room.turnSequence);

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
    io.to(cleanRoomId).emit('wordSelected', {
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
