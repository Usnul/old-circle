# Architecture and current limits

## Ownership

Meep supplies ECS storage, physics, BVHs, navigation, rendering, particles, audio, serialization and networking. `Actor` is gameplay data, not an object hierarchy. `Transform64`, `RigidBody` and `Collider` hold spatial state. Actor string IDs are stable across server snapshots; Meep entity IDs are local to each dataset. The presentation dataset is separate from simulation so rendering cannot author damage or progression.

`GameWorld` is the shared 60 Hz simulation used by the server and browser Worker. The main thread renders and sends intent. A 30 Hz `SharedSession` advances two physics steps per network tick. Meep `NetworkSession`, `SimAction`, action history and authoritative reconciliation implement connected prediction and replay.

The simulation projects into `WorldFrame` and owned `CharacterFrame` components in a replication dataset. `FrameAdapter` writes lossless Meep LZ4 blocks with decoded and encoded lengths inside the engine's binary component protocol. This keeps patrol-rich initial snapshots below Meep's current 64 KiB fragment receiver limit (MEEP-007), without changing simulated floating-point values. Subsequent `WorldPatchAction` records carry changed actor/projectile fields, arrivals, removals and effects; Meep keeps the complete prior state in its local rollback history. After host rollback, the first fresh frame carries a complete corrected world: deltas against rewritten history alone would leave already-received enemy health or inventory stale. Patches ignore history older than initial sync and reject missing baselines, letting the Worker continue locally and reconnect rather than apply an incomplete world. `WorldFrame` still includes all actors and projectiles, so player/content growth requires per-peer scopes. Physics contact caches are reconstructed rather than serialized. Meep's InterpolationLog, PoseInterpolationAdapter and transform codec drive characters, corpses and the camera from one presentation timeline. GPU skinning and CPU combat sockets evaluate the same Blender animation clips.

## Connection lifecycle

The Worker stamps presentation snapshots with their simulation frame and an authority epoch. Meep's `RenderPlayout` and `AdaptiveRenderDelay` advance a continuous playhead with a bounded two-to-four-frame buffer, so uneven message arrival does not directly change walking speed. Bodies, weapons, ragdolls and the camera sample that same timeline. Authority changes reset the timeline instead of blending unrelated world clocks.

1. The Worker starts the local Meep world immediately, using its saved character if available.
2. A small JSON handshake identifies the protocol, player and returning character. The server validates shape and finite values and trusts the character's progression, as specified by the game design. It never imports the client's world snapshot.
3. The server allocates a peer and a fresh network ID. After the client's session is ready, a second character snapshot covers movement during initialization. Meep's `WebSocketTransport` takes over binary traffic.
4. Server-authored presence actions record arrivals, departures and character imports in Meep's action history. This matters: unrecorded between-tick mutations can be overwritten when late input causes replay.
5. The client acknowledges its installed initial snapshot through a Meep reliable command. The server then starts its scoped action stream from that frame, avoiding a race with older world history. Both peers acknowledge large packet bursts before they overflow the channel's 32-bit acknowledgement window.
6. The client transmits only its owned character's actions/state. Prediction borrows the Worker's already-running `GameWorld`; connection setup does not rebuild terrain or static colliders. It replays the character and nearby collisions, suspending distant bodies through Meep and leaving enemy decisions to the host. The replication session owns its network dataset, and stopping it leaves local physics running.
7. On socket loss, or after one second without authoritative advancement following a five-second initial synchronization grace period, the warm local simulation resumes full authority. Connection attempts resume every five seconds. Rejoining carries the current character, including velocity, crouch, mantle and attack/animation phases; the authoritative world replaces local enemies, objects, projectiles and clock.

Retired replication rows remain allocated for more than the 64-frame history window. Reusing a local entity ID too early lets prior-byte restoration target a different character. Player network IDs increase for the life of a server process. Peer IDs are released after Meep handles transport disconnection.

`GameSocketTransport` subclasses Meep's WebSocket adapter and copies outgoing packet bytes before handing them to the socket. Node `ws` can retain queued byte views after `send` returns, while Meep immediately reuses its packet scratch buffer. The copy preserves packet ownership without replacing Meep's protocol. MEEP-004 records the reproduction and the transport regression test.

World snapshots retain up to 1.5 seconds / 256 effects so a presentation frame cannot miss a one-tick spell event. The owned character also presents predicted nova events immediately. Stable nova action IDs deduplicate predicted and confirmed effects in the Worker; presentation consumes each delivered snapshot once, including when its authoritative tick has not advanced. This bounded history is a baseline, not a durable event log for large encounters.

