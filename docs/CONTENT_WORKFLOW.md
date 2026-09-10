# Authoring and verification

## One source of world truth

`packages/game/src/world/regions.mjs` defines coordinates, elevations, region centers, progression, landmarks and roads. Coordinates are metres, Y up, north along −Z. `layout.mjs` places native model instances and lights. Use stable IDs: changing IDs changes how saved worlds refer to content. Road control points become Meep Catmull–Rom samples shared by ground texturing, the map, placement clearance and occupancy/direction queries. Landform noise fades out over graded road beds; increasing relief must preserve route connectivity.

Increment `WORLD_VERSION` when an elevation edit requires saved positions to be rebased. Character import and server world restoration preserve progression while lifting older saved positions and checkpoints above raised terrain. This migration assumes interiors remain above the heightfield; a future underground terrain revision needs its own placement policy.

Server restoration also reconciles saved enemy homes against the current authored population. A moved encounter or a living NPC stranded beyond its combat leash returns to the authored home; health and death timers remain intact. Ordinary in-range patrol positions persist. Keep actor IDs stable when moving an encounter so this migration can identify it.

`HEARTHS` defines one return point per region, beside a graded approach road. Keep its stable ID, clear the campsite of collision, and keep enemy patrol homes at least 22 metres away. The arrival point stays on the road. Resting, respawning and improving attributes share the same safety rules offline and through Meep network actions: no living enemy within 14 metres, no attack or mantle in progress, and the character must stand beside the fire. Kindled hearth IDs and the selected return point travel with the character save.

`tools/export-world-layout.mjs` samples that definition into ignored `.local/blender/world.json`. Blender reads those samples for terrain elevation and road materials. Never copy the height function or road coordinates into Python. Physics uses the shared height function and exported Blender convex hulls. Visual props and physical props use the same instance transforms.

## Build 3D assets

```powershell
pnpm assets:blender
# Or select another Blender executable:
$env:BLENDER_PATH = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
pnpm assets:blender
```

This exports world samples, runs Blender in CPU-only background mode, saves `assets/blender/old-circle-kit.blend`, exports intermediate triangles/material groups to `.local/blender/meshes.json`, exports gameplay convex hulls to `packages/game/src/content/colliders.json`, then compiles geometry with Meep's `MeshletGeometrySerializationAdapter`. Shipped files in `packages/client/public/assets/geometry` contain native meshlets and BVHs. No runtime GLTF conversion is required.

The final build step bakes the collision-tested navigation surface into `packages/game/src/content/navigation.bin` using Meep's BinaryBuffer. Run `node tools/world-check.mjs bake` after changing terrain, roads or solid placement; the bake refuses blocked progression routes. Simulation loads this shared surface and prepares bounded Meep NavMesh tiles for enemy homes during loading. Pathfinding never reruns the terrain/clearance raster during a tick. Queries outside a tile fail explicitly; new roaming systems need a tile corridor or a higher-level route instead of an unbounded whole-world search.

The kit's source is `tools/blender/build_world.py`. Characters are authored separately by `tools/blender/build_characters.py` and saved in `assets/blender/old-circle-characters.blend`, with armatures, weighted meshes, skin modifiers and editable Actions. Each named asset is a collection; collections are hidden by default in the saved blends to keep the whole kit from overlapping. Unhide the collection you want to inspect. The saved blends are reviewable source artifacts, but the scripts are the regeneration source: direct blend edits are overwritten by a full build. To introduce hand-authored assets, add an explicit source-blend import/export step rather than relying on edits to generated collections.

Character export adds four joint indices/weights to native geometry and writes bind poses plus sampled action tracks to `packages/game/src/content/rigs.json`. Meep's `MeshSystem`, `AnimationSystem` and GPU skinning play those tracks; its CPU pose evaluator queries the same clip times for combat sockets. Keep `weapon` aligned along the blade, and edit damage windows or bow/cast release times in `WEAPONS` alongside the corresponding Blender action. `animation.test.mjs` verifies loop closure, planted support feet, normalized blends and visible blade endpoints. Gait phase travels with the simulated character so network corrections and offline continuation keep the same motion.

