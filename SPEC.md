# GET TOASTED
### A fryer-station arcade game for STL Toasted on the Hill

Working title. Alternates: *Stay Toasted*, *T-Rav Rush*, *Fryer*. Slogan is "Get Toasted, Stay Toasted", so the title is probably already decided.

Dan Drake (code) and Taj (art, 3D). Started 2026-11-03 in a cafe. We are playing. If we can't stop thinking about it, we win.

---

## 1. The one sentence

You run the fryer station at STL Toasted during an endless rush that only gets busier, and Matt is watching.

## 2. Pillars (check every decision against these)

1. **Phone first, thumb first.** Portrait, touch, runs in a browser with no install. Mouse and hotkeys later.
2. **Grounded in the real station.** Three fryers, two basket slots each, baskets stack, the third fryer runs hotter for wings. Harder means busier, not weirder physics.
3. **Arcade, not story.** Endless, high score, faster and busier the longer you survive. Flappy Bird / Tetris / Donkey Kong lineage. Roguelite upgrade picks between rushes.
4. **Food commercial look.** Nour's lesson: saturated, glossy, tactile, cranked past ten. Fast and cute beats high resolution.
5. **Competitive and a little subversive.** 420 energy in the copy, not the mechanics. Matt pops up to say "Wow, great work!" when you ruin a basket.
6. **Build the STL Toasted brand.** The real menu, the real flavors, the real sauces, The Hill. Ends on "visit us."

## 3. The loop

One run = one **shift**. A shift is a sequence of **rushes** that never ends until you're sent home.

```
ticket arrives on the rail
  -> tap a flavor at the freezer to load a basket
  -> tap an open fryer slot to drop it (timer starts, doneness ramp begins)
  -> tap the basket to pull it (early = cold, in the window = perfect, late = burnt / popped)
  -> at the pass: tap the right shaker (parm+parsley+salt, or powdered sugar)
  -> tap the right sauce cup (marinara / ranch / lemon berry mascarpone)
  -> tap the ticket to serve
score, tips, combo
  -> ticket timers run the whole time; expired tickets cost patience
  -> every ~60-90 s the rush ends, 8 s lull, pick 1 of 3 upgrades
  -> next rush is busier: more tickets, more flavors, bigger quantities
game over: Matt's patience hits zero ("Clock out.")
```

**The whole UI for the first build is the doneness ramp.** Pale cream, to beige, to amber gold, to deep brown, to black. No bars, no numbers. Gold is good. You learn it in one basket.

## 4. The station (portrait layout, top to bottom)

```
+-----------------------------+
| TICKET RAIL  [6 Beef][10 Buf]|   tickets slide in from the right, each with a timer edge
+-----------------------------+
| FRYER 1   [basket][basket]  |   standard oil
| FRYER 2   [basket][basket]  |   standard oil
| FRYER 3   [basket][basket]  |   HOT oil: wings (phase 2); ravs cook faster, narrower window
+-----------------------------+
| FREEZER  Beef Buff Cheese Gooey |  tap a flavor, basket fills with that ticket's count
+-----------------------------+
| THE PASS  shakers | sauce cups | serve |
+-----------------------------+
```

Stacking: a second basket can be dropped on top of an occupied slot. The top basket cooks slower (heat shadow) and blocks pulling the bottom one. This is the real trick of the job and the first "advanced" mechanic. Ship it in MVP only if the basic three-fryer loop is already fun.

Alternative if three rows don't fit a phone: one fryer per screen, swipe left/right, with a strip of three timer pills at the top so you always know what's cooking where. Decide after the first build on a real phone.

## 5. The ravioli (MVP roster, from the real menu)

| Flavor | Cook | Window | Fail mode past window | Finish | Sauce | Order sizes |
|---|---|---|---|---|---|---|
| Three Cheese | shortest | tight | **pops** (cheese bursts the seam) | parm, parsley, salt | marinara | 6 / 10 |
| Buffalo Chicken | short | medium | burns | parm, parsley, salt | ranch | 6 / 10 |
| OG Beef | medium | medium | burns | parm, parsley, salt | marinara | 6 / 10 |
| Lemon Berry Gooey Butter | longest, slightly bigger | medium | burns | **powdered sugar** | lemon berry mascarpone | 1 / 3 |

Starting numbers (all in one tunable config file, nothing hardcoded): cheese 9 s cook / 2 s window / pops 2 s after; buffalo 11 / 2.5; beef 13 / 3; gooey 16 / 3.5. Real world is 2 to 3 minutes, the game is ~10x. Fryer 3 multiplies cook speed by 1.3 and halves the window.

