# Meep defects encountered by Old Circle

Engine source remains read-only. Runtime is pinned to the published `@woosh/meep-engine@3.20.0`. Findings below were reproduced against that package on Node 24 / Windows, 2026-09-10. Local source at `H:\git\CompanyNamed\meep` may contain unpublished changes despite sharing the version number.

## MEEP-001 — shapeCast quaternion contract disagrees with implementation

**Confirmed.** `src/engine/physics/ecs/PhysicsSystem.js` documents `shapeCast` rotation as `{x,y,z,w}`. `src/engine/physics/queries/shape_cast.js` reads `rotation[0..3]` instead. An identity object produces NaN bounds and silently misses a capsule directly in front of a ray; `[0,0,0,1]` permits the hit. The same mismatch exists in the inspected local source.

Reproduction: create a capsule at `(100,4.294,28.5)`, sweep a radius `.11` sphere from `(100,4.444,29.7)` along `(0,0,-1)` for `2.35` metres. Pass `{x:0,y:0,z:0,w:1}`. A raycast finds the capsule; the sphere cast misses. Repeat with an indexed quaternion.

Game workaround: indexed quaternion in `sphere-sweep.mjs`; `setPose` still needs the documented object form. Suggested engine change: make the public types, assertions and implementation agree.

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

**Source verified in the published package.** `src/shade/renderer/animation/GPUAnimationManager.js:unregister_skin` removes the skin and joint-block records, but retains its reserved matrix range. The method's documentation explicitly states that repeated registration/unregistration accumulates wasted slots. A persistent game's repeated deaths and respawns would keep advancing this allocation even with a fixed number of visible characters.

Game workaround: retain registered character instances in a pool, parked outside the world when unused, and restore their materials, animation component and joint authority when reused. Allocation follows peak simultaneous instances of each appearance rather than total respawns. Pooled skins still retain their GPU resources. Suggested engine change: reclaim ranges with a free-list allocator, or provide a supported suspension/reuse lifecycle that also skips inactive skinning work.

## MEEP-006 — simplex-noise module emits invalid pure-annotation warnings

**Confirmed during the Vite 6.4.3 production build. Low severity.** `src/core/math/noise/create_simplex_noise_2d.js` has `#__PURE__` annotations on numeric/arithmetic expressions and in an explanatory comment (lines 5, 7, 8, 11 and 12). Rollup warns that each annotation is in an unsupported position and removes it. Importing the noise function in both the client and Worker repeats the warnings; the build still succeeds. Suggested engine change: remove annotations from constants and avoid spelling the annotation marker in an ordinary prose comment. No game workaround or engine-file modification is necessary.

## MEEP-007 — default fragment receiver silently rejects messages the sender accepts

**Confirmed against the published package.** `transport/fragments/packet_size.js` permits logical messages up to `1186 * 255 = 302430` bytes. `orchestrator/NetworkPeer.js:connect_peer` creates its `FragmentAssembler` without overriding the default `max_message_size = 65536`. Messages in the gap are sent and their fragments acknowledged, but `FragmentAssembler.receive` discards an assembly when its accumulated size crosses 65536. It returns null without notifying `onMalformedPacket`. NetworkSession does not expose the receiver limit as an option.

Reproduction: an Old Circle persisted world with 49 actors and patrol paths serialized to 71,561 bytes. A fresh Node client connected to the running server, received about 18 MB/s of packets over five seconds, and never received `onInitialSync` or a malformed-packet event; no world or character entities were created. The production browser similarly timed out waiting for authoritative updates. A newly populated world stayed below the limit, hiding this from the original integration test.

Game workaround: Meep LZ4 blocks in the gameplay binary adapters, preserving exact state while removing repeated JSON field names and actor data. The socket regression includes a populated patrol snapshot above 64 KiB before compression. This contains the current content payload; it is not a substitute for scoped actor replication as player/content counts grow. Suggested engine change: align the default send/receive limits, expose a shared configuration, and report oversize rejection rather than silently accepting unassemblable traffic.