The export changes Blender `(x,y,z)` into Meep `(x,z,-y)`, including normals. An asset's origin is its placement pivot. Weapons point along local +Y in Meep; the authored blade intervals must stay consistent with `simulation/weapon-pose.mjs`. Trees collide through their trunks; masonry exports one convex hull per constituent piece; foliage does not block actors. Do not export an entire arch as one convex hull, which closes its doorway.

Textures, normal maps and the particle sprite are also authored in Blender. `architecture.py` builds masonry at metre scale, including the cloister floor and bell tower; avoid stretching a unit cube to make large floors. `compile-assets.mjs` computes tangents and serializes geometry, publishing complete files atomically so a live preview cannot read a partial mesh. `pnpm assets:compile` reruns just conversion from an existing intermediate export. Asset generation does not modify the installed engine or the separate Meep repository.

`ground_materials.py` authors periodic terrain detail and continuous biome/road weights. Its edge and weight-normalization checks run during every asset build. The client applies Meep's native terrain splat pass to the Blender terrain meshes, so transitions are independent of triangle boundaries. Keep texture scale in metres in the generated terrain manifest. Groves use a region's species, outcrops include buried parent rocks and smaller scree, and meadow patches mix grasses and flowers. Arches receive masonry foundations wherever their feet clear the terrain.

## Add or modify an area

1. Set its place in `REGIONS`, level range, purpose, landmark and small enemy vocabulary. Connect it in `ROUTES` with at least one useful destination and preferably a loop. Keep approach slopes and landmark sight lines in mind.
2. Author the landform through `heightAt` and place the area's props/lights in `buildLayout`. Add new kit assets in Blender. Keep route clearance greater than the standing capsule width; leave overhead clearance for sprinting and camera travel.
3. Populate encounters with stable IDs, grounded spawns and collision-free home positions. The current generic seven-spawn pattern is a starting point, not finished encounter composition. A boss home must be in a walkable arena, not at the center of a landmark column.

4. Rebuild assets. Run `pnpm test` and `pnpm world:check`. Inspect blocked routes and fix authored terrain/collision; do not silently remove checks to make them pass.
5. Open the workshop, visit both approaches, inspect day and night, and save compositions. Check silhouette separation, navigation cues, attack visibility, camera collision and interior exposure. Repeat after changing significant occluders.

The current atlas samples one ground layer at 2 m spacing. Small obstacles are conservatively expanded; narrow passages may produce false negatives. Roofs, floors over floors and underground rooms need separately authored Meep navigation surfaces and explicit links. Do not treat a successful ground path as proof that an arbitrary jumping/mantling route works.

## Ask spatial questions

```powershell
node tools/world-check.mjs path hearth cave
node tools/world-check.mjs path '0,1.8,20' '38,1.2,-15'
node tools/world-check.mjs los hearth abbey
node tools/world-check.mjs report .local/world-report.json
```

Path queries run Meep Polyanya over the sampled navmesh. Failed paths, failed report routes and composition sight points visible from fewer than two thirds of samples set exit code 1. Visibility casts nine rays through Meep's collision BVHs around an eye-height sample. The result is collision visibility; foliage without collision is not considered. The generic LOS command uses a target height of four metres. Named composition checks use explicit sight points on their monuments.

The report includes expected occupancy samples in 3D and nine real spherical-harmonic coefficients per sample. The flow model weights travel 70% toward progression and 30% back toward prior areas. Band-two coefficients preserve the two-way distribution that a single direction vector would lose. Occupancy currently comes from designed roads, not measured player telemetry. `travelSample([x,y,z])` can query arbitrary elevations; stored visualization samples follow the ground.

The development workshop (`?inspect=1`) displays nearby occupancy and first-order travel arrows, visits landmarks, changes time and saves PNGs with camera/world metadata through the development-only capture endpoint. Captures go to `.local/captures`; keep them out of source control unless deliberately promoting a reference image. Compare the requirements in `COMPOSITION_VIEWS` against actual images. Final approval of composition is visual, not a numerical visibility score.

## Add enemies, bosses and equipment

