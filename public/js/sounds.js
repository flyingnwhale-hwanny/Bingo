// Synthesized Sound Effects using Web Audio API for Magic Bingo

const SoundEffects = (function() {
  let audioCtx = null;

  function initContext() {
    try {
      if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
    } catch (e) {
      console.warn('AudioContext init skipped/failed:', e);
    }
  }

  // Play a simple retro synth note
  function playNote(freq, type, duration, startTime, volume = 0.1) {
    try {
      initContext();
      if (!audioCtx) return;

      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gainNode.gain.setValueAtTime(volume, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    } catch (e) {
      console.warn('Audio playNote warning:', e);
    }
  }

  return {
    // 1. Light bubble click sound
    playClick: function() {
      try {
        initContext();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
        
        gainNode.gain.setValueAtTime(0.12, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.start(now);
        osc.stop(now + 0.1);
      } catch (e) {
        console.warn('Audio playClick warning:', e);
      }
    },

    // 2. Upward rising scale for student joining
    playJoin: function() {
      try {
        initContext();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const notes = [329.63, 392.00, 523.25, 659.25];
        notes.forEach((freq, idx) => {
          playNote(freq, 'sine', 0.15, now + (idx * 0.08), 0.08);
        });
      } catch (e) {
        console.warn('Audio playJoin warning:', e);
      }
    },

    // 3. Cute stamp sound (short bouncy tap / pop)
    playStamp: function() {
      try {
        initContext();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(220, now);
        osc1.frequency.exponentialRampToValueAtTime(80, now + 0.15);

        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(880, now);
        osc2.frequency.exponentialRampToValueAtTime(440, now + 0.08);
        
        gainNode.gain.setValueAtTime(0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        
        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.18);
        osc2.stop(now + 0.18);
      } catch (e) {
        console.warn('Audio playStamp warning:', e);
      }
    },

    // 4. Sparkles / Chime sound for line-bingo
    playLineBingo: function() {
      try {
        initContext();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const notes = [987.77, 1318.51, 1567.98, 1975.53];
        notes.forEach((freq, idx) => {
          playNote(freq, 'sine', 0.25, now + (idx * 0.06), 0.05);
        });
      } catch (e) {
        console.warn('Audio playLineBingo warning:', e);
      }
    },

    // 5. Celebration Fanfare for overall game completion
    playWinner: function() {
      try {
        initContext();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        
        const melody = [
          { f: 261.63, d: 0.15 },
          { f: 329.63, d: 0.15 },
          { f: 392.00, d: 0.15 },
          { f: 523.25, d: 0.25 },
          
          { f: 349.23, d: 0.15 },
          { f: 440.00, d: 0.15 },
          { f: 523.25, d: 0.15 },
          { f: 587.33, d: 0.25 },
          
          { f: 392.00, d: 0.15 },
          { f: 493.88, d: 0.15 },
          { f: 587.33, d: 0.15 },
          { f: 698.46, d: 0.25 },
          
          { f: 523.25, d: 0.60 }
        ];
        
        let timeOffset = 0;
        melody.forEach((note) => {
          playNote(note.f, 'triangle', note.d, now + timeOffset, 0.12);
          timeOffset += note.d * 0.85;
        });

        const finalTime = now + timeOffset - 0.5;
        playNote(261.63, 'sine', 0.6, finalTime, 0.08);
        playNote(329.63, 'sine', 0.6, finalTime, 0.08);
        playNote(392.00, 'sine', 0.6, finalTime, 0.08);
      } catch (e) {
        console.warn('Audio playWinner warning:', e);
      }
    }
  };
})();

// Export globally
window.SoundEffects = SoundEffects;
