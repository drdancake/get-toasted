# Get Toasted

A touchscreen browser arcade game (phone for playtesting, a lobby cabinet for real) about running the fryer station at STL Toasted on the Hill (St. Louis). Two people build it: Dan (code) and Taj (3D art), each with their own Claude Code. Read `SPEC.md` before doing anything; it is the design authority. `ART.md` is the asset checklist and the export rules. `docs/research.md` is the background on the restaurant, the food, Nour and St. Louis.

## Stack
- Three.js (plain, no React), Vite, TypeScript. Howler for audio. PWA (manifest + service worker).
- Assets: GLB out of Blender, Draco compressed, textures power-of-two, 1024 max. Git LFS tracks `*.blend *.glb *.png *.jpg *.mp3 *.ogg *.wav`.
- All tunable numbers live in `src/config/` (`flavors.ts`, `rushes.ts`, `upgrades.ts`, `matt-lines.ts`). Adding a flavor, upgrade or Matt line never requires touching game logic.

## Layout
- `src/game/` state machine and systems (tickets, fryers, baskets, pass, scoring, patience, rushes, upgrades)
- `src/render/` scene, camera, materials (doneness shader), particles
- `src/ui/` touch input, overlays (tap-to-start, Matt, upgrade pick, game over, initials)
- `src/config/` data files
- `assets/` models, textures, audio (LFS)
- `art/` Taj's working files (LFS), never imported directly
- `docs/` spec research and notes

## Rules
- Touch first, phone and tablet both. The target is a big portrait touchscreen cabinet in the Toasted lobby (SPEC section 0); the phone is how we playtest. Every feature is checked in portrait on a phone and in portrait on a tablet-sized screen before it is called done. `npm run dev -- --host` so the other laptop and both phones can open it over the cafe wifi.
- Placeholder first. Never block code on art or art on code. Cubes are fine until they aren't.
- "Is it fun?" is the gate. Play ten runs before adding a system. If the tenth run is a chore, fix the loop, do not add the system.
- Harder means busier, never weirder. See the difficulty section of `SPEC.md`.
- Nothing hardcoded that a designer would want to tune. Numbers go in `src/config/`.
- Small commits on branches, PRs, pull often. Two people never edit the same file at the same time; Dan owns `src/`, Taj owns `art/` and `assets/`, and anything crossing that line is a quick heads-up in the cafe or a PR.
- Keep the build small. Check the bundle and asset size before merging anything heavy. Target under 10 MB total for first load.
- No external services in MVP. localStorage for high scores. A backend is a deliberate later decision.
- The STL Toasted name, logo, menu and the owners' names belong to STL Toasted. The code is MIT. Say so in the README.
- Run `npm run build` and `npm run typecheck` before a PR.

## Local only (gitignored)
- `.claude/settings.local.json`, `CLAUDE.local.md`, `.env`