`content/catalog.mjs` contains weapon, origin, enemy and boss definitions. Enemies use a Meep behaviour tree in `simulation/enemy-mind.mjs`: sight/hearing and remembered threats select combat; otherwise they watch, patrol around home, and return when displaced. Navigation falls back to Meep NavMesh routes when direct BVH visibility is blocked. Patrol progress, memory, gait and action clocks live on the Actor so rollback and reconnect replay the same decisions. Stable actor IDs provide varied facing, patrol destinations and idle phases. Add a small number of distinct moves before increasing variant count.

Deaths hand the Blender skeleton to Meep capsule bodies and constrained joints in the simulation Worker. Author bone mass, radius and length alongside the rig; zero-mass attachments follow their parent. Corpses collide with world geometry and living-character proxies, remain for 45 seconds, and fade over their final four seconds. At most twelve bodies simulate simultaneously; older bodies retain their last pose. Cosmetic physics is separate from combat authority and is discarded when the authoritative world replaces an offline session. Presentation uses the same Meep interpolation timeline as living characters. Registered skins are pooled across respawns to contain the engine allocation issue described in `MEEP_DEFECTS.md`.

A new damaging move needs a shared simulation pose/shape, a readable visual, a resource/cooldown rule and a focused collision test. Damage and knockback must go through `GameWorld.damage`, which enforces PvP consent. Area effects require a boundary and particles for the same radius. Boss resets must consider all living participants; rewards must include late joiners.

Weapon ownership and arrows live in the character inventory. Origins should only supply different initial stats and equipment. Add new persistent fields to the explicit character export/import and update the save migration/version policy. Do not import server-owned world state from a returning client.

## Generate icons and sound

Run inference separately from the game and from each other. No model remains resident after these scripts exit. The scripts check current GPU usage and impose PyTorch allocation ceilings; other applications can still change GPU usage after a check, so watch total usage with `nvidia-smi`. Keep total project use around or below 18 GiB.

The tested local Python runtime is `H:\ai\ComfyUI\venv\Scripts\python.exe`, with supplementary packages in `H:\ai\art3d\Lib\site-packages`.

```powershell
& 'H:\ai\ComfyUI\venv\Scripts\python.exe' tools/generate-icons.py --model 'H:\git\FLUX.1-dev'
& 'H:\ai\ComfyUI\venv\Scripts\python.exe' tools/generate-audio.py
```

Icons use local FLUX.1-dev, bfloat16, sequential CPU offload, 384 px, 16 steps and fixed seeds. The palette/prompt is intentionally shared across sword, bow, seal and flask. Audio uses the local Stable Audio 3 Small SFX weights and bundled text conditioner in `H:\git\stable-audio-3-small-sfx`, eight steps, fixed seeds, half precision and chunked decode. Both output folders contain prompt/seed provenance. Audio generation preserves existing WAVs; remove only the individual output you intend to regenerate.

The optional audio runtime is installed into ignored `.local/audio-runtime`. Recreate it with the local Python and these pinned dependencies if needed:

```powershell
& 'H:\ai\ComfyUI\venv\Scripts\python.exe' -m pip install --no-deps --target .local/audio-runtime 'https://github.com/Stability-AI/stable-audio-3/archive/779434a908193105335fd8d833418603625b2859.zip' 'soundfile==0.14.0' 'einops-exts==0.0.4' 'cffi==2.1.1' 'pycparser==3.0'
```

This assumes the documented local Torch/diffusers/transformers environment already exists. It is not a portable Python lockfile. Model weights stay outside this repository. Record any dependency or model revision change before regenerating approved assets.

Sopra loads the six generated WAVs through Meep's asset manager, with positional one-shots, attenuation, voice limits and ambient loops. Listen to regenerated output in context before approving it. The initial files are generated draft audio, not a mastered sound library; acoustic probe baking, occlusion and transmission remain future integration work. Keep acoustic pathfinding disabled for the open world.

## Tests and changes

Keep tests beside the relevant `.mjs` modules using Vitest. Prefer small tests around collision outcomes, progression invariants and authority handoff. Use the existing socket integration test when changing network ownership or persistence. Use the production build and browser for renderer/asset checks rather than pretending Node unit tests validate GPU output. One-off investigations belong in the OS temporary directory, not the content pipeline.
