# Revenge of the Eyecat MVP Handoff

## Current MVP

- Live production URL: <https://revenge-of-the-eyecat.vercel.app>
- GitHub repo: `babybanh/revenge-of-the-eyecat`
- Status: private/playable MVP for PIK Composition Contest 2026 polish testing, not final public launch.

## Daily Workflow

- Local dev: `npm run dev`
- Checks before sharing: `npm run lint`, `npm run test`, `npm run build`
- Publish path: commit focused changes, push `main`, then deploy production with `npx vercel@latest --prod --yes`
- Keep QA screenshots in `test-artifacts/`.

## Canonical Assets

- Shipped assets live in `public/`.
- Draft/unused assets live in `asset-sources/archive-mvp-drafts/`.
- Normal map power-up is `public/characters/item-power-up.png`.
- Bonus reward power-up is `public/characters/item-power-up-yellow.png`.
- Coins are rendered as yellow dots, not image sprites.

## Known Follow-Ups

- Continue map balancing and add more curated levels after the 7-map MVP pack.
- Refine character animation and artwork normalization when Cassia has new assets.
- Keep audio testing on phone in the loop; mobile Safari gesture unlocks are fragile.
- Do not treat the production Vercel URL as a public launch until explicitly approved.