The server supports one active socket per character. Browser tabs in the same profile share the character ID; use distinct profiles for different players. There is no account authentication or cross-device character service. This is a local development server, not a public identity/security boundary.

## Combat and progression

Supported characters cancel gravity and follow the contact plane through their Meep rigid-body velocity. Ground adhesion accounts for capsule curvature on slopes, settling to contact without pushing downhill. Character colliders have zero friction: motor braking holds a resting character, while surface friction would otherwise oppose the commanded walking speed. Knockback and airborne motion retain dynamic physics.

Melee's shared `weaponPose` matches the Blender blade pivots. Meep sphere sweeps test the blade and sampled travel between ticks, with a per-swing victim set. A hound uses a short muzzle segment. Projectiles sweep their travelled distance; arrows have gravity. Nova uses a Meep sphere overlap followed by line-of-sight tests and shows its radius with particles and a ring. Knockback is a Meep impulse, with temporarily reduced movement control.

The engine's current public shape-cast implementation cannot sweep against concave heightfields. The game adapter uses seven parallel Meep rays for those targets. This is an approximation, recorded in MEEP_DEFECTS.md. Neither capsule actors nor sampled blade sweeps are per-triangle anatomical collision.

Boss progress resets only when no living player remains near the encounter home. Living players within reward range share boss rewards and seals. Normal enemies respawn after three minutes and bosses after twenty minutes, provided no living player is nearby. Starting origins only set inventory and attributes. Weapons have ownership, arrow costs and resource costs. Armor has no mechanical differentiation yet.

## Persistence and versions

The server writes a Meep `BinaryBuffer` containing disk-save version 1 and the world payload, then atomically renames the temporary file. Disk-save versions are independent of network protocol 2, which introduced LZ4 component framing. Restart restores NPC and world state; disconnected players are not resurrected. Browser saves contain only the character allowlist. `contentVersion` migrates older elevations by lifting positions and checkpoints above raised terrain. New optional character fields have explicit import defaults. Add a migration before changing a released schema.

## Performance and remaining work

The current build loads its full landscape. The 2 m navigation surface is baked into a binary asset; bounded Meep NavMesh tiles are prepared for enemy homes during loading, with no collision rasterization inside simulation ticks. Whole-world replication and repeated snapshot cloning remain development baselines. A production world needs streamed chunks, authored navigation for stacked interiors, per-actor network scopes, packed schemas, bounded event streams, persistent identity and measured player-count budgets.

The renderer uses native meshlets/BVHs, clustered lighting, GPU particle graphs, volumetric media and the native environment background. Meep's Hosek sky supplies 64 HDR environments prepared during loading, so changing the clock does not run atmosphere sampling loops during movement. A directional light follows the sun or opposing moon. Meep's histogram-based automatic exposure remains enabled and adapts between outdoor light, night and interiors; the lantern and regional lights provide local contrast. Geometry, weighted skins and animation clips are authored in Blender and converted at build time. Meep skeletal animation drives full-body locomotion and attacks; a separate Meep physics world handles jointed corpses. A Meep behavior tree drives enemy patrols and awareness. Fluid-driven wind, trails, decals, texture compression and baked acoustic probes are not integrated yet. Sopra plays positional events and ambience; acoustic pathing is not enabled.

The current transport is reliable WebSocket for local development. Meep itself cautions against it for latency-sensitive state because of TCP head-of-line blocking. Move the same session protocol to Meep's WebTransport or WebRTC transport for internet play. The local authority currently calls the shared simulation directly inside the Worker; it does not run a second network session over MessagePort.

## Verification

Vitest checks physics locomotion, crouch clearance, melee range and duplicate hits, projectile tunneling/cover, nova cover/range, knockback, mutual PvP, boss reset, inventory saves, character-only world replacement, SH coefficients, Meep loopback prediction and real WebSocket disconnect/reconnect/server persistence. Real-clock network tests run sequentially so CPU-heavy rollback tests cannot starve their connection deadlines.

`world:check` builds a Meep NavigationMesh and exits unsuccessfully if a designed road has no sampled path. Browser workshop captures are separate visual evidence: the navigation report cannot judge artistic quality. No large-population, prolonged offline, high-latency, GPU-memory or cross-browser soak test has yet established production limits.
