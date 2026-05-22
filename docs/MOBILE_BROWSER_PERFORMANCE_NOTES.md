# Mobile Browser Performance Notes

Use these notes when tuning Revenge of the Eyecat or copying the fix into the PIK trio games.

## Smooth Pickup Movement

- Keep high-frequency game events inside the game loop. Do not update React state for every coin, dot, or tiny pickup when the HUD does not need that value.
- Let Phaser update the canvas every frame, then notify React only for meaningful state changes such as keys, hearts, power-up state, win/game-over, or instruction changes.
- Avoid putting coin counts, animation ticks, joystick values, or per-frame player positions in React state unless they are visible UI requirements.

## Mobile SFX

- Avoid calling `HTMLAudio.play()` for every coin on Safari, Chrome mobile, or Facebook/Messenger in-app browsers. It can stutter movement and may be blocked by the browser.
- Prefer decoded Web Audio buffers for short SFX after the first real gesture resumes the audio context.
- Keep a lightweight HTML audio fallback for important sounds, but do not let queued fallbacks double-play later.
- Throttle repeated pickup sounds so several dots collected quickly do not trigger many audio starts in one moment.
- If per-pickup sounds still make mobile play jerky, disable coin/dot SFX on coarse-pointer or touch devices and keep them on desktop only.
- Treat intro/tutorial SFX as one-shot events with a guard ref, not as ordinary queued SFX.

## Music Start

- Do not start the MP3 during tutorial-only motion if the design says the tutorial is SFX-only.
- Start the soundtrack from the first real gameplay movement, such as Level 1 movement after the intro handoff.
- If the app returns from the background, keep music paused until the next real movement gesture.

## QA Targets

- Test iPhone Safari.
- Test iPad Safari or Chrome.
- Test Facebook/Messenger in-app browser when sharing a Vercel link.
- Watch for three things: the first SFX gesture works, repeated pickups stay smooth, and music starts only at the intended gameplay moment.
