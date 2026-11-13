# Breachpoint

An original round-based tactical team shooter that runs in the browser, with
online multiplayer and bots. Attackers try to plant a demolition charge on one
of two sites; defenders stop them or defuse it.

- **Server** – Rust (`axum` + `tokio`). Authoritative simulation at 60 Hz,
  snapshots at 30 Hz over WebSocket, lag-compensated hit detection, bots.
- **Shared simulation** – `crates/sim`: map, collision, movement and the weapon
  table. Used natively by the server and compiled to WebAssembly
  (`crates/predict`) so the client predicts movement with the exact same code.
- **Client** – plain ES modules + three.js (vendored). All textures, models and
  sounds are generated procedurally; there are no art or audio assets.

## Run

```sh
cargo run --release -p server      # then open http://localhost:8080
```

Everyone who opens the same address joins the same match. Empty seats are
filled with bots; a joining player replaces a bot.

**Play online with friends:** see [DEPLOY.md](DEPLOY.md) for the ready-to-use
Render setup and other hosting options. Players need no account. The menu's
**Copy invite link** button shares the server address. Use a desktop browser
with a keyboard and mouse.

| Variable     | Default       | Meaning                              |
|--------------|---------------|--------------------------------------|
| `PORT`       | `8080`        | HTTP / WebSocket port                |
| `TEAM_SIZE`  | `5`           | Players per team (bots fill the rest)|
| `CLIENT_DIR` | `./client`    | Directory with the web client        |

To play over the internet, run the server on a host with a public address (put
it behind an HTTPS reverse proxy; the client switches to `wss://` on its own).

A `Dockerfile` is included for container hosts (Fly.io, Railway, Render, a VPS):

```sh
docker build -t breachpoint . && docker run -p 8080:8080 breachpoint
```

The host must support WebSockets and keep a single long-running instance
(the match lives in memory).

The Docker build compiles both the server and prediction WASM from the same
source using Rust 1.99.1 and the lockfile, then runs as a non-root user.
`GET /healthz` returns `ok`. Test a deployed server with Node.js 22+:

```sh
node scripts/smoke.mjs https://your-game-host
```

After changing `crates/sim` or `crates/predict`, run `./build-wasm.sh` to
refresh `client/predict.wasm`. Tests: `cargo test`.

## Game

- Four operations with protected spawns, multiple approaches and two bomb sites:
  **Sirocco**, the expanded desert town; **Dockyard**, the original container
  terminal with wider quays; **Norheim**, an office operation based on the actual
  Kontor Norheim model; and **Meridian**, a cargo ship with side decks, cargo
  aisles and a bridge. Norheim adapts the showroom, atrium, office rows, meeting
  room and warehouse into a spacious, single-floor playable layout.
- The first player chooses the map before joining. The host can switch maps
  through **Esc → Operation → Start selected map**. This starts a new match for
  everyone, resetting scores and equipment while keeping connected players,
  teams and bot difficulty. Other players see the active map and join it.
- Spawn courtyards block direct and wall-penetrating shots from opposing spawns,
  including jumping sightlines. Bots can reach both objectives on every map.
- Detailed procedural weapons and operators, articulated equipment, warm desert
  lighting, and architectural scenery. No external model downloads are needed.
- 30 rounds: sides swap at half-time after 15, first team to 16 wins.
- Fixed spray patterns, bullet penetration through thin cover, fall damage,
  slow-down when hit, hold-to-aim iron sights and optics, knife slash / stab / backstab.
- 28 firearms (pistols, four akimbo pairs, shotguns, SMGs, rifles, scoped rifles, snipers, LMG),
  knife, frag / flash / smoke grenades, armour, helmet and defuse kit.
- Economy with kill rewards and round win / loss bonuses. The CS-inspired buy
  menu has six categories, weapon illustrations, prices and statistics, a budget
  and loadout overview, and a buy timer. Owned items, grenade limits and
  unaffordable purchases are clearly marked. The menu stays open after a buy;
  clicking an item or its number buys it, **0** goes back, and **B** closes it.
- Bot difficulty: **Easy**, **Medium** (default), **Hard**, and **Expert** change
  reactions, aiming, firing rhythm and combat movement. The first human player
  chooses the shared level before joining; the match host can change it live
  from the **Esc** pause menu (or **F2**). It affects bots on both teams. Host
  control transfers to the next player when the host leaves, and the level is
  retained between rounds.
- **Esc pause menu:** resume play, choose a map, adjust bot difficulty, restart
  the current round, or skip the remaining bot fight. The online match keeps
  running while the menu is open. The host controls maps, difficulty and round
  restarts. Restarting restores the round's starting money, equipment and stats
  without changing the score. Once all humans are dead, any joined spectator
  can fast-forward the bots to their actual result and the next round; scoring,
  side swaps and match completion follow the normal rules.