Failure states, each with its own animation and Matt line:
- **Cold**: pulled early, pale. Sent back. "Those are frozen, bud."
- **Burnt**: left too long, dark to black, smoke. "Wow. Great work."
- **Popped**: three cheese only, cheese erupts from the seam into the oil. "That's the oil's lunch now."
- **Dropped**: you tapped the wrong thing mid-carry, basket spills. (Phase 2.)
- **Late**: served fine but after the ticket expired. Tip gone.
- **Wrong finish**: powdered sugar on beef, parm on a gooey, or the legendary **cornstarch incident** (a rare bad shaker appears on the pass; tap it and the whole basket is dusted in cornstarch). "Beautiful. Nobody will notice."

## 6. Scoring

- Each rav served: perfect 100, ok 50, rejected 0.
- Ticket served before its timer: tip bonus scaled by remaining time.
- Combo: consecutive perfect tickets multiply tips (x2, x3, x4, cap x5). Any rejection resets.
- **Patience** (lives): starts full. Expired ticket -1, rejected basket -1, cornstarch incident -2. Perfect ticket at high combo heals a little. Zero = "Clock out." Shown as Matt's face getting less amused.
- High score saved locally. Initials entry, three letters, arcade style.

## 7. Difficulty (grounded in restaurant reality)

Harder is just busier. Rush N increases some mix of:
- tickets per minute
- quantity per ticket (more 10s, fewer 6s)
- flavor variety on the rail at once
- multi-line tickets (6 Beef + 3 Gooey on one ticket, both must be at the pass together)
- fryer 3 going hot (phase 2 wings mean you need it hot, so ravs in it get risky)
- then wings: breading step, longer cook, their own tickets
- then chicken parm cutlets: fry and hand off to the sandwich person, no plating, no sauce, a different rhythm

Never: random physics chaos, screen shaking, mystery mechanics. Players should always be able to say "I lost because I put the cheese in the hot fryer."

## 8. Upgrades (between rushes, pick 1 of 3; the fun part of development)

Real-ish:
- **Fourth basket**: one more basket in the rotation.
- **Fresh oil**: every window 25% wider this rush.
- **Grana Padano, aged two years**: finish step is instant.
- **Pre-portioned cups**: sauce step is instant.
- **Second fryer guy**: one basket per rush auto-pulls at perfect.

Hill lore / St. Louis:
- **Mickey Garagiola's House**: "I'll bet my house on it." One free rejection, once.
- **Fritz's Scaloppini Wine**: everything cooks 20% faster, screen gently sways, tips x2. High risk.
- **Clydesdale Delivery**: tickets arrive 30% slower for one rush.
- **Where'd You Go To High School?**: every ticket from a Hill regular tips double.
- **Louisa Box**: frozen pre-breaded ravs, cold state is impossible this rush, but perfect pays half.
- **314 Day**: everything is x3.14 for 31.4 seconds.
- **Provel Shield**: absorbs one burnt basket. "Somehow fine."
- **Ted Drewes**: the layout flips upside down for a rush. Tips x3.

Toasted:
- **Smoke Break**: ticket timers pause for 10 seconds. Once per run.
- **Stay Toasted**: combo doesn't reset on your next rejection.

Keep the list in a data file. Adding an upgrade should be a one-line edit with no code.

## 9. Matt

Matt Fuller, co-owner, as a sardonic judge who pops up as a 2D illustrated portrait at the top of the screen with a one-liner. Not a 3D character. Lines live in a text file so anyone (including Matt) can add them. He only comments on failures and on big combos ("Okay. Okay okay okay."). This is the single funniest thing in the MVP, so it ships in the MVP.

Brittany is not in the MVP. If this takes off, she gets the "good cop" role or runs the pass.

## 10. Look and sound

- Nour-adjacent: saturated, glossy oil, steam, hard studio light, food-commercial color. Low poly with strong texture work. Baked lighting where possible. Orthographic or fixed-perspective camera; nothing ever needs to move the camera.
- Setting: the STL Toasted kitchen interior. Stainless, tile, the fryer bank. The Hill only through a window or the end screen.
- Particles that matter: parmesan, powdered sugar, parsley flakes. Steam and oil bubbles if cheap. Everything else is nice-to-have.
- Sound on by default behind a tap-to-start screen (browsers require it). Fryer sizzle, basket clank, ticket printer chatter, a tiny "ding" for perfect. Music: placeholder loop now, local St. Louis musicians later (Matt is one).

## 11. Platform and tech

