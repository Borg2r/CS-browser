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

After changing `crates/sim` or `crates/predict`, run `./build-wasm.sh` to
refresh `client/predict.wasm`. Tests: `cargo test`.

## Game

- Map **Dockyard**: a container terminal with two sites and three lanes.
- 30 rounds: sides swap at half-time after 15, first team to 16 wins.
- Fixed spray patterns, bullet penetration through thin cover, fall damage,
  slow-down when hit, two-level sniper zoom, knife slash / stab / backstab.
- 22 firearms (pistols, shotguns, SMGs, rifles, scoped rifles, snipers, LMG),
  knife, frag / flash / smoke grenades, armour, helmet and defuse kit.
- Economy with kill rewards, round win / loss bonuses and a buy menu.
- Weapon drops and pick-ups, spectating while dead, radar, scoreboard, chat.

## Controls

| Key                 | Action                                        |
|---------------------|-----------------------------------------------|
| WASD / Space        | Move / jump                                   |
| C or Ctrl / Shift   | Crouch / walk                                 |
| Mouse 1 / Mouse 2   | Fire, plant / scope, knife stab               |
| R / E / G           | Reload / defuse / drop weapon                 |
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