- Weapon drops and pick-ups, spectating while dead, radar, scoreboard, chat.
- Four akimbo options: **Twin Kestrels** and **Twin Mammoths** under Pistols;
  **Dual MP7** under SMGs ($2,600, 40 rounds per hand); and **Twin Lever-Action**
  under Heavy ($2,400, 5 shells per hand). The new pairs occupy the primary slot,
  leaving room for a sidearm. Hold either mouse button for automatic MP7 fire;
  click to fire each lever-action shotgun, which cycles independently after a
  shot. Left mouse controls the left gun, right mouse controls the right, and
  both can fire together. Akimbo never aims down sights. The HUD shows each
  hand's ammunition; reload fills both guns from their shared reserve. The
  lever-action pair uses detailed short M1887-style receivers, cut-down walnut
  grips, large lever loops and animated rolling breeches.
- **Equipment → Red Dot / ACOG:** buy a 1.5× red dot ($500) or 4× ACOG ($1,200)
  for the gun currently held. Single pistols accept the red dot; single shotguns,
  SMGs, rifles and machine guns accept either. Akimbo weapons and fixed-scope
  snipers cannot mount these attachments. Optics stay on their individual gun
  when switching slots, surviving a round, dropping it or picking it up. Buying
  a different optic replaces the existing one at full price.
- **Titan .50:** a slow bolt-action sniper in Rifles ($6,200), with a 12× scope,
  five-round magazine, 2.3 seconds between shots and a 4.8-second reload. Direct
  center-body damage is 110 within 20 m, decreases smoothly to 94 at 50 m and
  stays at 94 beyond that, including against armor. Headshots remain lethal
  through helmets at every range; legs do less damage. Normal walls and cover
  still stop or reduce shots. Its bolt cycle briefly lowers the scope.
- **Kar98k:** an affordable bolt-action rifle in Rifles ($1,500), with a walnut
  stock, iron sights, five-round internal magazine and 1.8 seconds between shots.
  It is accurate when stationary, retains damage at long range, and accepts the
  Red Dot and ACOG from Equipment. Reloading takes 3.8 seconds.
- **P9S** is the renamed Kestrel 9 starter pistol; **QK-9mm** is the renamed
  Cricket SD, the least expensive SMG. Their prices and weapon stats are unchanged.

## Controls

| Key                 | Action                                        |
|---------------------|-----------------------------------------------|
| WASD / Space        | Move / jump                                   |
| C or Ctrl / Shift   | Crouch / walk                                 |
| Mouse 1 / Mouse 2   | Fire, plant / hold to aim, knife stab         |
| Mouse 1 / Mouse 2 (akimbo) | Left gun / right gun; no aiming  |
| R / E / G           | Reload / defuse / drop weapon                 |
| Esc / F2            | Pause menu: map, difficulty and round controls |
| B                   | Buy menu (number keys or click)               |
| Q                   | Hold: weapon wheel · tap: last weapon         |
| 1–5, mouse wheel    | Primary, sidearm, knife, grenades, charge     |
| Tab / T             | Scoreboard / chat                             |

## Layout

```
crates/sim      shared simulation (map, physics, weapons)
crates/server   game server, rules, bots, navigation
crates/predict  wasm wrapper around sim's movement step
client          web client (index.html, js/, vendor/three)
```

For a local functional check of ADS, akimbo input and the new map, run
`node scripts/features-smoke.mjs http://127.0.0.1:8082` against a fresh local
server on port 8082. This test joins temporary guest players and fires weapons;
run it on a development server rather than during a match with friends.

`node scripts/difficulty-smoke.mjs http://127.0.0.1:8086` checks difficulty
selection, synchronization, guest permissions and host transfer on an idle
development server. It temporarily changes the shared bot level.

`node scripts/maps-smoke.mjs http://127.0.0.1:8088` checks map switching,
permissions, multiplayer synchronization and matching WASM collision on a
fresh development server. It changes the shared map and resets matches.

`node scripts/optics-smoke.mjs http://127.0.0.1:8093` checks optic purchases,
compatibility, aiming speed and attachment preservation through drop/pickup on
an idle development server. Titan damage and bolt-cycle regressions run with
`cargo test -p server`.

`node scripts/rounds-smoke.mjs http://127.0.0.1:8098` checks pause-menu round
permissions, restart rollback, stale input rejection and actual bot-only skips
on a fresh development server. It restarts rounds and uses grenades to eliminate
the test players before skipping; normal scoring and respawn are verified.