## MEEP-008 — action history is flushed before the initial snapshot

**Source verified in the published package.** `orchestrator/ServerAuthoritativeServer.js:538–539` calls `peer.flush_outbound(sim_frame)` before `onTickComplete.send1(sim_frame)`. `NetworkSession.js:1538` sends queued INITIAL_SYNC messages from that completion handler, despite its comment promising initial sync before the action stream. A newly joined peer can therefore receive and apply retained history before its initial world and frame baseline exist.

Game workaround: the host excludes the new recipient from action scope until the client acknowledges the initial frame it installed through a Meep reliable command. That acknowledgement also sets the recipient's replication baseline. The loopback regression warms the host for 90 ticks before connecting and verifies that no frame is applied before initial sync. Suggested engine change: order initial snapshot delivery before history flushing and gate dependent action application until that snapshot is installed, including when a transport reorders messages.

## MEEP-009 — convex contact direction assumes the body origin lies inside its hull

**Reproduced and source verified.** A Blender ramp exported with world-space vertices under a body at the origin raycasts correctly, but pushes a walking capsule beneath its top. Translating the same vertices into a body centred on their bounds fixes the traversal without changing the world geometry. `narrowphase/narrowphase_step.js:1307–1318` flips EPA's contact direction using the vector between body transforms. Its comment assumes each origin is inside the geometry; `ConvexHullShape3D.from` documents convexity and outward winding but does not state that origin requirement.

Reproduction: the reliquary entrance prism spans X 36–40, Z −38 to −48, top Y 2.91159 to 4.3, with a .30 m thickness. Place its hull under a static body at `(0,0,0)`, settle a capsule at `(38,3.78659,−38)` and walk north. In the observed run the character was expelled west and stalled beneath the ramp near `(36.55,3.19,−44.16)`. Re-centering the hull and translating its body preserves every world-space vertex and permits the complete route. The retained dungeon motor test covers the game's adapter.

Game workaround: centre every authored static convex body on its own bounds. Suggested engine change: derive direction validation from transformed geometric interior points, or make the shape-origin constraint explicit and validate it.

## MEEP-010 — some reachable folded navigation queries return no path

**Reproduced on the reliquary's baked surface.** The mesh passes `bt_mesh_validate` and `bt_mesh_is_manifold`; `bt_mesh_split_pinched_vertices` reports zero repairs. `NavigationMesh.find_path` nevertheless returns zero from `(38,4.3,−61)` to `(38,9.1,−66)`. Starting one metre north or south succeeds. Both endpoints are connected: native paths composed through the burial room, ascent and gallery succeed, and the physical character traverses those legs. The precise Polyanya failure has not been isolated to a smaller mesh.

Game workaround: a failed long query is split at authored room connections, selected by Meep's graph search. Each resulting leg still uses the native navmesh. The actual enemy-pursuit regression starts with a player directly above an enemy and requires the enemy to walk the connecting rooms and reach that player. Suggested engine investigation: reproduce with `content/dungeon-navigation.bin` and inspect the interval search around the lower chapter's west exit.

## MEEP-011 — initial synchronization bypasses the configured action scope

**Source verified and covered by a two-peer integration test.** `NetworkSession.#send_initial_sync_to` passes every entry in its entity-listener map to `snapshotter_emit`; it does not consult the configured scope filter. The filter only excludes subsequent actions. A host-only rollback frame or another recipient's world projection therefore reaches every new peer if the game relies on action scope alone.

Game workaround: adapt the public `NetworkPeer.send_initial_sync` hook, invoking the native snapshot emitter with exactly the recipient's WorldFrame and owned CharacterFrame. Native framing, acknowledgement and initial application remain unchanged. A regression verifies that two distant clients do not receive the host-only world ID, each other's character rows or distant actors, then verifies arrivals and removals when they meet. Suggested engine change: expose an initial entity-scope predicate distinct from owner-aware action filtering; clients still need their own entity's authoritative initial state even when their predicted actions are excluded from the echo stream.
