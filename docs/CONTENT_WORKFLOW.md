# Authoring and verification

## One source of world truth

`packages/game/src/world/regions.mjs` defines coordinates, elevations, region centers, progression, landmarks and roads. Coordinates are metres, Y up, north along −Z. `layout.mjs` places native model instances and lights. Use stable IDs: changing IDs changes how saved worlds refer to content. Road control points become Meep Catmull–Rom samples shared by ground texturing, the map, placement clearance and occupancy/direction queries. Landform noise fades out over graded road beds; increasing relief must preserve route connectivity.

Increment `WORLD_VERSION` when an elevation edit requires saved positions to be rebased. Character import and server world restoration preserve progression while lifting older saved positions and checkpoints above raised terrain. This migration assumes interiors remain above the heightfield; a future underground terrain revision needs its own placement policy.

Server restoration also reconciles saved enemy homes against the current authored population. A moved encounter or a living NPC stranded beyond its combat leash returns to the authored home; health and death timers remain intact. Ordinary in-range patrol positions persist. Keep actor IDs stable when moving an encounter so this migration can identify it.

`HEARTHS` defines one return point per region, beside a graded approach road. Keep its stable ID, clear the campsite of collision, and keep enemy patrol homes at least 22 metres away. The arrival point stays on the road. Resting, respawning and improving attributes share the same safety rules offline and through Meep network actions: no living enemy within 14 metres, no attack or mantle in progress, and the character must stand beside the fire. Kindled hearth IDs and the selected return point travel with the character save.

`tools/export-world-layout.mjs` samples that definition into ignored `.local/blender/world.json`. Blender reads those samples for terrain elevation and road materials. Never copy the height function or road coordinates into Python. Physics uses the shared height function and exported Blender convex hulls. Visual props and physical props use the same instance transforms.

`interiors.mjs` defines rock-vault sections, lights, burials and encounter homes. `caves.py` builds a continuous manifold rock shell around those sections, unwraps the stone along the vault and exports convex cells through its thickness. The floor follows the shared terrain samples; this authoring path supports hillside hollows above the terrain, not tunnels excavated below it. Keep both mouths clear, check roof coverage through the physics BVH, walk the route in the controller regression, and rebake navigation after changing the sections or tomb placement.

The terrain's native `Sampler2D` stores values at texel centres, matching Meep's `u * width - .5` convention. `terrainSurface()` evaluates its cubic filter at the 2 m mesh vertices; Blender export, placement, navigation and physics use the same triangle split. Do not feed vertex-grid samples directly to the UV sampler: that shifts collision relative to the visible hills. World version 3 migrates older elevations after correcting this alignment. The terrain collision regression casts rays across every region and compares the actual surface with exported heights.

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

`banner.py` authors the six-bone votive cloth with calm, forward and reverse wind Actions. `architecture.py` supplies its stationary colliding stand. Add placements through `buildLayout`'s banner helper so cloth and stand share a transform. Meep blends the native clips using the local fluid velocity against the banner's face; the top edge stays pinned. Keep placement clear of hearth arrivals and rebake navigation after moving a stand.

Human walk, run and crouched walk each have eight authored directions for every weapon. Adjacent directions blend from velocity relative to facing, keeping aim independent of travel. Each cycle covers 1.12 metres when walking and 1.84 metres when running, multiplied by actor scale; preserve those stride distances and the shared contact phases when editing clips. Directional foot-plant tests exercise all eight headings at multiple character orientations, including crouching and larger bosses.

Hounds use diagonal support pairs with 1.04 m walking and 1.36 m running strides. Keep their support feet travelling linearly opposite the body's motion and the leg reach within the authored bone lengths. Jump phase follows vertical velocity through ascent and descent; landing strength follows the prior falling speed. Air and landing clocks are replayable Actor state, carried on reconnect and sampled on the same presentation timeline as the body.

The export changes Blender `(x,y,z)` into Meep `(x,z,-y)`, including normals. An asset's origin is its placement pivot. Weapons point along local +Y in Meep; the authored blade intervals must stay consistent with `simulation/weapon-pose.mjs`. Trees collide through their trunks; masonry exports one convex hull per constituent piece; foliage does not block actors. Do not export an entire arch as one convex hull, which closes its doorway.

