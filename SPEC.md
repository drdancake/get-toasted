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

## 13c. The shift: station plus microgames (2026-11-05)

Dan's second playtest: the toss is the fun part, but one screen with everything on it is clutter. Raw ravs could bounce straight into the box, and it wasn't clear how cooked ravs got out of a basket. The real station, from the line:

- **Station (home screen):** three fryers, two slots each, baskets long-ways with handles toward you. Fryers 1 and 2 at 300°F, fryer 3 at 350°F (the wing fryer: 1.3x heat, half the window). Eight baskets on the line.
- **Freezer microgame:** tap FREEZER, see the bags (OG Beef, Three Cheese, Buffalo, Gooey Butter), tap a bag, a rav hops out, catch it in your basket. Never mix flavors: cooked ravs look identical, so a mixed basket can't be served and its timer is wrong. NEXT BASKET stages the full one and hands you a clean one. DONE goes back to the fryers. The fryers keep cooking while you're in there.
- **Drop, nest, wiggle, time:** drag a staged basket into a slot. Drop a second basket onto a full slot to nest it: it holds the bottom one under (fully submerged) and comes out first. Ravs float unless you wiggle the basket side to side or nest one on top; floaters cook uneven and cap at "ok". Tap a basket's chip to start its timer.
- **Real timings, one scale:** three cheese 3:45, buffalo 4:00, gooey butter 4:45, beef 4:50, all divided by `COOK_SCALE` (16) so the order and gaps stay true. Mozz sticks (5:45) and wings come later. Gooey butter ravs are about 1.6x the size.
- **Pass microgame:** drag a basket up out of the oil and you're at the pass holding it, with a box labeled for the matching ticket. Flick the ravs in, swipe the box up to serve. The basket goes back on the rack when it's empty.
- Next from the line: shaking wings in the hot fryer, the salt bowl toss, parm and parsley, sauce cups, the lid.

## 13d. Direction: a WarioWare collage over an Overcooked clock (2026-11-05)

The game is a loop of short, sharp microgames, each one a real step on the line, stitched together while two clocks run in the background: the fryer timers and the customers' patience. A wrong order costs more than points: it wrecks your flow (Overcooked). Like WarioWare, each microgame has a small set of tricks it can throw at you, and getting good means recognizing them instantly.

Shape of a microgame: a one-word prompt flashes ("SUGAR!"), you do the motion, and sometimes it breaks mid-motion and you fix it fast ("CLOGGED! tap it") before going back.

Catalog from the line, in order of the real process (built so far: freezer catch, fryer drop/nest/wiggle/timer, flick into the box):

| Microgame | The motion | What can go wrong |
|---|---|---|
| Freezer | tap a bag, catch in a basket | mixed flavors, drops, overfill |
| Fryer | drop, nest, wiggle, start timer, pull | floaters, forgotten timer, burnt, hot fryer |
| Wax paper | lay a checkerboard sheet in the box before the ravs | forget it, crooked sheet |
| Salt bowl | dump the basket into the silver bowl, toss to salt | spill over the rim, under-salted |
| Into the box | dump the bowl into the box on the wax paper | miss, overfill, wrong box |
| Dress | parm + parsley (savory) or powdered sugar (gooey), shake hard | shaker clogs mid-shake, wrong shaker |
| Sauce | cup in the corner: marinara, ranch, lemon berry mascarpone | wrong sauce, spilled cup |
| Close | fold the lid, press the two locking tabs | tab won't catch |
| Name | Sharpie the customer's name on the lid | (flavor, maybe a speed bonus) |
| Wings (later) | walk to the back fridge, season, cornstarch, dress, drop in the 350°F fryer, shake a lot so they don't stick | sticking, long trip |

Real details to keep: the box is a styrofoam clamshell with angled sides (a wide hexagon in profile) that seals in the middle with two locking tabs. The wax paper has a black and white checkerboard (about 1 inch checks), cut from 12 inch sheets into 6 inch squares that match the box floor.

