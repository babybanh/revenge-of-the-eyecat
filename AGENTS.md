# Codex Project Context

This folder is the real GitHub/Vercel project for **Revenge of the Eyecat**.

- Local repo: `/Users/ba/Desktop/A-Z/Projects/Codex/Games/revenge-of-the-eyecat`
- GitHub remote: `https://github.com/babybanh/revenge-of-the-eyecat.git`
- Main branch: `main`
- Production URL: `https://revenge-of-the-eyecat.vercel.app`
- Local dev command: `npm run dev`

Do not confuse this project with older prototype folders such as:

- `/Users/ba/Desktop/A-Z/Projects/Codex/(May21) Codex`
- `/Users/ba/Desktop/A-Z/Projects/Codex/(May22) Codex`

Those folders may contain Pac Rescue, Moon Moth, or editor/prototype shells. For user requests about the published or Vercel-connected **Revenge of the Eyecat** game, work in this `Games/revenge-of-the-eyecat` repo.

## Current Baseline

As of May 28, 2026, the latest pushed gameplay/layout baseline is:

- Commit `ca84bc4` - `Lock mobile viewport scale`

That patch locks the mobile viewport scale and disables mobile text auto-inflation to keep the fixed 720x840 PIK game shell from spilling text when phones zoom in or out.

Before pushing future gameplay changes, run:

```bash
npm run build
npm run lint
npm run test
```

The hidden workshop is opened with `T`, `` ` ``, or `F2`.
