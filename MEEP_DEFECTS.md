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