- **Engine: Three.js (plain, no React), Vite, TypeScript.** Real-time 3D so Taj's models are the actual game objects, one low-poly rav mesh per flavor with a **doneness shader**: a single 0..1 uniform blends pale -> gold -> burnt albedo and darkens the fluted edges first. One model covers the whole ramp. Pop is a morph target or a mesh swap. Finish (parm/sugar) is a second texture layer with a 0..1 coverage uniform.
- Fallback if 3D is too slow on phones: render Taj's models to sprite sheets from Blender (doneness frames) and draw them in 2D. Decide after testing on a real phone, not before.
- Assets: glTF/GLB out of Blender, Draco compressed, textures 512 or 1024 max, power of two. Git LFS for `.blend`, `.glb`, `.png`.
- Audio: Web Audio via Howler.
- PWA: manifest + service worker so it installs to the home screen, runs full-screen portrait, and works offline. This is also what makes the **arcade cabinet** possible: a tablet in kiosk mode running the same build with a local leaderboard.
- Hosting: GitHub Pages or Cloudflare Pages, free. The STL Toasted site is a SpotHopper template, so it gets a link or an iframe. QR code on the counter.
- Leaderboard: local (localStorage, initials) in MVP. Global later via a tiny backend (Supabase or a Cloudflare Worker) only if people are actually playing.
- License: open source (MIT). The STL Toasted name, logo and menu are theirs; the repo says so.

## 12. Milestones

**MVP-0, today (2 to 3 hours): "is it fun?"**
- Portrait canvas, tap-to-start, three fryer rows with two slots, placeholder cube ravs.
- One flavor (OG Beef). Tickets arrive, load basket, drop, doneness ramp, pull, serve. Score, patience, game over, restart.
- Matt pops up on burnt and cold with three lines.
- Runs on both phones over the cafe wifi via Vite's `--host`.
- **Gate:** play it ten times. Do you want an eleventh? If no, change the loop before adding anything.

**MVP-1: the real menu**
- Four flavors with their timings, pop state for cheese, shakers and sauce cups at the pass, wrong-finish failures, cornstarch incident.
- Taj's first real models replace the cubes. Doneness shader.
- Rushes, lulls, three starter upgrades. Local high score with initials.

**MVP-2: the full station**
- Basket stacking, fryer 3 runs hot, wings, cutlets, multi-line tickets. The full upgrade list. Sound pass. PWA install. Deploy to a public URL. Show the bosses.

**Later, if it has legs**
- Rotating special of the week as an in-game special, editable from a text file.
- Global leaderboard. The arcade cabinet in the shop. Local music. Brittany. The origin story (Fritz, 1943) as an unlockable. Achievements from city lore.

## 13. Roles

- Dan: code, Claude Code driver, playtesting, the spec.
- Taj: models, textures, look dev, the modeling checklist in `ART.md`, playtesting, and code wherever he wants.
- Claude: scaffolding, systems, shaders, config, review. Reads this file and `CLAUDE.md` every session.

## 13b. Prototype: the toss loop (2026-11-05)

Dan's first playtest of the tap build: it feels like a website. The skill should be motor skill, the way the real station is (Fruit Ninja / Beat Saber granularity, not tap-a-spot). The default build is now a physics prototype; the tap build stays at `?v=tap` for comparison.

- **Freezer:** tap the Ziploc bag, a rav flies out in an arc. Drag a basket under it to catch. Hit the rim and it bounces off. Miss and it hits the counter: dead, points lost ("that one had a family"). Overfill and the top of the pile slides out.
- **Fryer:** drag the basket into the oil, it drops in and cooks. Drag it up to pull. Doneness is still the color ramp.
- **Box:** flick the basket, the ravs fly with your flick. Catch them in the styrofoam clamshell.
- **Serve:** swipe the box up. Short, cold or burnt is rejected and the ticket stays. Extra ravs cost food cost.
- Models are procedural low-poly stand-ins in `src/render/models.ts` until Taj's GLBs land. Feel numbers are in `src/config/toss.ts`.
- Next steps from the real station: the salt bowl toss, parm and parsley shakers (swipe over the box), the sauce cup in the corner, closing the lid. Add one at a time and play ten runs between.

## 14. Open decisions (answer when they come up, not before)

- Three fryer rows on one screen vs. swipe gallery. Test on a phone.
- Does the top basket in a stack fully block the bottom, or just slow it?
- Do rejected ravs get re-fired automatically (new basket, same ticket) or does the ticket just stay on the rail?
- Multi-line tickets: must both lines serve together, or line by line?
- How much 420 is the right amount of 420. Start with the title and Smoke Break and see how it reads.
- When to tell Matt and Brittany. Current plan: when MVP-2 is playable on a phone.
