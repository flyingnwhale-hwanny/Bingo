// Cute Dog Stamp SVG definition for Magic Bingo

const DogStamps = (function() {
  // Returns HTML string of a cute vector puppy face
  function getDogFaceSVG(color = '#ff9ebb') {
    return `
      <svg viewBox="0 0 100 100" class="dog-stamp-svg" style="width:100%; height:100%; filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.35));">
        <!-- Ear Left (Floppy) -->
        <path d="M 18,30 C 8,28 3,45 8,62 C 11,72 20,72 22,60 C 23,50 25,35 18,30 Z" fill="#8B4513" />
        
        <!-- Ear Right (Floppy) -->
        <path d="M 82,30 C 92,28 97,45 92,62 C 89,72 80,72 78,60 C 77,50 75,35 82,30 Z" fill="#8B4513" />
        
        <!-- Head Base -->
        <circle cx="50" cy="50" r="34" fill="#F5F5DC" stroke="#8B4513" stroke-width="2.5" />
        
        <!-- White Patch on Face -->
        <path d="M 50,16 C 42,16 38,30 38,50 C 38,62 42,66 50,66 C 58,66 62,62 62,50 C 62,30 58,16 50,16 Z" fill="#FFFFFF" />

        <!-- Brown Spot around Left Eye -->
        <path d="M 38,40 C 34,40 30,34 32,28 C 34,22 42,22 42,32 C 42,38 40,40 38,40 Z" fill="#CD853F" opacity="0.85" />
        
        <!-- Eye Left -->
        <circle cx="37" cy="33" r="4.5" fill="#2F4F4F" />
        <circle cx="35.5" cy="31.5" r="1.5" fill="#FFFFFF" /> <!-- Sparkle -->
        
        <!-- Eye Right -->
        <circle cx="63" cy="33" r="4.5" fill="#2F4F4F" />
        <circle cx="61.5" cy="31.5" r="1.5" fill="#FFFFFF" /> <!-- Sparkle -->
        
        <!-- Snout (Muzzle) -->
        <ellipse cx="50" cy="52" rx="14" ry="10" fill="#FFE4C4" stroke="#D2B48C" stroke-width="1.5" />
        
        <!-- Nose -->
        <path d="M 45,47 C 45,45 55,45 55,47 C 55,51 52,53 50,53 C 48,53 45,51 45,47 Z" fill="#1A1A1A" />
        
        <!-- Mouth Lines -->
        <path d="M 50,53 L 50,58 C 50,59 47,60 45,59 M 50,58 C 50,59 53,60 55,59" fill="none" stroke="#1A1A1A" stroke-width="2.2" stroke-linecap="round" />
        
        <!-- Tongue Sticking Out (Cute detail!) -->
        <path d="M 47,58 C 47,58 46,65 50,65 C 54,65 53,58 53,58 Z" fill="#FF6B8B" stroke="#D84360" stroke-width="1" />
        <line x1="50" y1="58" x2="50" y2="63" stroke="#D84360" stroke-width="1" />

        <!-- Cute Cheek Blushes -->
        <circle cx="26" cy="46" r="3.5" fill="#FFB6C1" opacity="0.8" />
        <circle cx="74" cy="46" r="3.5" fill="#FFB6C1" opacity="0.8" />
      </svg>
    `;
  }

  // Returns HTML string of a cute dog paw stamp
  function getDogPawSVG(color = '#F43F5E') {
    return `
      <svg viewBox="0 0 100 100" class="dog-stamp-svg" style="width:100%; height:100%; filter: drop-shadow(0px 3px 5px rgba(0,0,0,0.3));">
        <!-- Main Pad -->
        <path d="M 50,45 C 38,45 32,53 35,67 C 37,77 44,82 50,82 C 56,82 63,77 65,67 C 68,53 62,45 50,45 Z" fill="${color}" />
        
        <!-- Toe Left-Inner -->
        <ellipse cx="32" cy="38" rx="8" ry="11" fill="${color}" transform="rotate(-15, 32, 38)" />
        
        <!-- Toe Right-Inner -->
        <ellipse cx="68" cy="38" rx="8" ry="11" fill="${color}" transform="rotate(15, 68, 38)" />
        
        <!-- Toe Left-Outer -->
        <ellipse cx="18" cy="48" rx="7" ry="9" fill="${color}" transform="rotate(-30, 18, 48)" />
        
        <!-- Toe Right-Outer -->
        <ellipse cx="82" cy="48" rx="7" ry="9" fill="${color}" transform="rotate(30, 82, 48)" />
      </svg>
    `;
  }

  return {
    getFaceSVG: getDogFaceSVG,
    getPawSVG: getDogPawSVG
  };
})();

// Export globally
window.DogStamps = DogStamps;