Textures, normal maps and the particle sprite are also authored in Blender. `architecture.py` builds masonry at metre scale, including the cloister floor and bell tower; avoid stretching a unit cube to make large floors. `compile-assets.mjs` computes tangents and serializes geometry, publishing complete files atomically so a live preview cannot read a partial mesh. `pnpm assets:compile` reruns just conversion from an existing intermediate export. Asset generation does not modify the installed engine or the separate Meep repository.

`equipment_materials.py` generates repeatable iron, brass, leather and cloth albedo/normal/ORM maps. ORM stores occlusion in red, roughness in green and metalness in blue; normal and ORM images use Meep's non-color data space. The travelling cloak has an explicit UV atlas with stitched hems and a broken-circle emblem. Character surface UVs use the dominant face plane so side faces do not collapse to a line. The Blender files pack the material images for review; regenerate them with the meshes when changing the maps.

`ground_materials.py` authors periodic terrain detail and continuous biome/road weights. Grass fragments, leaf litter, gravel, shale and windblown sand/snow distinguish the seven 512 px layers. Its edge and weight-normalization checks run during every asset build. The client applies Meep's native terrain splat pass to the Blender terrain meshes, so transitions are independent of triangle boundaries. Keep texture scale in metres in the generated terrain manifest.

`nature.py` builds fractured, bevelled rocks, snow caps, curved grass mats, ferns, bracken and fallen timber. Outcrops place several parent stones along contours, with smaller scree and sheltered plants; their foundations sample the terrain footprint before burial. Non-colliding plants carry a surface normal for Meep's transform alignment. Only shallow slopes receive broad grass mats, keeping their roots close to the ground. Groves share regional species; woodland understory follows grove edges and logs. Keep roads, hearths and boss clearings free of large props. Arches receive masonry foundations wherever their feet clear the terrain. Changing rock silhouettes can change cave clearance: always rebuild navigation and inspect both entrances.

## Add or modify an area

1. Set its place in `REGIONS`, level range, purpose, landmark and small enemy vocabulary. Connect it in `ROUTES` with at least one useful destination and preferably a loop. Keep approach slopes and landmark sight lines in mind.
2. Author the landform through `heightAt` and place the area's props/lights in `buildLayout`. Add new kit assets in Blender. Keep route clearance greater than the standing capsule width; leave overhead clearance for sprinting and camera travel.
3. Populate encounters with stable IDs, grounded spawns and collision-free home positions. The current generic seven-spawn pattern is a starting point, not finished encounter composition. A boss home must be in a walkable arena, not at the center of a landmark column.

4. Rebuild assets. Run `pnpm test` and `pnpm world:check`. Inspect blocked routes and fix authored terrain/collision; do not silently remove checks to make them pass.
5. Open the workshop, visit both approaches, inspect day and night, and save compositions. Check silhouette separation, navigation cues, attack visibility, camera collision and interior exposure. Repeat after changing significant occluders.

The current atlas samples one ground layer at 2 m spacing. Small obstacles are conservatively expanded; narrow passages may produce false negatives. Roofs, floors over floors and underground rooms need separately authored Meep navigation surfaces and explicit links. Do not treat a successful ground path as proof that an arbitrary jumping/mantling route works.

## Generate the journal map

`node tools/generate-world-map.mjs` produces the shipped `assets/map/world.svg` and its source fingerprint. It runs on every Vite startup/build and at the end of the Blender asset build. The image uses canonical height samples and road splines, collision footprints transformed by actual prop placement, and tree canopy extents decoded with Meep from the native geometry. Five-metre contours and shaded relief reveal climbs. Water footprints are included when authored water collision surfaces exist; the current world has none.

`WORLD_BOUNDS` and `world/map.mjs` supply the same north-up projection to the image and player, keeper and hearth markers. The full image represents 480 × 640 metres, without the old map’s compressed Z scale. The map supports zoom, dragging, arrow-key panning, return to the full extent, and centering on the current player. Run the generator again after editing world source while a development preview remains open, or restart the preview. Image generation is deterministic and requires neither Blender intermediates nor an inference model.

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

`content/boss-moves.mjs` defines the six keepers’ ordered patterns, windups and recovery times; patterns change below half health. Bell waves travel along the terrain and can be jumped. Root traps lock their target positions, stars leave a gap between paired circles, cinders spread in a fan, winter advances along a line, and the Last King combines waves with traps. `simulation/boss-attacks.mjs` owns native overlap/line-of-sight damage and stable cast keys. Pending hazards and their hit ledgers are part of the shared world snapshot, including for late arrivals. Death and encounter reset cancel the keeper’s remaining projectiles.

