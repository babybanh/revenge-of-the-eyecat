# Revenge of the Eyecat

Private first playable shell for the PIK Composition Contest 2026 game series.

This game uses the Eyecat Pacman-like rescue prototype as its mechanics foundation and the Banana Monkey / Restless Spirit presentation pattern as the series UX reference: fixed 720x840 shell, centered square playfield, top HUD, bottom credits/music/joystick controls, blurred intro layer, credits modal, and hidden tuning tools.

## Run Locally

```bash
npm install
npm run dev
```

Checks:

```bash
npm run test
npm run lint
npm run build
```

## Editing Notes

- Main UI shell: `src/App.tsx` and `src/App.css`
- Core rules: `src/game/pacrescue/`
- Phaser rendering: `src/game/scenes/PacRescueScene.ts`
- Browser-ready assets: `public/backgrounds/`, `public/characters/`, `public/audio/`
- Hidden workshop: press `T`, `` ` ``, or `F2`

## Role Map

| Revenge of the Eyecat role | Internal mechanics role | Browser-ready file |
| --- | --- | --- |
| Eyecat player | `player` / Pac-style actor | `public/characters/player-eye-cat-plain.png` |
| Vacuum enemy | chaser / patroller | `public/characters/character-vacuum.png` |
| Cat hostage | hostage / rescue target | `public/characters/character-white-cat.png` |
| Coin | collectible | Yellow dot renderer |
| Ruin stage 2 background | stage background | `public/backgrounds/lab-final-ruin-2.png` |
| Cassia theme | background music | `public/audio/cassia-revenge-of-the-eyecat-remix.mp3` |

Some internal test names still use generic Pacman terms like ghost/chaser because those are rule-system terms. Player-facing copy should use Eyecat, vacuum, coin, key, and cat hostage.

## Current Draft

- Seven named maps are available in the hidden workshop.
- Collect coins to reveal the final key, collect all visible keys, then rescue the cat hostage.
- Power pellets temporarily let Eyecat stun vacuums.
- Joystick, arrow keys, or WASD start each paused level and unlock audio.
- After a rescue, the next board loads automatically, stays frozen, and waits for the next movement gesture.
- After Level 7 is cleared, Try Again returns to Level 1 as a frozen board.
- Losing all three hearts returns to Level 1 automatically.
- Coins render as simple yellow dots by default; the old coin image is only kept as an optional tuning asset.
- Music starts from a real movement gesture.
- Event SFX are generated in-browser for this first shell.
- Credits use Cassia as the student credit and embed the current theme video: <https://youtu.be/sr8MUHoempk?si=fSSh9eexR-s-zNS8>
- GitHub and Vercel setup are intentionally left for the next phase after local QA.
