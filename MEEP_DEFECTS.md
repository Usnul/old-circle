# Meep defects encountered by Old Circle

Engine source remains read-only. Runtime is pinned to the published `@woosh/meep-engine@3.22.0`. Original findings below concern 3.20.0 on Node 24 / Windows, 2026-09-10; entries explicitly identify subsequent verification against 3.22.0. Tests use the published dependency, not a linked engine checkout.

## MEEP-001 — shapeCast quaternion contract disagrees with implementation

**Confirmed.** `src/engine/physics/ecs/PhysicsSystem.js` documents `shapeCast` rotation as `{x,y,z,w}`. `src/engine/physics/queries/shape_cast.js` reads `rotation[0..3]` instead. An identity object produces NaN bounds and silently misses a capsule directly in front of a ray; `[0,0,0,1]` permits the hit. The same mismatch exists in the inspected local source.

Reproduction: create a capsule at `(100,4.294,28.5)`, sweep a radius `.11` sphere from `(100,4.444,29.7)` along `(0,0,-1)` for `2.35` metres. Pass `{x:0,y:0,z:0,w:1}`. A raycast finds the capsule; the sphere cast misses. Repeat with an indexed quaternion.

**Contract corrected in 3.22.0 (source verified).** `shapeCast` now documents an indexed quaternion. `setPose` also takes indexed positions and quaternions; Old Circle's teleport, mantle, crouch and ragdoll calls use that contract. Rigid-body vectors and joint anchors/bases are now typed arrays, so writes use `set(array)` rather than scalar setters or `copy`. The simulation, ragdoll and network regressions pass against 3.22.0.

## MEEP-002 — shapeCast throws when a heightfield enters its broadphase

**Confirmed.** The public sweep documentation describes first-contact tests against collider surfaces without a convex-target restriction. The implementation passes every candidate to GJK, including `HeightMapShape3D`. Its `support` throws: `heightmaps are non-convex; the narrowphase must dispatch grid-traversal instead.` A sword swing above the opening terrain reproduces this, even when the intended hit is another actor. Internal comments acknowledge the missing concave dispatch; the public contract does not.

Reproduction: `GameWorld.start({populate:false})`, spawn two actors 1.5 metres apart at the heightfield surface, call a sphere sweep with an indexed identity quaternion. Stack: `HeightMapShape3D.support → PosedShape3D.support → gjk → shape_cast → PhysicsSystem.shapeCast`.

Game workaround: Meep sphere casts for convex targets, seven Meep surface rays for concave targets. This approximates thickness at concave edges; it is not an exact concave sweep. The melee and projectile regression tests exercise the adapter. Suggested engine change: BVH-pruned triangle dispatch, preserving nearest time of impact and contact normals.

## MEEP-003 — graphics3 ShadedGeometrySystem does not consume component flags

**Source verified in the published package.** `ShadedGeometry` exposes `Visible`, `CastShadow` and `ReceiveShadow` flags. `src/engine/graphics3/ShadedGeometrySystem.js:link` copies geometry, material, name and transform into a Shade `Mesh`, but never reads these flags or observes them. The paired Shade mesh does not expose equivalent per-mesh shadow controls. Clearing the component flags therefore cannot provide the documented visibility/shadow behavior on this system.

Observed impact: an inward-facing sky enclosure darkened the landscape through shadow participation. Opening its roof restored afternoon sunlight, while low-angle sun remained obstructed by its sides. Old Circle now uses the renderer's native environment-background pass and no sky mesh. Visibility is controlled by adding/removing the presentation entity until the component flag bridge is available. This finding is limited to graphics3; it does not claim the older rendering system ignores these flags.

## MEEP-004 — WebSocketTransport passes reusable packet memory into Node ws

**Confirmed with Node 24.19 / ws 8.21.3.** Meep `Transport.send` permits callers to reuse their byte buffer immediately. `transport/adapters/WebSocketTransport.js:send` forwards a view of that buffer directly to `socket.send`. Browser WebSocket copies it, but Node ws can retain the view while writes queue. Meep reuses its fragment scratch memory; queued messages then contain later fragments instead of the original bytes.

Reproduction: on a local ws connection, send the same 65,536-byte Uint8Array 200 times, filling it with the message index before each send. Under a queued burst, 195 of 200 received messages were corrupted in the observed run (e.g. index 4 arrived filled with 199). The affected Meep adapter forwards this same view without a copy. Old Circle's integration test intermittently received tens of thousands of packets but no completed INITIAL_SYNC, despite no malformed-packet reports.

Game workaround: a subclass of Meep's adapter copies the requested byte range before calling `super.send`. The regression test uses a socket that retains references and verifies that reusing the caller's scratch buffer cannot alter queued messages. Suggested engine fix: honor the Transport ownership contract by copying, or document and implement a transport-specific send-completion ownership protocol. The ordinary browser adapter does not need asynchronous ws's zero-copy assumption.

## MEEP-005 — unregistering skins retains their matrix allocations

**Resolved in the published 3.22.0 package.** In 3.20.0, `src/shade/renderer/animation/GPUAnimationManager.js:unregister_skin` removed the skin and joint-block records but retained its reserved matrix range, advancing allocation with every respawn. In 3.22.0, freed ranges are reused by exact joint count. The package also releases clone meshlet allocations and previous-position slices, and checks table occupancy before repeated skin/clip unregister calls.

