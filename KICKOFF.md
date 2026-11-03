# Paste this as the first message in the new repo's Claude Code session

Read SPEC.md, CLAUDE.md and ART.md. Then build MVP-0 exactly as the spec's milestone section describes it and nothing more:

- Vite + TypeScript + Three.js project, portrait canvas that fills a phone screen, tap-to-start overlay.
- Three fryer rows with two basket slots each, a freezer strip with one flavor (OG Beef), a ticket rail, a pass with a single Serve button.
- Placeholder geometry only: ravs are small cubes with a vertex color driven by a doneness uniform (pale -> gold -> dark -> black).
- Tickets arrive on a timer, each with a visible countdown edge. Tap flavor to load a basket, tap an empty slot to drop it, tap the basket to pull it, tap Serve to send it to the oldest matching ticket.
- Scoring, combo, patience, game over and restart per the spec. All numbers in src/config/.
- Matt as a plain colored rectangle with a text line for now, three lines: cold, burnt, big combo.
- npm scripts: dev (with --host), build, typecheck. Set up .gitignore, Git LFS tracking per CLAUDE.md, MIT license, a README with one paragraph.

Make one commit per working step. When it runs, print the LAN URL so the phones can open it. Do not add sound, upgrades, rushes, or extra flavors yet. The gate for anything beyond this is ten playtests.
