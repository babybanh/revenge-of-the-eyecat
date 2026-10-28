# Browser reliability review — 2026-10-27

## Intent preserved

Keep the SFX-only intro, soundtrack start on actual Level 1 movement, and fresh-movement recovery after backgrounding. These are explicit in docs/MOBILE_BROWSER_PERFORMANCE_NOTES.md and commits 92510fb/baae0ff. Preserve disabled frequent coin SFX on touch devices.

## Changes

Defer the soundtrack download until gesture-driven playback. Clear held keyboard/joystick/intro-release state on backgrounding, including Phaser keys. Guard hidden soundtrack starts.

## Validation

Production build, lint, 52 existing tests; Chromium and mobile WebKit start/reload/mute/background-return play checks.

Mobile checks used WebKit on macOS with a 390×844 touch viewport. Cold-pickup fixtures position collectibles at the player and run the normal collision/score/audio path. Playback was checked through running audio contexts and started buffers, not recorded speaker output. These are not physical iPhone/Android tests. Occasional long cold frames also occur with SFX off; repeat on a real phone before treating overall frame smoothness as resolved.