Verification: `packages/client/src/render/characters.test.mjs` drives the real Meep mesh/animation systems and software GPU device through eight spawn/death/teardown cycles using the pilgrim and hound rigs and one shipped geometry chunk per rig. Matrix and previous-position high-water marks stay at one simultaneous pair; occupied meshlet bytes return to the source-only baseline after each teardown. A second case verifies pooled respawns restore materials, joint authority and animation while keeping the BLAS buffer capacity flat.

The [upstream response](https://claude.ai/code/artifact/792fafe9-6a00-466c-9e24-cc9d8d766052) recommends retiring the pool. Old Circle retains it because the published package still accumulates per-instance BLAS node data on full teardown; see MEEP-009. The original matrix defect is closed, but the entire respawn allocation lifecycle is not yet bounded without pooling.

## MEEP-006 — simplex-noise module emits invalid pure-annotation warnings

**Confirmed during the Vite 6.4.3 production build. Low severity.** `src/core/math/noise/create_simplex_noise_2d.js` has `#__PURE__` annotations on numeric/arithmetic expressions and in an explanatory comment (lines 5, 7, 8, 11 and 12). Rollup warns that each annotation is in an unsupported position and removes it. Importing the noise function in both the client and Worker repeats the warnings; the build still succeeds. Suggested engine change: remove annotations from constants and avoid spelling the annotation marker in an ordinary prose comment. No game workaround or engine-file modification is necessary.

**Resolved in 3.22.0 (source and production build verified).** The numeric constants and prose no longer carry the annotation marker; valid annotations remain on constructor calls. The Old Circle build emits no simplex-noise annotation warnings.

## MEEP-007 — default fragment receiver silently rejects messages the sender accepts

**Confirmed against the published package.** `transport/fragments/packet_size.js` permits logical messages up to `1186 * 255 = 302430` bytes. `orchestrator/NetworkPeer.js:connect_peer` creates its `FragmentAssembler` without overriding the default `max_message_size = 65536`. Messages in the gap are sent and their fragments acknowledged, but `FragmentAssembler.receive` discards an assembly when its accumulated size crosses 65536. It returns null without notifying `onMalformedPacket`. NetworkSession does not expose the receiver limit as an option.

Reproduction: an Old Circle persisted world with 49 actors and patrol paths serialized to 71,561 bytes. A fresh Node client connected to the running server, received about 18 MB/s of packets over five seconds, and never received `onInitialSync` or a malformed-packet event; no world or character entities were created. The production browser similarly timed out waiting for authoritative updates. A newly populated world stayed below the limit, hiding this from the original integration test.

Game workaround: Meep LZ4 blocks in the gameplay binary adapters, preserving exact state while removing repeated JSON field names and actor data. The socket regression includes a populated patrol snapshot above 64 KiB before compression. This contains the current content payload; it is not a substitute for scoped actor replication as player/content counts grow. Suggested engine change: align the default send/receive limits, expose a shared configuration, and report oversize rejection rather than silently accepting unassemblable traffic.

## MEEP-008 — action history is flushed before the initial snapshot

**Source verified in the published package.** `orchestrator/ServerAuthoritativeServer.js:538–539` calls `peer.flush_outbound(sim_frame)` before `onTickComplete.send1(sim_frame)`. `NetworkSession.js:1538` sends queued INITIAL_SYNC messages from that completion handler, despite its comment promising initial sync before the action stream. A newly joined peer can therefore receive and apply retained history before its initial world and frame baseline exist.

Game workaround: the host excludes the new recipient from action scope until the client acknowledges the initial frame it installed through a Meep reliable command. That acknowledgement also sets the recipient's replication baseline. The loopback regression warms the host for 90 ticks before connecting and verifies that no frame is applied before initial sync. Suggested engine change: order initial snapshot delivery before history flushing and gate dependent action application until that snapshot is installed, including when a transport reorders messages.

## MEEP-009 — despawned geometry clones retain BLAS node data

**Confirmed against the published 3.22.0 package.** `GPUGeometryManager.remove_clone` releases meshlet allocations and calls `geometry/bvh/GPUGeometryBVHManager.js:remove`. The latter removes the owner record and lookup target but leaves its node bytes in an append-only GPU arena. `#upload_pending_nodes` appends each replacement clone's tree at `#buffer_data_end`; growing the buffer preserves the abandoned bytes. This residual scales with geometry size, beyond the small unrecycled geometry-id metadata rows acknowledged in the MEEP-005 response.

Reproduction: run the teardown case in `packages/client/src/render/characters.test.mjs`. With `pilgrim-0.meep` and `briarHound-0.meep`, the reported BLAS arena end advances by 79,808 bytes per subsequent cycle, from 159,648 after the first pair to 718,304 after the eighth. After each teardown there are no character entities or scene instances and occupied meshlet bytes are back at the source baseline. The paired pool case keeps BLAS buffer capacity flat.

Game workaround: retain the existing registered character pool, parked offstage, restoring materials, animation and joint authority on reuse. Suggested engine change: recycle per-clone BLAS node ranges, or compact and republish their addresses; ordinary buffer growth alone does not reclaim them.