Discipline: add one microgame at a time, play ten runs, keep it only if the loop is better.

## 13e. The full order, from the line (Dan, 2026-11-05)

This is the target loop. Microgames: **freezer** (gather), **fryer** (cook), **expo** (plate). The rail and the timers run under all of them.

**The ticket.** White receipt paper on the rail. The real ticket has sandwiches and chips too; this game only reads the fried-food lines at the bottom. A ticket can carry several items at once, and two tickets landing together play like one big combination order.

**Order sizes (real menu rules).**
- Savory ravs (beef, three cheese, buffalo): 6 or 10. Each can be one flavor or **two flavors split evenly**: a 10 of beef/buffalo is 5 + 5, a 6 of cheese/beef is 3 + 3.
- Gooey butter (dessert): 1 or 3. Never split.
- Example ticket: a 10 split beef/buffalo, a 6 of three cheese, a 1 gooey butter.

**Telling ravs apart.** Same dough outside, different filling inside, so the color difference is slight but real: beef pale tan, buffalo a little orange, three cheese whiter. Cooked, it's harder, but three cheese shows little bits of cheese oozing from the perforations (and sometimes bursts). A keen eye can catch a stray rav in any state: raw, cooked or dressed.

**A stray rav is not a ruined basket.** If a buffalo lands in the beef basket, you look in, find it, and pick it out. The game tracks every rav physically, so a stray that makes it into a box is only judged at the end, and penalties are graded:
- 5 beef + 1 buffalo in a 6 beef order: a small penalty (it's one rav).
- 6 beef sent to a buffalo order: a real failure (wrong order).
- Scoring rewards flow: multipliers for clean streaks, penalties scaled by how wrong.

**Freezer (gather).** Pick the baskets you're filling on the station first (tap the empty ones on the bars), then go in with all of them. In the freezer each basket is its own object, and each finger can steer a different one: launch beef and buffalo together and catch them in two baskets. You can leave a basket in the freezer by accident, and it's still there next time ("where the hell is my other basket?"). For a really big order, Dan would carry the whole bin out to the fryers; maybe later.

**Fryer (cook).** One fryer can carry that whole example ticket: left slot 5 beef with 5 buffalo nested on top, right slot 1 gooey with 6 cheese on top (longer cook goes underneath, comes out last). Drop them as close together as you can, then press the timers. The timers are only a guide: the game counts real seconds submerged, so a late press means you could overcook.

**Expo (plate).** Its own microgame, at the cold table:
- **Boxes in three sizes.** Small is for a 1 gooey. Medium is for a 3 gooey or a 6 of anything (a bigger order fits in a pinch but looks worse). Large is for a 10.
- **Wax paper.** Line each box with a checkerboard sheet: 6 inch squares for medium and large, 2 inch for small.
- **Label.** Mark each box for its order. Dan writes the name and contents in Sharpie on the lid; in the game this is a quick tap-label that keeps the player sane when several orders are going.
- **Salt bowl.** Cooked ravs go from the basket into a silver bowl, get salted and jostled, then go into the box.
- **Arrange (style points).**
  - A 6 in the medium box is a tetromino: three across the back, two down the left, one in the middle, sauce in the bottom right corner.
  - A 10 in the large box: four across the back, four down the left, three nested in the corner, sauce bottom right.
  - A 5/5 split: a column of each flavor down the left and right edges, both sauce cups in the middle.
  - Dumping them in is allowed, it just doesn't score style.
- **Sauces.**
  - Marinara for beef and three cheese, ranch for buffalo, lemon berry mascarpone for gooey butter.
  - Small clear cup for a 6 or a split side, large black ramekin for a 10. Both get lids.
  - Marinara is ladled from a well on the other side of the fryers. Small ranch cups are pre-made each morning; a large ranch is filled to order.
- **The cold table.** A shoulder-width lift lid over a cold table with eight clear quarter pans, 2 deep by 4 across. Back middle: ranch and Caesar. Front middle: pre-made cups of ranch and Caesar. Far right front: powdered Parmesan. Far right back: chopped parsley. A white plastic cutting board strip runs between you and the pans.
- **Dress.** A handful of Parmesan over everything, then a handful of parsley.
- **Gooey butter** gets powdered sugar, gets flipped, gets sugared on the other side, then goes in with the mascarpone.
- **Close** the lid on the two tabs and send it.
- Salads (Caesar) are also the fryer person's job. Maybe later.

**Build order from here:**
1. Real tickets: multi-item, split orders, graded flavor penalties.
2. Multi-basket freezer: select on the station, steer each basket with its own finger, pick out strays, leave baskets behind.
3. Subtle filling tints.
4. The expo microgame, in the order above.

## 13f. Scoring: Matt's money and the restaurant's reputation (2026-11-06)

Two meters, both real (supersedes the points in section 6 for the shift build):

- **Money** is the shift's take, at menu prices:
  - **Prices:** savory 6 for $12.50, 10 for $20.80; gooey butter 1 for $3.65, 3 for $10.50. A box that goes out earns its item price. When the whole ticket is out, the customer tips on the ticket total: more for fast, more for a clean streak, half for anything sloppy.
  - **Lost product is Matt's money.** Every rav on the floor, in the oil, in the trash (a box sent back), picked out cooked, or given away (strays and extras) costs what the customer would have paid for it: a beef is about $2.08, a gooey $3.65. Matt notices.
- **Reputation** is the restaurant's stars, and it's the fail state. Start at 4.
  - Fast clean tickets raise it. Slow tickets, strays, greasy or uneven ravs, boxes sent back, wrong orders and expired tickets lower it.
  - At 1 star Matt sends you home.
- **Clock-out:** what you made Matt, your best shift, Matt's money on the floor, and the stars you left him.
- **Next:** presentation (the plating patterns, wax paper, sauce, dress) feeds both. A beautiful box tips better and earns reputation. That's the expo microgame.

All numbers in `src/config/money.ts`.

## 13g. Plating: pour, salt, box (Dan, 2026-11-06)

- **Timing is forgiving.** A few seconds past the timer is fine; on the line the window runs about 15 real seconds. Past it the ravs **burst** (filling out the seam), they don't burn. Overdone ravs just get darker brown, never gray or black. Every flavor fails by bursting.
- **Pour, don't toss.** Drop a drained basket on the salt bowl and you're at the pass. Bring the basket over the bowl (one thumb) and it dumps on its own, near corner first; the other thumb can hold the bowl and meet it. Two hands, one motion, like the line.
- **Salt and toss.** Drag the shaker over the bowl and shake it (down-up strokes, or taps). Grab the bowl by its lip and slide it side to side to toss. Both together salt the bowl; the bowl's tag counts it down.
- **Box them two ways.** Pick ravs out of the bowl one at a time and set them in a box, or carry the bowl down to a box and dump it, then rearrange. Both are allowed on purpose: it's a physics toy and players should find their own way.
- **Dessert skips the salt.** Gooey butter goes from the basket straight into its box with tongs (tap and drag one at a time). Salted dessert is a complaint.
- **The metal table** holds the boxes, the prepped ones from expo plus a plain box for whatever you're plating if you didn't prep one. Swipe a box up by its wall, or hit SERVE on its tag.
- Salt is a presentation point (with size, wax paper, label, and sauce).

## 14. Open decisions (answer when they come up, not before)

- Three fryer rows on one screen vs. swipe gallery. Test on a phone.
- Does the top basket in a stack fully block the bottom, or just slow it?
- Do rejected ravs get re-fired automatically (new basket, same ticket) or does the ticket just stay on the rail?
- Multi-line tickets: must both lines serve together, or line by line?
- How much 420 is the right amount of 420. Start with the title and Smoke Break and see how it reads.
- When to tell Matt and Brittany. Current plan: when MVP-2 is playable on a phone.
