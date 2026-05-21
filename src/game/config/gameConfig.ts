export const gameConfig = {
  copy: {
    title: 'Revenge of the Eyecat',
    startPrompt: 'Move Eyecat. Rescue the cat hostage before the vacuums catch you.',
    startHint: 'Move Eyecat with the joystick, arrow keys, or WASD. Collect coins and keys, then rescue the cat.',
    creditsLabel: 'Credits',
    musicStartLabel: 'Start Music',
    musicOnLabel: 'Music: On',
    musicOffLabel: 'Music: Off',
  },
  assets: {
    background: '/backgrounds/lab-final-ruin-2.png',
    optionalBackgrounds: ['/backgrounds/lab-final-ruin.png', '/backgrounds/lab-ruin.png', '/backgrounds/lab-glow.png'],
    player: '/characters/player-eye-cat-plain.png',
    vacuum: '/characters/character-vacuum.png',
    hostage: '/characters/character-white-cat.png',
    coin: '/characters/character-coin.png',
    music: '/audio/cassia-revenge-of-the-eyecat-remix.mp3',
  },
  credits: {
    contestTitle: 'PIK Composition Contest 2026',
    contestUrl: 'https://youtube.com/playlist?list=PLhhleIn9mEjhNAztK55u86m13lu6xpqoM&si=9kGz8asDtaMO3Wy8',
    studentCredit: 'Original music and characters by Cassia',
    youtubeUrl: 'https://youtu.be/sr8MUHoempk?si=fSSh9eexR-s-zNS8',
    youtubeEmbedUrl: 'https://www.youtube.com/embed/sr8MUHoempk',
    developerCredit: 'Game design and development by Le Binh Anh Nguyen and Codex',
  },
  layout: {
    designWidth: 720,
    designHeight: 840,
    playfieldSize: 640,
    bottomJoystickXPercent: 70,
    bottomJoystickYPercent: 88,
  },
  storageKeys: {
    musicEnabled: 'revengeOfTheEyecat.musicEnabled',
    workshopOpen: 'revengeOfTheEyecat.workshopOpen',
  },
} as const
