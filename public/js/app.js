// Frontend Logic for Magic Bingo (마법빙고)

(function() {
  // App state variables
  let socket = null;
  let currentRole = null; // 'host' or 'student'
  let roomId = null;
  let playerName = null;
  let gridRows = 5;
  let gridCols = 5;
  let targetBingo = 2;
  let topic = '동물 이름';
  
  let boardWords = []; // 1D array of length rows * cols
  let drawnWords = [];
  let activeTurnPlayer = null;
  let turnSequence = [];
  let previousBingoCount = 0;
  let completedLinesTracked = [];

  // Theme animals dictionary for quick random fill
  const wordDictionary = {
    '동물 이름': [
      '사자', '호랑이', '토끼', '여우', '곰', '기린', '코끼리', '원숭이', '다람쥐', '판다', 
      '펭귄', '돌고래', '고양이', '강아지', '양', '염소', '소', '말', '돼지', '닭', 
      '오리', '거북이', '개구리', '뱀', '악어', '사슴', '늑대', '하마', '코뿔소', '얼룩말'
    ],
    '영어 단어': [
      'Apple', 'Banana', 'Cat', 'Dog', 'Elephant', 'Fox', 'Giraffe', 'Horse', 'Ice', 'Juice',
      'Kangaroo', 'Lion', 'Monkey', 'Nose', 'Orange', 'Pencil', 'Queen', 'Rabbit', 'Snake', 'Tiger',
      'Umbrella', 'Violin', 'Water', 'Xylophone', 'Yellow', 'Zebra', 'Sun', 'Moon', 'Star', 'Tree'
    ],
    '교과 단어': [
      '대한민국', '세종대왕', '한글', '무궁화', '애국가', '독도', '백두산', '한강', '경복궁', '태극기',
      '화산', '지진', '퇴적암', '수권', '기권', '태양계', '중력', '마찰력', '광합성', '소화',
      '분수', '소수', '삼각형', '사각형', '원', '덧셈', '뺄셈', '곱셈', '나눗셈', '평균'
    ]
  };

  // DOM Elements cache
  const views = {
    home: document.getElementById('view-home'),
    setup: document.getElementById('view-setup'),
    studentJoin: document.getElementById('view-student-join'),
    studentName: document.getElementById('view-student-name'),
    hostLobby: document.getElementById('view-host-lobby'),
    studentLobby: document.getElementById('view-student-lobby'),
    hostGame: document.getElementById('view-host-game'),
    studentGame: document.getElementById('view-student-game'),
    victoryOverlay: document.getElementById('overlay-victory')
  };

  // Main navigation helper
  function showView(viewElement) {
    if (!viewElement) {
      console.error('showView error: viewElement is null');
      return;
    }
    try {
      if (typeof SoundEffects !== 'undefined' && SoundEffects.playClick) {
        SoundEffects.playClick();
      }
    } catch (e) {
      console.warn('Click sound skipped in showView:', e);
    }
    Object.values(views).forEach(v => {
      if (v) v.classList.remove('active');
    });
    viewElement.classList.add('active');

    // Forcibly hide wait overlay whenever game views are shown
    if (viewElement === views.studentGame || viewElement === views.hostGame) {
      const waitOverlay = document.getElementById('overlay-wait-start');
      if (waitOverlay) waitOverlay.classList.remove('active');
    }
  }

  // Calculate local, tunnel, or cloud URL for invite link & QR code
  function getInviteUrl(localIp, port, rId) {
    // 1. If running on cloud domain (e.g. .onrender.com, .glitch.me, etc.)
    const isCloudHost = !window.location.hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/) && 
                        window.location.hostname !== 'localhost' && 
                        window.location.hostname !== '127.0.0.1';
    if (isCloudHost) {
      return `${window.location.protocol}//${window.location.host}/?room=${rId}`;
    }

    // 2. If localIp is a full URL (like tunnelmole)
    if (localIp && (localIp.startsWith('http://') || localIp.startsWith('https://'))) {
      const cleanUrl = localIp.replace(/\/$/, '');
      return `${cleanUrl}/?room=${rId}`;
    }

    // 3. If running locally on PC
    const host = (localIp && localIp !== '127.0.0.1' && localIp !== 'localhost') 
      ? `${localIp}:${port}` 
      : `${window.location.hostname}:${port}`;
    return `${window.location.protocol}//${host}/?room=${rId}`;
  }

  // Safe confetti helper
  function triggerConfetti(opts) {
    if (typeof confetti === 'function') {
      try {
        confetti(opts);
      } catch (err) {
        console.warn('Confetti failed:', err);
      }
    }
  }

  // --- Initializer ---
  function init() {
    setupSocket();
    setupEventListeners();
    checkUrlParams();
    renderSetupPreview();
  }

  // Connect & define listeners for Socket.io
  function setupSocket() {
    if (typeof io === 'undefined') {
      const warningDiv = document.createElement('div');
      warningDiv.style.position = 'fixed';
      warningDiv.style.top = '0';
      warningDiv.style.left = '0';
      warningDiv.style.width = '100vw';
      warningDiv.style.height = '100vh';
      warningDiv.style.background = 'rgba(15, 11, 33, 0.95)';
      warningDiv.style.zIndex = '9999';
      warningDiv.style.display = 'flex';
      warningDiv.style.flexDirection = 'column';
      warningDiv.style.alignItems = 'center';
      warningDiv.style.justifyContent = 'center';
      warningDiv.style.color = '#fff';
      warningDiv.style.padding = '2rem';
      warningDiv.style.textAlign = 'center';
      warningDiv.innerHTML = `
        <h2 style="color: #fbbf24; font-family: 'Jua', sans-serif; font-size: 2rem; margin-bottom: 1rem;">⚠️ 웹 서버 접속 필요</h2>
        <p style="font-size: 1.1rem; line-height: 1.6; max-width: 500px; margin-bottom: 1.5rem;">
          현재 HTML 파일을 직접 실행하셨습니다. 실시간 멀티플레이 빙고를 실행하려면 
          반드시 <strong>웹 서버 포트</strong>로 접속하셔야 합니다.
        </p>
        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 2rem;">
          <code style="font-size: 1.2rem; color: #a78bfa;">http://localhost:3000</code>
        </div>
        <button onclick="window.location.href='http://localhost:3000'" style="padding: 0.75rem 2rem; background: #7c3aed; border: none; border-radius: 8px; color: #fff; font-size: 1.1rem; cursor: pointer; font-family: 'Jua', sans-serif;">
          localhost:3000 으로 이동하기
        </button>
      `;
      document.body.appendChild(warningDiv);
      return;
    }

    window.onerror = function(message, source, lineno, colno, error) {
      console.error("Runtime Error:", message, "at", source, ":", lineno);
      alert(`⚠️ 자바스크립트 오류 발생:\n${message}\n위치: ${source} (${lineno}행)`);
      return false;
    };

    socket = io();

    // 0. Auto Rejoin on Connection / Reconnection (for mobile screen wake/Wi-Fi jitter)
    socket.on('connect', () => {
      console.log('Socket connected/reconnected:', socket.id);
      const isViewingActiveRoom = views.studentLobby.classList.contains('active') || 
                                  views.studentGame.classList.contains('active') || 
                                  views.hostLobby.classList.contains('active') || 
                                  views.hostGame.classList.contains('active');
      if (roomId && isViewingActiveRoom) {
        if (currentRole === 'student' && playerName) {
          socket.emit('joinRoom', { roomId, name: playerName, role: 'student' });
        } else if (currentRole === 'host') {
          socket.emit('joinRoom', { roomId, role: 'host' });
        }
      }
    });

    // 1. Error receiver
    socket.on('errorMsg', (msg) => {
      if (msg.includes('방이 존재하지 않습니다')) {
        roomId = null;
        alert('서버가 업데이트되었거나 방이 종료되었습니다. [새 방 만들기] 버튼을 눌러 새로 시작해 주세요.');
        showView(views.home);
        return;
      }
      alert(`⚠️ 안내: ${msg}`);
    });

    // 2. Room Created (Host)
    socket.on('roomCreated', ({ roomId: rId, localIp, port, settings }) => {
      currentRole = 'host';
      roomId = rId;
      topic = settings.topic;
      gridRows = settings.gridSize.rows;
      gridCols = settings.gridSize.cols;
      targetBingo = settings.targetBingo;

      document.getElementById('display-host-room-id').innerText = roomId;
      document.getElementById('label-host-lobby-topic').innerText = topic;
      document.getElementById('label-host-lobby-size').innerText = `${gridRows}x${gridCols}`;
      document.getElementById('label-host-lobby-target').innerText = `${targetBingo}줄`;

      // Set invitation link input
      const inviteUrl = getInviteUrl(localIp, port, roomId);
      document.getElementById('input-invite-link').value = inviteUrl;

      // Render QR code
      const qrContainer = document.getElementById('qr-code-canvas');
      qrContainer.innerHTML = '';
      try {
        const canvas = document.createElement('canvas');
        QRCode.toCanvas(canvas, inviteUrl, { width: 160, margin: 1 }, function(error) {
          if (!error) {
            qrContainer.appendChild(canvas);
          } else {
            console.error('QR code generation error:', error);
            qrContainer.innerHTML = 'QR코드 생성 실패';
          }
        });
      } catch (err) {
        console.error('QR Code library error:', err);
        qrContainer.innerHTML = 'QR코드 라이브러리 오류';
      }

      // Reset players count
      document.getElementById('counter-lobby-players').innerText = '0';
      document.getElementById('list-lobby-players').innerHTML = `
        <div class="empty-players-placeholder">
          학생들이 코드를 입력하거나 QR코드를 스캔하여 입장하고 있습니다... 🐾
        </div>
      `;

      showView(views.hostLobby);
    });

  function isSameName(name1, name2) {
    if (!name1 || !name2) return false;
    const s1 = String(name1).trim().replace(/\s+/g, '').normalize('NFC');
    const s2 = String(name2).trim().replace(/\s+/g, '').normalize('NFC');
    return s1 === s2;
  }

    // 3. Room Joined (everyone)
    socket.on('roomJoined', (data) => {
      roomId = data.roomId;
      topic = data.settings.topic;
      gridRows = data.settings.gridSize.rows;
      gridCols = data.settings.gridSize.cols;
      targetBingo = data.settings.targetBingo;
      drawnWords = data.drawnWords || [];

      if (data.role === 'host') {
        currentRole = 'host';
        if (data.settings.status === 'lobby') {
          showView(views.hostLobby);
        } else {
          // Reconnect back to gaming board
          document.getElementById('label-host-game-room-id').innerText = roomId;
          document.getElementById('label-host-game-topic').innerText = topic;
          document.getElementById('label-host-game-target').innerText = `${targetBingo}줄`;
          
          activeTurnPlayer = data.activeTurnPlayer;
          turnSequence = data.turnSequence;
          renderHostDrawnWords();
          renderHostTurnCard();
          renderHostSpyDashboard(data.players);
          showView(views.hostGame);
          
          if (data.settings.status === 'finished' && data.winners.length > 0) {
            showVictoryOverlay(data.winners);
          }
        }
      } else {
        currentRole = 'student';
        if (data.name) playerName = data.name;
        completedLinesTracked = [];
        previousBingoCount = 0;
        
        document.getElementById('label-student-topic').innerText = `주제: ${topic}`;
        document.getElementById('label-student-size').innerText = `${gridRows}x${gridCols}`;
        document.getElementById('label-student-target').innerText = `${targetBingo}줄`;

        document.getElementById('display-student-game-name').innerText = playerName;
        document.getElementById('display-student-game-topic').innerText = `주제: ${topic}`;
        document.getElementById('label-student-game-target').innerText = targetBingo;

        if (data.settings.status === 'playing' || data.settings.status === 'finished') {
          // Game already running! Show studentGame view immediately!
          const waitOverlay = document.getElementById('overlay-wait-start');
          if (waitOverlay) waitOverlay.classList.remove('active');
          
          if (data.board && data.board.length > 0) {
            boardWords = data.board;
          }
          const stampedMatrix = data.stamped || Array(gridRows).fill(null).map(() => Array(gridCols).fill(false));
          renderStudentPlayBoard(boardWords, stampedMatrix);
          renderStudentDrawnWords();
          updateStudentTurnBanner(data.activeTurnPlayer);
          showView(views.studentGame);
          
          if (data.settings.status === 'finished' && data.winners.length > 0) {
            showVictoryOverlay(data.winners);
          }
        } else {
          // Setup Board Entry input in lobby
          if (!data.ready) {
            document.getElementById('overlay-wait-start').classList.remove('active');
            renderStudentInputGrid(gridRows, gridCols);
          } else {
            document.getElementById('display-wait-name').innerText = playerName;
            document.getElementById('overlay-wait-start').classList.add('active');
            renderStudentInputGrid(gridRows, gridCols);
            // Pre-fill
            const cells = document.querySelectorAll('.bingo-input-cell input');
            cells.forEach((cell, idx) => {
              if (data.board[idx]) cell.value = data.board[idx];
            });
          }
          showView(views.studentLobby);
        }
      }
    });

    // 4. Players Updated
    socket.on('playersUpdated', (playerList) => {
      if (currentRole === 'host') {
        const isGameActive = views.hostGame.classList.contains('active');
        if (!isGameActive) {
          renderHostLobbyPlayers(playerList);
        } else {
          renderHostSpyDashboard(playerList);
        }
      } else if (currentRole === 'student') {
        renderStudentScoreboard(playerList);
      }
    });

    // 5. Game Started
    socket.on('gameStarted', (data) => {
      if (currentRole !== 'host') {
        currentRole = 'student';
      }
      turnSequence = data.turnSequence;
      activeTurnPlayer = data.activeTurnPlayer;
      drawnWords = [];
      completedLinesTracked = [];
      previousBingoCount = 0;

      // FORCIBLY REMOVE WAIT OVERLAY
      const waitOverlay = document.getElementById('overlay-wait-start');
      if (waitOverlay) waitOverlay.classList.remove('active');
      views.victoryOverlay.classList.remove('active');

      if (currentRole === 'host') {
        document.getElementById('label-host-game-room-id').innerText = roomId;
        document.getElementById('label-host-game-topic').innerText = topic;
        document.getElementById('label-host-game-target').innerText = `${targetBingo}줄`;
        
        renderHostDrawnWords();
        renderHostTurnCard();
        renderHostSpyDashboard(data.players);
        showView(views.hostGame);
      } else {
        // Retrieve my updated board from data.players
        const myDetails = (data.players || []).find(p => isSameName(p.name, playerName));
        if (myDetails && myDetails.board && myDetails.board.length > 0) {
          boardWords = myDetails.board;
        } else {
          const cells = document.querySelectorAll('.bingo-input-cell input');
          boardWords = Array.from(cells).map(input => input.value.trim());
        }

        const emptyStamp = Array(gridRows).fill(null).map(() => Array(gridCols).fill(false));
        const stampedMatrix = (myDetails && myDetails.stamped) ? myDetails.stamped : emptyStamp;

        renderStudentPlayBoard(boardWords, stampedMatrix);
        renderStudentDrawnWords();
        updateStudentTurnBanner(activeTurnPlayer);
        
        document.getElementById('display-student-bingo-count').innerText = '0';
        
        showView(views.studentGame);
      }

      SoundEffects.playJoin();
    });

    // 6. Word Selected
    socket.on('wordSelected', (data) => {
      drawnWords = data.drawnWords;
      activeTurnPlayer = data.nextTurnPlayer;

      SoundEffects.playStamp();

      // Ensure wait overlay is removed and student remains on game view
      const waitOverlay = document.getElementById('overlay-wait-start');
      if (waitOverlay) waitOverlay.classList.remove('active');

      if (currentRole === 'host') {
        renderHostDrawnWords();
        renderHostTurnCard();
        renderHostSpyDashboard(data.players);
      } else {
        // Find player details to retrieve stamped
        const myDetails = (data.players || []).find(p => p.name === playerName || (typeof cleanString !== 'undefined' && cleanString(p.name) === cleanString(playerName)));
        if (myDetails) {
          renderStudentPlayBoard(boardWords, myDetails.stamped);
          checkAndReportBingo(myDetails.stamped);
        } else if (boardWords && boardWords.length > 0) {
          const emptyStamp = Array(gridRows).fill(null).map(() => Array(gridCols).fill(false));
          renderStudentPlayBoard(boardWords, emptyStamp);
        }
        
        renderStudentDrawnWords();
        updateStudentTurnBanner(activeTurnPlayer);
        showView(views.studentGame);
      }
    });

    // 7. Bingo Completed (Win round)
    socket.on('bingoCompleted', (data) => {
      if (currentRole === 'host') {
        renderHostSpyDashboard(data.players);
      } else {
        const myDetails = data.players.find(p => p.name === playerName);
        if (myDetails) {
          renderStudentPlayBoard(boardWords, myDetails.stamped);
        }
      }
      
      showVictoryOverlay(data.winners);
    });

    // 8. Game Continued (New round)
    socket.on('gameContinued', (data) => {
      views.victoryOverlay.classList.remove('active');
      turnSequence = data.turnSequence;
      activeTurnPlayer = data.activeTurnPlayer;
      
      if (currentRole === 'host') {
        renderHostTurnCard();
        renderHostSpyDashboard(data.players);
      } else {
        const myDetails = data.players.find(p => p.name === playerName);
        if (myDetails) {
          // If already won, board remains but turn won't come back
          renderStudentPlayBoard(boardWords, myDetails.stamped);
        }
        updateStudentTurnBanner(activeTurnPlayer);
      }
      
      SoundEffects.playJoin();
    });

    // 9. Game Ended
    socket.on('gameEnded', (data) => {
      views.victoryOverlay.classList.remove('active');
      
      let winnerMsg = '';
      if (data.allTimeWinners && data.allTimeWinners.length > 0) {
        winnerMsg = `\n\n🏆 최종 빙고 달성자 🏆\n${data.allTimeWinners.map((w, idx) => `[${idx+1}등] ${w}`).join('\n')}`;
      }
      
      alert(`게임이 종료되었습니다!${winnerMsg}\n\n홈 화면으로 이동합니다.`);
      resetLocalState();
      showView(views.home);
    });

    // 10. Host Disconnected
    socket.on('hostDisconnected', () => {
      alert('교사/호스트와의 연결이 끊어졌습니다. 대기 중입니다...');
    });

    // 11. Name Updated By Host (Student)
    socket.on('nameUpdatedByHost', ({ newName }) => {
      playerName = newName;
      alert(`선생님에 의해 이름이 '${newName}'(으)로 변경되었습니다.`);
      const nameDisp1 = document.getElementById('display-student-game-name');
      if (nameDisp1) nameDisp1.innerText = playerName;
      const nameDisp2 = document.getElementById('display-wait-name');
      if (nameDisp2) nameDisp2.innerText = playerName;
    });

    // 12. Kicked From Room (Student)
    socket.on('kickedFromRoom', (data) => {
      const reason = (data && data.reason) ? data.reason : '선생님에 의해 방에서 퇴장되었습니다.';
      alert(`⚠️ 안내: ${reason}`);
      resetLocalState();
      showView(views.home);
    });
  }

  // Bind click/change handlers to DOM buttons
  function setupEventListeners() {
    // Logo Click -> Go Home (if not in game)
    document.getElementById('btn-logo').addEventListener('click', () => {
      if (!roomId) {
        showView(views.home);
      }
    });

    // --- Home View Actions ---
    document.getElementById('btn-choose-host').addEventListener('click', () => {
      showView(views.setup);
    });
    
    document.getElementById('btn-choose-student').addEventListener('click', () => {
      document.getElementById('input-room-code').value = '';
      showView(views.studentJoin);
    });

    // --- Setup View Actions ---
    document.getElementById('btn-setup-back').addEventListener('click', () => {
      showView(views.home);
    });

    const colsInput = document.getElementById('input-grid-cols');
    const rowsInput = document.getElementById('input-grid-rows');

    function updateGridSetup() {
      let cols = parseInt(colsInput.value);
      let rows = parseInt(rowsInput.value);
      if (isNaN(cols)) cols = 5;
      if (isNaN(rows)) rows = 5;
      
      if (cols < 3) cols = 3;
      if (cols > 6) cols = 6;
      if (rows < 3) rows = 3;
      if (rows > 6) rows = 6;

      gridCols = cols;
      gridRows = rows;
      renderSetupPreview();
    }

    colsInput.addEventListener('input', updateGridSetup);
    rowsInput.addEventListener('input', updateGridSetup);

    document.getElementById('btn-create-room').addEventListener('click', () => {
      const topicInput = document.getElementById('input-topic').value.trim();
      
      let cols = parseInt(colsInput.value);
      if (isNaN(cols) || cols < 3) cols = 3;
      if (cols > 6) cols = 6;
      
      let rows = parseInt(rowsInput.value);
      if (isNaN(rows) || rows < 3) rows = 3;
      if (rows > 6) rows = 6;
      
      let target = parseInt(document.getElementById('input-target-bingo').value);
      if (isNaN(target) || target < 1) target = 1;

      const maxPossibleLines = (rows === cols) ? (rows + cols + 2) : (rows + cols);
      if (target > maxPossibleLines) {
        target = maxPossibleLines;
        document.getElementById('input-target-bingo').value = target;
      }

      if (!socket || !socket.connected) {
        if (typeof io !== 'undefined') {
          socket = io();
        }
        alert('서버와 연결을 확인 중입니다. 잠시 후 다시 [방 개설하기]를 눌러주세요.');
        return;
      }

      socket.emit('createRoom', {
        topic: topicInput || '자유 주제',
        rows: rows,
        cols: cols,
        targetBingo: target
      });
    });

    // --- Student Join / Name View Actions ---
    document.getElementById('btn-join-back').addEventListener('click', () => {
      showView(views.home);
    });

    document.getElementById('btn-find-room').addEventListener('click', () => {
      const code = document.getElementById('input-room-code').value.trim();
      if (code.length !== 4) {
        alert('방 번호는 4자리 숫자입니다.');
        return;
      }
      roomId = code;
      
      // Proceed to name step
      document.getElementById('label-join-room-info').innerText = `방 번호: [${roomId}]`;
      document.getElementById('input-student-name').value = '';
      showView(views.studentName);
    });

    document.getElementById('btn-submit-name').addEventListener('click', () => {
      const name = document.getElementById('input-student-name').value.trim().normalize('NFC');
      if (!name) {
        alert('이름을 입력해주세요.');
        return;
      }
      playerName = name;
      socket.emit('joinRoom', {
        roomId: roomId,
        name: playerName,
        role: 'student'
      });
    });

    // --- Host Lobby View Actions ---
    document.getElementById('btn-copy-link').addEventListener('click', () => {
      const copyText = document.getElementById('input-invite-link');
      copyText.select();
      copyText.setSelectionRange(0, 99999);
      navigator.clipboard.writeText(copyText.value);
      
      const btn = document.getElementById('btn-copy-link');
      btn.innerText = '복사 완료!';
      setTimeout(() => { btn.innerText = '복사'; }, 2000);
      SoundEffects.playClick();
    });

    document.getElementById('btn-start-game').addEventListener('click', () => {
      const readyBadges = document.querySelectorAll('#list-lobby-players .player-card-badge.ready');
      const totalBadges = document.querySelectorAll('#list-lobby-players .player-card-badge');
      const readyCount = readyBadges.length;
      const totalCount = totalBadges.length;
      const unreadyCount = totalCount - readyCount;

      if (totalCount === 0) {
        alert('참가한 학생이 없습니다.');
        return;
      }

      if (unreadyCount > 0) {
        const msg = `아직 단어 입력을 마치지 않은 학생이 ${unreadyCount}명 있습니다.\n\n게임을 바로 시작하시겠습니까?\n(미입력 빈칸은 샘플 단어로 자동 채워져 참가한 학생 전원이 즐겁게 함께 참여합니다!)`;
        if (!confirm(msg)) {
          return;
        }
      }

      socket.emit('startGame', { roomId });
    });

    // --- Student Lobby View Actions ---
    document.getElementById('btn-fill-random').addEventListener('click', () => {
      fillRandomWords();
    });

    document.getElementById('btn-clear-all').addEventListener('click', () => {
      clearAllWords();
    });

    document.getElementById('btn-submit-board').addEventListener('click', () => {
      const inputs = document.querySelectorAll('.bingo-input-cell input');
      const words = Array.from(inputs).map(inp => inp.value.trim());

      // Validate empty cells
      if (words.some(w => w === '')) {
        alert('빈칸이 있습니다! 모든 칸에 단어를 채워 넣어주세요.');
        return;
      }

      // Check duplicates
      const uniques = new Set(words);
      if (uniques.size !== words.length) {
        alert('중복된 단어가 있습니다! 서로 다른 단어들을 입력해 주세요.');
        return;
      }

      boardWords = words.map(w => w.normalize('NFC'));
      socket.emit('submitBoard', {
        roomId,
        name: playerName ? playerName.normalize('NFC') : '',
        board: boardWords
      });

      document.getElementById('display-wait-name').innerText = playerName;
      if (!views.studentGame.classList.contains('active')) {
        document.getElementById('overlay-wait-start').classList.add('active');
      }
      SoundEffects.playJoin();
    });

    document.getElementById('btn-edit-board').addEventListener('click', () => {
      document.getElementById('overlay-wait-start').classList.remove('active');
      SoundEffects.playClick();
    });

    // --- Host Game Dashboard View Actions ---
    document.getElementById('btn-host-end-game').addEventListener('click', () => {
      if (confirm('정말로 게임을 종료하시겠습니까? 현재까지의 데이터가 전부 초기화됩니다.')) {
        socket.emit('endGame', { roomId });
      }
    });

    // --- Victory Modal Actions (Host buttons) ---
    document.getElementById('btn-victory-continue').addEventListener('click', () => {
      socket.emit('continueGame', { roomId });
    });

    document.getElementById('btn-victory-end').addEventListener('click', () => {
      socket.emit('endGame', { roomId });
    });
  }

  // Parse URL query parameter: e.g. /?room=1234
  function checkUrlParams() {
    try {
      let roomParam = null;
      if (window.location.search) {
        const match = window.location.search.match(/[?&]room=([^&]+)/);
        if (match) roomParam = match[1];
      }
      if (roomParam && roomParam.trim().length === 4) {
        roomId = roomParam.trim();
        const infoEl = document.getElementById('label-join-room-info');
        if (infoEl) infoEl.innerText = `방 번호: [${roomId}]`;
        const nameEl = document.getElementById('input-student-name');
        if (nameEl) nameEl.value = '';
        showView(views.studentName);
      }
    } catch (err) {
      console.warn('checkUrlParams warning:', err);
    }
  }

  // Reset local script variables
  function resetLocalState() {
    roomId = null;
    currentRole = null;
    playerName = null;
    boardWords = [];
    drawnWords = [];
    activeTurnPlayer = null;
    turnSequence = [];
    previousBingoCount = 0;
    completedLinesTracked = [];

    // Clear queries
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Draw empty cells for Host setup view preview
  function renderSetupPreview() {
    const preview = document.getElementById('grid-preview');
    preview.className = `grid-preview`;
    preview.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`;
    preview.style.aspectRatio = `${gridCols} / ${gridRows}`;
    preview.innerHTML = '';
    
    const cellCount = gridRows * gridCols;
    for (let i = 0; i < cellCount; i++) {
      const cell = document.createElement('div');
      cell.className = 'grid-preview-cell';
      preview.appendChild(cell);
    }
  }

  // Render Host Lobby list of students
  function renderHostLobbyPlayers(players) {
    const listContainer = document.getElementById('list-lobby-players');
    const totalCounter = document.getElementById('counter-lobby-players');
    const readyCounter = document.getElementById('counter-lobby-ready');

    let readyCount = 0;
    players.forEach(p => { if (p.ready) readyCount++; });

    if (totalCounter) totalCounter.innerText = players.length;
    if (readyCounter) readyCounter.innerText = readyCount;

    if (players.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-players-placeholder">
          학생들이 코드를 입력하거나 QR코드를 스캔하여 입장하고 있습니다... 🐾
        </div>
      `;
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('btn-start-game').innerText = '🎲 빙고 시작 (참가 학생 없음)';
      return;
    }

    listContainer.innerHTML = '';

    players.forEach(player => {
      const pCard = document.createElement('div');
      pCard.className = `player-card-badge ${player.ready ? 'ready' : ''}`;
      
      const statusText = player.ready ? '입력 완료 ✅' : '단어 입력 중 ✍️';

      pCard.innerHTML = `
        <div class="player-badge-header">
          <span class="player-badge-status">${statusText}</span>
          <div class="player-actions">
            <button class="btn-action-edit" data-name="${player.name}" title="이름 수정">✏️</button>
            <button class="btn-action-kick" data-name="${player.name}" title="퇴장 시키기">❌</button>
          </div>
        </div>
        <span class="player-card-name" title="${player.name}">${player.name}</span>
      `;
      listContainer.appendChild(pCard);
    });

    // Attach click events for edit & kick buttons
    listContainer.querySelectorAll('.btn-action-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const oldName = btn.dataset.name;
        const newName = prompt(`'${oldName}' 학생의 새로운 이름을 입력하세요:`, oldName);
        if (newName && newName.trim() && newName.trim() !== oldName) {
          socket.emit('editPlayerName', { roomId, oldName, newName: newName.trim() });
        }
      });
    });

    listContainer.querySelectorAll('.btn-action-kick').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetName = btn.dataset.name;
        if (confirm(`정말로 '${targetName}' 학생을 방에서 퇴장시키시겠습니까?`)) {
          socket.emit('kickPlayer', { roomId, targetName });
        }
      });
    });

    const startBtn = document.getElementById('btn-start-game');
    const canStart = readyCount > 0;
    startBtn.disabled = !canStart;
    startBtn.innerText = canStart 
      ? `🎲 빙고 게임 시작하기! (${readyCount}명 준비됨 / 총 ${players.length}명)` 
      : `🎲 빙고 시작 (입력 완료한 학생 없음)`;
  }

  // Render student input board view
  function renderStudentInputGrid(rows, cols) {
    const gridContainer = document.getElementById('grid-student-input');
    gridContainer.className = `bingo-grid`;
    gridContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    gridContainer.style.aspectRatio = `${cols} / ${rows}`;
    gridContainer.innerHTML = '';

    const totalCells = rows * cols;
    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('div');
      cell.className = 'bingo-input-cell';
      
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 15;
      input.placeholder = `단어 ${i + 1}`;
      input.id = `input-cell-${i}`;
      
      // Auto tab movement helper
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const nextInput = document.getElementById(`input-cell-${i + 1}`);
          if (nextInput) nextInput.focus();
        }
      });

      const label = document.createElement('span');
      label.className = 'cell-index';
      label.innerText = i + 1;

      cell.appendChild(label);
      cell.appendChild(input);
      gridContainer.appendChild(cell);
    }
  }

  // Auto fill dictionary words
  function fillRandomWords() {
    let pool = wordDictionary[topic] || [];
    if (pool.length < gridRows * gridCols) {
      // Fallback pool: generic number list
      pool = Array.from({ length: 40 }, (_, idx) => `단어${idx + 1}`);
    }
    
    // Shuffle pool
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    
    const inputs = document.querySelectorAll('.bingo-input-cell input');
    inputs.forEach((input, index) => {
      input.value = shuffled[index] || `단어${index + 1}`;
    });
    SoundEffects.playClick();
  }

  // Clear student inputs
  function clearAllWords() {
    const inputs = document.querySelectorAll('.bingo-input-cell input');
    inputs.forEach(input => { input.value = ''; });
    SoundEffects.playClick();
  }

  // Render active student playing board grid
  function renderStudentPlayBoard(board, stamped) {
    const gridContainer = document.getElementById('grid-student-game-board');
    gridContainer.className = `bingo-grid game-play-grid`;
    gridContainer.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`;
    gridContainer.style.aspectRatio = `${gridCols} / ${gridRows}`;
    gridContainer.innerHTML = '';

    const totalCells = gridRows * gridCols;
    
    // Check completed lines for formatting highlight
    const { completedLines } = checkBingos(stamped, gridRows, gridCols);
    
    for (let i = 0; i < totalCells; i++) {
      const r = Math.floor(i / gridCols);
      const c = i % gridCols;
      
      const cell = document.createElement('div');
      cell.className = 'bingo-cell';
      
      const word = board[i] || '';
      
      const content = document.createElement('span');
      content.className = 'cell-content-text';
      content.innerText = word;
      
      // Stamped classes & overlay
      const isStamped = stamped[r][c];
      if (isStamped) {
        cell.classList.add('stamped');
        
        const stampOverlay = document.createElement('div');
        stampOverlay.className = 'dog-stamp-overlay';
        // Alternate stamps or just face
        stampOverlay.innerHTML = DogStamps.getFaceSVG();
        cell.appendChild(stampOverlay);
      }

      // Check if this cell resides on a completed line
      const cellInLine = checkCellOnCompletedLines(r, c, completedLines);
      if (cellInLine) {
        cell.classList.add('line-completed');
      }

      // Click select event
      cell.appendChild(content);
      
      if (activeTurnPlayer === playerName && !isStamped) {
        cell.addEventListener('click', () => {
          if (word.trim() !== '') {
            socket.emit('selectWord', {
              roomId,
              name: playerName,
              word: word
            });
          }
        });
      }
      
      gridContainer.appendChild(cell);
    }
  }

  // Check if grid coordinates exist inside completed paths
  function checkCellOnCompletedLines(r, c, lines) {
    for (const line of lines) {
      if (line.startsWith('row-')) {
        const targetRow = parseInt(line.split('-')[1]);
        if (r === targetRow) return true;
      }
      if (line.startsWith('col-')) {
        const targetCol = parseInt(line.split('-')[1]);
        if (c === targetCol) return true;
      }
      if (line === 'diag-1' && r === c) return true;
      if (line === 'diag-2' && r === (gridCols - 1 - c)) return true;
    }
    return false;
  }

  // Check board stamp matrix for row/col/diag lines
  function checkBingos(stamped, rows, cols) {
    const completedLines = [];
    
    // Check rows
    for (let r = 0; r < rows; r++) {
      let full = true;
      for (let c = 0; c < cols; c++) {
        if (!stamped[r][c]) { full = false; break; }
      }
      if (full) completedLines.push(`row-${r}`);
    }
    
    // Check cols
    for (let c = 0; c < cols; c++) {
      let full = true;
      for (let r = 0; r < rows; r++) {
        if (!stamped[r][c]) { full = false; break; }
      }
      if (full) completedLines.push(`col-${c}`);
    }

    // Check Diagonals
    if (rows === cols) {
      let diag1 = true;
      for (let i = 0; i < rows; i++) {
        if (!stamped[i][i]) { diag1 = false; break; }
      }
      if (diag1) completedLines.push('diag-1');

      let diag2 = true;
      for (let i = 0; i < rows; i++) {
        if (!stamped[i][rows - 1 - i]) { diag2 = false; break; }
      }
      if (diag2) completedLines.push('diag-2');
    }

    return {
      count: completedLines.length,
      completedLines
    };
  }

  // Student checking if target bingo lines were hit
  function checkAndReportBingo(stamped) {
    const { count, completedLines } = checkBingos(stamped, gridRows, gridCols);
    document.getElementById('display-student-bingo-count').innerText = count;

    // Check if new bingo line has been made, trigger chime
    if (count > previousBingoCount) {
      SoundEffects.playLineBingo();
      
      // Sparkle particles for small reward
      triggerConfetti({
        particleCount: 20,
        angle: 60,
        spread: 55,
        origin: { x: 0 }
      });
      triggerConfetti({
        particleCount: 20,
        angle: 120,
        spread: 55,
        origin: { x: 1 }
      });
    }
    previousBingoCount = count;

    // Meet goal! Send claim
    if (count >= targetBingo) {
      const alreadyReported = completedLinesTracked.length >= targetBingo;
      if (!alreadyReported) {
        completedLinesTracked = completedLines;
        socket.emit('claimBingo', {
          roomId,
          name: playerName,
          bingoCount: count
        });
      }
    }
  }

  // Update Turn header banner on Student screen
  function updateStudentTurnBanner(turnPlayer) {
    const banner = document.getElementById('banner-student-turn-status');
    const msgEl = document.getElementById('label-student-turn-message');
    
    if (turnPlayer === playerName) {
      banner.className = 'turn-status-banner active-turn';
      msgEl.innerHTML = '🗣️ <strong>내 차례입니다!</strong> 빙고판에서 부를 단어 1개를 클릭하세요.';
    } else {
      banner.className = 'turn-status-banner waiting';
      msgEl.innerHTML = `🐾 <strong>${turnPlayer}</strong> 학생 차례입니다. 단어 선택을 기다리는 중...`;
    }
  }

  // Render Host drawn words history chips
  function renderHostDrawnWords() {
    const list = document.getElementById('list-host-drawn-words');
    document.getElementById('counter-host-drawn-words').innerText = drawnWords.length;
    list.innerHTML = '';
    
    drawnWords.forEach(word => {
      const chip = document.createElement('span');
      chip.className = 'word-chip host-drawn';
      chip.innerText = word;
      list.appendChild(chip);
    });
  }

  // Render Student drawn words history chips
  function renderStudentDrawnWords() {
    const list = document.getElementById('list-student-drawn-words');
    document.getElementById('counter-student-drawn-words').innerText = drawnWords.length;
    list.innerHTML = '';

    drawnWords.forEach(word => {
      const chip = document.createElement('span');
      chip.className = 'word-chip';
      chip.innerText = word;
      list.appendChild(chip);
    });
  }

  // Render Host current turn card dashboard
  function renderHostTurnCard() {
    const display = document.getElementById('display-host-turn-player');
    const queueDisplay = document.getElementById('display-host-turn-order');

    if (!activeTurnPlayer) {
      display.innerText = '-';
      queueDisplay.innerHTML = '';
      return;
    }

    display.innerText = activeTurnPlayer;

    // Show turn queue flow (next names)
    const idx = turnSequence.indexOf(activeTurnPlayer);
    if (idx === -1) {
      queueDisplay.innerHTML = '';
      return;
    }

    queueDisplay.innerHTML = '';
    
    // Add up to 3 next players
    for (let i = 1; i <= 3; i++) {
      const nextIdx = (idx + i) % turnSequence.length;
      if (nextIdx === idx) break; // Only 1 player
      const nextName = turnSequence[nextIdx];
      
      const el = document.createElement('span');
      el.className = 'flow-item';
      if (i === 1) el.className = 'flow-item next';
      el.innerText = i === 1 ? `➡️ ${nextName}` : ` -> ${nextName}`;
      queueDisplay.appendChild(el);
    }
  }

  // Render teacher visual watch dashboard
  function renderHostSpyDashboard(playerList) {
    const dashboard = document.getElementById('grid-host-students-boards');
    dashboard.innerHTML = '';

    if (playerList.length === 0) {
      dashboard.innerHTML = '<div class="empty-players-placeholder">참가한 학생이 없습니다.</div>';
      return;
    }

    playerList.forEach(player => {
      const card = document.createElement('div');
      card.className = `mini-student-card ${player.won ? 'won-bingo' : ''}`;

      // Calculate current bingo count
      const { count } = checkBingos(player.stamped, gridRows, gridCols);

      card.innerHTML = `
        <div class="mini-card-header">
          <span class="mini-card-name" title="${player.name}">${player.name}</span>
          <span class="mini-card-badge">${count} 빙고</span>
        </div>
      `;

      // Miniature grid outline
      const mGrid = document.createElement('div');
      mGrid.className = `mini-grid`;
      mGrid.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`;
      mGrid.style.aspectRatio = `${gridCols} / ${gridRows}`;
      
      const totalCells = gridRows * gridCols;
      for (let i = 0; i < totalCells; i++) {
        const r = Math.floor(i / gridCols);
        const c = i % gridCols;
        
        const mCell = document.createElement('div');
        mCell.className = `mini-cell ${player.stamped[r][c] ? 'stamped' : ''}`;
        mGrid.appendChild(mCell);
      }

      card.appendChild(mGrid);
      dashboard.appendChild(card);
    });
  }

  // Render student scoreboard list in sidebar
  function renderStudentScoreboard(playerList) {
    const scoreboard = document.getElementById('list-student-scoreboard');
    scoreboard.innerHTML = '';

    // Sort players by bingo count
    const sorted = playerList.map(player => {
      const { count } = checkBingos(player.stamped, gridRows, gridCols);
      return {
        name: player.name,
        bingoCount: count,
        won: player.won,
        online: player.online
      };
    }).sort((a, b) => b.bingoCount - a.bingoCount);

    sorted.forEach(player => {
      const row = document.createElement('div');
      row.className = `score-row ${player.name === playerName ? 'highlighted' : ''}`;
      
      const wonTag = player.won ? ' 🏆' : '';
      const offlineTag = player.online ? '' : ' [오프라인]';
      row.innerHTML = `
        <span class="score-name" title="${player.name}">${player.name}${wonTag}${offlineTag}</span>
        <span class="score-count">${player.bingoCount} 빙고</span>
      `;
      scoreboard.appendChild(row);
    });
  }

  // Display overall Victory Screen
  function showVictoryOverlay(winnersList) {
    const list = document.getElementById('list-victory-winners');
    list.innerHTML = '';

    winnersList.forEach(name => {
      const badge = document.createElement('div');
      badge.className = 'winner-name-badge';
      badge.innerText = `🐾 ${name}`;
      list.appendChild(badge);
    });

    // Toggle controls depending on role
    const hostCtrls = document.getElementById('host-victory-controls');
    const studCtrls = document.getElementById('student-victory-controls');

    if (currentRole === 'host') {
      hostCtrls.style.display = 'flex';
      studCtrls.style.display = 'none';
    } else {
      hostCtrls.style.display = 'none';
      studCtrls.style.display = 'block';
    }

    views.victoryOverlay.classList.add('active');
    
    // Play fanfare music & launch confetti
    SoundEffects.playWinner();
    
    // Confetti shower
    const duration = 3 * 1000;
    const end = Date.now() + duration;

    (function frame() {
      triggerConfetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0 }
      });
      triggerConfetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1 }
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    }());
  }

  // Boot the client
  document.addEventListener('DOMContentLoaded', init);

})();
