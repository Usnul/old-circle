# Old Circle — art and world direction

## Premise and visual language

An old pilgrimage road runs toward a cathedral crowned by a broken stone circle. Six keepers hold the seals of a sun that cannot finish setting. The player begins at a small hearth, learns the road, and eventually climbs to the Last Crown. Architecture repeats the circle, arch and radial sanctuary at different scales so that each place belongs to the same culture.

The generated concept in `packages/client/public/assets/art/old-circle-concept.png` sets the target: weathered limestone, dark worn armor, oxidized brass, moss green and warm ember light against cool mist. It is concept artwork and the title-screen background, not an in-game screenshot. The current Blender kit establishes silhouettes and materials but still needs substantial environment and character art work to meet that target.

Keep visual contrast purposeful. Warm amber identifies shelter and human traces. Pale blue identifies frost and the Glasswood. Boss danger uses a warm luminous boundary and a readable wind-up. Small particles support depth; large particles should accompany an actual attack. Keep the road, enemy silhouette and attack edge visible through fog. Avoid broad emissive foliage competing with objectives in finished assets.

## Connected progression

| Region | Levels | Landmark and purpose | Reused enemy vocabulary |
| --- | --- | --- | --- |
| Waking Fields | 1–5 | Hearth, first-light abbey, Bellkeeper's Hollow; learn combat and claim Dawn | Roadbound, hounds; one cave mage |
| Mourningwood | 5–10 | Widow Oak; Root seal, western branch of the pilgrimage | Roadbound, hounds, archers |
| Cinder March | 10–16 | Severed Aqueduct; Ash seal, eastern branch | Roadbound, archers, mages |
| Glasswood | 16–22 | Listening Spire; Star seal and a cross-route into Pale Reach | Hounds, mages, archers |
| Pale Reach | 22–28 | Frozen Pilgrims; Frost seal and the final ascent | Roadbound, mages, sentinels |
| Last Crown | 28–35 | Broken Halo; Last King and Circle seal | Sentinels, mages |

The first abbey introduces a radial encounter that stays open to arriving players. The cave loops back into the abbey road and gives an early magic reward. After Dawn, the road forks into forest and ochre stone, reconnects through the high regions and ends at the highest landmark. Levels encourage this sequence; invisible level barriers do not enforce it. These are compact zones in a prototype landscape, not six finished content regions.

Give every added road a destination, reward, encounter or shortcut. Major landmarks should retain a distinctive skyline from at least two arrival directions. Smaller local features should announce turns and entrances. Use the occupancy and directional flow samples to identify common views, then inspect actual rendered frames. A clear physics ray is necessary evidence for collision visibility but does not establish that foliage or fog leaves an attractive, readable view.

## UI

`ui/_tokens.scss` owns color, typography, base spacing, radius and transition tokens. Palatino/Georgia carry titles; Segoe UI carries controls. Warm paper text sits over near-black green; brass rules and open circle motifs establish hierarchy. Body text and controls should remain readable over bright and dark world areas. Keep engine implementation detail in the workshop and documentation. The normal UI describes choices in game terms.

## Next production milestones

1. Bring the opening route, cave and Aldren encounter to the concept's visual quality, with distinct boss animation and polished ledge hanging/mantling. Rigged characters and directional locomotion are implemented; those alone do not establish the final art quality.
2. Author an actual connected dungeon with rooms, vertical routes, acoustic probes, authored navmesh layers and deliberate combat compositions.
3. Replace whole-world changed-field replication with scoped components, expand unstable-connection and sustained multi-player checks, then select the production transport.
4. Expand the modular kit and enemy moves region by region, add armor and more weapon families, and introduce streaming before expanding the map footprint.

Keep the game playable at each milestone. Do not count a named region, effect toggle or boss stat variant as finished content.