`tools/blender/bosses.py` authors keeper skins on the pilgrim joint order; their editable armatures and the six full-body cast Actions remain in `old-circle-characters.blend`. Update animation windup/recovery durations alongside the gameplay definitions. `build_warnings.py` retains packed ground masks in `warnings.blend`. The native decal renderer uses the shared wave radius, projects onto terrain, fades emissive intensity as well as coverage, and limits nearby warnings to 64 and transient bursts to twelve. Verify masks in the live renderer on slopes, snow and at night; a successful damage test does not verify a visible projector.

Weapon ownership, arrows, owned armor and per-weapon reinforcement ranks live in the character inventory. `content/equipment.mjs` defines protection, poise, pace, hearing, regeneration, seal unlocks and reinforcement prices. Add inventory fields to `migrateInventory` with explicit old-save defaults. New command fields require a network protocol bump. Armor variants in `build_characters.py` share the pilgrim joint order, bind matrices and animation clips; export their meshes with no duplicated runtime clip set. Keep the source armatures in the Blender file. The renderer selects their geometry from the equipped item and preserves that appearance on ragdolls. Origins should only supply different initial stats and equipment. Add new persistent fields to the explicit character export/import and update the save migration/version policy. Do not import server-owned world state from a returning client.

## Author layered dungeons

`world/dungeons.mjs` defines local X/north coordinates, floor elevations, slopes, room connections, doors, enemy homes and personal relics. `tools/blender/dungeons.py` builds their masonry and native convex collision sources into `old-circle-kit.blend`; the standard asset build compiles them into Meep geometry. Keep convex body origins inside their own geometry: runtime placement centres each hull without changing its world-space vertices. Floors must meet along matching sampled edges, with enough clearance for a character at doors and landings.

After changing floors or collision, run the asset build and `node tools/world-check.mjs bake`. This validates the native topology and the entrance-to-relic path and writes both navigation assets. Dungeon regression tests cover every room pair, a complete walk to the upper reward, the return drop, enemy pursuit between stacked floors, personal collection and old-world migration. Room names and the map come from the same definitions. Workshop composition views include the lower court and upper lantern chamber; inspect entrances, low ceilings, stairs and rewards under automatic exposure in daylight and darkness.

Add relics through the dungeon's treasure definition and migrate persistent fields through the character allowlist. A world-content update merges newly authored NPCs into older disk saves while retaining existing encounter health and deaths; authoritative network replacement remains exact. Relic ownership is personal, so the renderer chooses a closed or opened reliquary for the local character.

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

Sopra loads the generated WAVs through Meep's asset manager, with positional one-shots, attenuation, voice limits and ambient loops. The 24 `step-*` and `paw-*` samples are isolated single impacts for grass, gravel, stone, snow, wood and sand; their provenance includes the original duration and trim. The old two-impact `step.wav` is retained as source output and is not used for walking. Listen to regenerated output in context before approving it. Acoustic probe baking, occlusion and transmission remain future integration work. Keep acoustic pathfinding disabled for the open world.

Foot contacts sample the displayed Blender soles and query static Meep collision in the worker. Terrain materials use the rendered splat weights; structures use their authored surface. Each landing can play one spatial impact, burst a native GPU effect and project a native decal along the hit normal and toe direction. Limits are 16 nearby actors, one query in flight, 32 transient bursts and 128 reusable print projectors; old prints fade sooner under crowd pressure. `tools/blender/build_footprints.py` authors boot treads and paw masks and retains packed images in `assets/blender/footprints.blend`.

## Tests and changes

Regional airborne effects are authored in `effects.mjs` as native Meep particle graphs. `ambient.mjs` blends emission near region boundaries and stops outdoor emission under cover sampled by the simulation BVH. Existing particles must finish their fade before recycling. Pollen, dust, snow and ash receive scene lighting; fireflies and glass motes emit light. `WorldWind` runs Meep's fluid solver at 20 Hz in a local 18 × 8 × 18 field with 3 m cells and terrain solids. It follows the camera's character through native field shifts. This presentation field steers ambient effects; changes to projectile physics require a separate shared simulation rule.

Keep tests beside the relevant `.mjs` modules using Vitest. Prefer small tests around collision outcomes, progression invariants and authority handoff. Use the existing socket integration test when changing network ownership or persistence. Use the production build and browser for renderer/asset checks rather than pretending Node unit tests validate GPU output. One-off investigations belong in the OS temporary directory, not the content pipeline.
