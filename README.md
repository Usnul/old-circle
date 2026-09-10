# Old Circle

An original dark fantasy action RPG built on **Meep 3.20.0**. This repository contains an early playable vertical slice and a reproducible content pipeline. It is not yet the finished open-world game or the final visual-quality benchmark.

![Old Circle concept and title-screen artwork](packages/client/public/assets/art/old-circle-concept.png)

## Run

Requires Node 24+, pnpm 11, and a desktop browser with WebGPU. Shipped assets are already built; Blender and the inference models are needed only for authoring.

```powershell
pnpm install --frozen-lockfile
pnpm server                  # terminal 1: authoritative world, port 8787
pnpm dev                     # terminal 2: client, port 5188
```

Open **http://127.0.0.1:5188**. Without the server the Worker continues a solo world and retries the connection. The development proxy forwards `/multiplayer` to port 8787. Separate browser profiles provide separate characters.

```powershell
pnpm test
pnpm world:check
pnpm build
pnpm server                  # serves the built client at http://127.0.0.1:8787
```

The production host defaults to loopback. `HOST`, `PORT` and `OLD_CIRCLE_DATA_DIR` configure it. A remote deployment needs HTTPS/WSS for WebGPU and a secure browser context. Public hosting, authentication and operational deployment are not configured here.

## Play

WASD walks, Shift sprints, C crouches, Space jumps and grabs nearby ledges. Keep Space held to climb; release it to hang, then press Space to climb or C to drop. Mouse looks; left click attacks; Q casts frost nova; R drinks a flask; E rests at the opening hearth. Keys 1–4 select owned weapons. Tab opens attributes, equipment information, saving and the PvP toggle; M opens the map. Escape releases the mouse and opens the journal. The journal pauses solo simulation; the shared world keeps running.

Choose a starting inventory and stat distribution, find weapons on enemies, earn embers and improve attributes at the hearth. The Bellkeeper's Hollow offers an early magic weapon. Six regional bosses grant seals. Players can enter ongoing encounters. Damage between players requires both to enable PvP. A defeated player returns to their checkpoint after four seconds and loses 25% of carried embers.

## Included

- `packages/game`: shared Meep ECS/physics simulation, collision combat, progression, enemies, encounters, world layout, navigation/visibility sampling and Meep network sessions.
- `packages/client`: WebGPU presentation, GPU particles, clustered lights, shadows, fog, TAA/GTAO/bloom, native binary geometry, SCSS UI and a simulation Worker.
- `packages/server`: persistent Node simulation, Meep transport integration, atomic world saves and static hosting.
- `assets/blender` and `tools`: Blender source, native geometry/collider export, local FLUX icons, local Stable Audio sounds and world inspection tools.

The current world is about 480 × 640 metres, with six connected biome zones, an abbey, a traversable rock hollow, five normal enemy archetypes and six boss variants. The bosses currently share a small move vocabulary. Armor is inventory metadata; there is no armor-item customization yet. Locomotion uses a capsule and procedural body-part animation with a Meep FABRIK weapon arm. Production skeletal animations remain to be built.

The connected baseline replicates full world snapshots through Meep's binary adapters. Prediction and replay work, including character-only reconnect, but this is **not a scalable MMO replication layout**. Per-actor interest management, packed component schemas and a datagram transport are required before large-player-count deployment. See [architecture](docs/ARCHITECTURE.md) for the precise authority model and limits.

## Develop

[Content workflow](docs/CONTENT_WORKFLOW.md) covers areas, enemies, geometry, sound, icons and checks. [Art and world direction](docs/DESIGN.md) defines the visual language and progression. [MEEP_DEFECTS.md](MEEP_DEFECTS.md) records verified engine integration findings. The local Meep checkout is read-only and is not linked as a writable package dependency.

Use **http://127.0.0.1:5188/?inspect=1** for the development-only world workshop. It runs offline, does not write the player's save, can visit landmarks, switch lighting, display occupancy/flow and save rendered compositions with metadata under `.local/captures`.

Character saves live in browser localStorage. The server saves `.local/server/world.meep` every 15 seconds and on graceful shutdown. `.local` contains generated, disposable or runtime data and is ignored by Git. Back up the server save directory separately when operating a persistent world.
