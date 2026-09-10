# Architecture and current limits

## Ownership

Meep supplies ECS storage, physics, BVHs, navigation, rendering, particles, audio, serialization and networking. `Actor` is gameplay data, not an object hierarchy. `Transform64`, `RigidBody` and `Collider` hold spatial state. Actor string IDs are stable across server snapshots; Meep entity IDs are local to each dataset. The presentation dataset is separate from simulation so rendering cannot author damage or progression.

`GameWorld` is the shared 60 Hz simulation used by the server and browser Worker. The main thread renders and sends intent. A 30 Hz `SharedSession` advances two physics steps per network tick. Meep `NetworkSession`, `SimAction`, action history and authoritative reconciliation implement connected prediction and replay.

The first implementation projects the simulation into `WorldFrame` and owned `CharacterFrame` components in a replication dataset. The adapters are versioned Meep binary adapters containing length-delimited JSON. `WorldFrame` includes all actors and projectiles. This makes authority replacement explicit, but repeated full-state serialization and rollback are expensive. Physics contact caches are reconstructed rather than serialized. Meep's InterpolationLog, PoseInterpolationAdapter and transform codec drive characters, corpses and the camera from one presentation timeline. GPU skinning and CPU combat sockets evaluate the same Blender animation clips.

## Connection lifecycle

1. The Worker starts the local Meep world immediately, using its saved character if available.
2. A small JSON handshake identifies the protocol, player and returning character. The server validates shape and finite values and trusts the character's progression, as specified by the game design. It never imports the client's world snapshot.
3. The server allocates a peer and a fresh network ID. After the client's session is ready, a second character snapshot covers movement during initialization. Meep's `WebSocketTransport` takes over binary traffic.
4. Server-authored presence actions record arrivals, departures and character imports in Meep's action history. This matters: unrecorded between-tick mutations can be overwritten when late input causes replay.
5. The client transmits only its owned character's actions/state. The Worker predicts the owned character, receives the authoritative world and keeps a local `GameWorld` warm from that presentation.
6. On socket loss, or after 3.5 seconds without authoritative advancement, the warm local simulation continues. Connection attempts resume every five seconds. Rejoining carries only the current character; the authoritative world replaces local enemies, objects, projectiles and clock.

Retired replication rows remain allocated for more than the 64-frame history window. Reusing a local entity ID too early lets prior-byte restoration target a different character. Player network IDs increase for the life of a server process. Peer IDs are released after Meep handles transport disconnection.

`GameSocketTransport` subclasses Meep's WebSocket adapter and copies outgoing packet bytes before handing them to the socket. Node `ws` can retain queued byte views after `send` returns, while Meep immediately reuses its packet scratch buffer. The copy preserves packet ownership without replacing Meep's protocol. MEEP-004 records the reproduction and the transport regression test.

World snapshots retain up to 1.5 seconds / 256 effects so a presentation frame cannot miss a one-tick spell event. The owned character also presents predicted nova events immediately. Stable nova action IDs deduplicate predicted and confirmed effects in the Worker; presentation consumes each delivered snapshot once, including when its authoritative tick has not advanced. This bounded history is a baseline, not a durable event log for large encounters.

The server supports one active socket per character. Browser tabs in the same profile share the character ID; use distinct profiles for different players. There is no account authentication or cross-device character service. This is a local development server, not a public identity/security boundary.

## Combat and progression

Melee's shared `weaponPose` matches the Blender blade pivots. Meep sphere sweeps test the blade and sampled travel between ticks, with a per-swing victim set. A hound uses a short muzzle segment. Projectiles sweep their travelled distance; arrows have gravity. Nova uses a Meep sphere overlap followed by line-of-sight tests and shows its radius with particles and a ring. Knockback is a Meep impulse, with temporarily reduced movement control.

The engine's current public shape-cast implementation cannot sweep against concave heightfields. The game adapter uses seven parallel Meep rays for those targets. This is an approximation, recorded in MEEP_DEFECTS.md. Neither capsule actors nor sampled blade sweeps are per-triangle anatomical collision.

Boss progress resets only when no living player remains near the encounter home. Living players within reward range share boss rewards and seals. Normal enemies respawn after three minutes and bosses after twenty minutes, provided no living player is nearby. Starting origins only set inventory and attributes. Weapons have ownership, arrow costs and resource costs. Armor has no mechanical differentiation yet.

## Persistence and versions

The server writes a Meep `BinaryBuffer` containing the protocol version and world payload, then atomically renames the temporary file. Restart restores NPC and world state; disconnected players are not resurrected. Browser saves contain only the character allowlist. Neither save format currently has migrations beyond rejecting unsupported version numbers. Add a migration before changing a released schema. Do not silently reuse version 1 for incompatible changes.

## Performance and remaining work

The vertical slice loads its full landscape. The 2 m navigation raster, whole-world replication, repeated snapshot cloning and synchronous local navigation builds are development baselines. A production world needs streamed chunks, offline-authored multilayer navmesh tiles, per-actor network scopes, packed schemas, bounded event streams, persistent identity and measured player-count budgets.

The renderer uses native meshlets/BVHs, clustered lighting, GPU particle graphs, volumetric media and the native environment background. The panorama drives bounded cached day/night environment levels. Geometry is authored in Blender and converted at build time. Current rigid-part animation uses Meep FABRIK for the weapon arm but is temporary. Meep skeletal animation and attachment hierarchy should replace it before final character production. Behavior trees, fluid-driven wind, trails, decals, texture compression and baked acoustic probes are not integrated yet. Sopra plays positional events and ambience; acoustic pathing is not enabled.

The current transport is reliable WebSocket for local development. Meep itself cautions against it for latency-sensitive state because of TCP head-of-line blocking. Move the same session protocol to Meep's WebTransport or WebRTC transport for internet play. The local authority currently calls the shared simulation directly inside the Worker; it does not run a second network session over MessagePort.

## Verification

Vitest checks physics locomotion, crouch clearance, melee range and duplicate hits, projectile tunneling/cover, nova cover/range, knockback, mutual PvP, boss reset, inventory saves, character-only world replacement, SH coefficients, Meep loopback prediction and real WebSocket disconnect/reconnect/server persistence. Real-clock network tests run sequentially so CPU-heavy rollback tests cannot starve their connection deadlines.

`world:check` builds a Meep NavigationMesh and exits unsuccessfully if a designed road has no sampled path. Browser workshop captures are separate visual evidence: the navigation report cannot judge artistic quality. No large-population, prolonged offline, high-latency, GPU-memory or cross-browser soak test has yet established production limits.
