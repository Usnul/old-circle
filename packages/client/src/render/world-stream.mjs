import {System} from '@woosh/meep-engine/src/engine/ecs/System.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {Light} from '@woosh/meep-engine/src/engine/graphics/ecs/light/Light.js';
import {aabb3_unsigned_distance_sqr_to_point} from '@woosh/meep-engine/src/core/geom/3d/aabb/aabb3_unsigned_distance_sqr_to_point.js';
import {v3_distance} from '@woosh/meep-engine/src/core/geom/vec3/v3_distance.js';
import {countTask} from '@woosh/meep-engine/src/core/process/task/util/countTask.js';
import {runSceneryTask} from './scenery-data.mjs';
import {Scenery} from './scenery.mjs';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';

const plants = new Set(['groundcover', 'groundcover1', 'dryGrass', 'moorGrass', 'fern', 'bracken', 'grass', 'flowers']);
const trees = new Set(['tree', 'pine', 'magicTree', 'winterTree']);
const distance = (point, bounds) => Math.sqrt(aabb3_unsigned_distance_sqr_to_point(...bounds, ...point));

export function sceneryModel(record, focus, manifest) {
  const {scenery, transform, model} = record;
  const name = scenery.model;
  const d = distance(focus, scenery.bounds);
  if (plants.has(name)) return d < (model ? 62 : 50) ? name : null;
  if (/^(rock|sandstone|frostRock)/.test(name) && Math.max(...transform.scale) < 1) {
    return d < (model ? 135 : 115) ? name : null;
  }
  const lod = manifest.lods[name];
  if (!lod) return name;
  const range = name.startsWith('terrain_') ? 120 : trees.has(name) ? 80 : 105;
  return d < range + (model === name ? 25 : 0) ? name : lod;
}

/** Selects SGMesh representations on the authored entities. MeshSystem owns
 * their rendering, transforms and native child geometry. */
export class WorldStream extends System {
  dependencies = [Scenery, Transform64];

  constructor(view, layout, store) {
    super();
    this.view = view;
    this.store = store;
    this.layout = layout;
    this.manifest = store.manifest;
    this.groundEntities = [];
    this.error = null;
    this.retry = new Map();
    this.loading = new Map();
    this.focus = [0, 0, 23];
    this.clock = 0;
    this.refreshAt = 0;
    this.records = [];
    this.recordsByEntity = new Map();
    this.lights = layout.lights.map(position => ({position}));
    this.halos = [];
  }

  async startup(entityManager) {
    this.entityManager = entityManager;
    entityManager.dataset?.registerComponentType(SGMesh);
  }

  link(scenery, transform, entity) {
    const record = {
      entity,
      scenery,
      transform,
      mesh: this.entityManager.dataset.getComponent(entity, SGMesh),
      model: null,
      wanted: null,
      opened: false,
      emitters: null
    };
    this.records.push(record);
    this.recordsByEntity.set(entity, record);
    if (scenery.model === 'halo') this.halos.push(record);
    this.refreshAt = 0;
  }

  unlink(scenery, transform, entity) {
    const record = this.recordsByEntity.get(entity);
    if (!record) return;
    this.recordsByEntity.delete(entity);
    this.records.splice(this.records.indexOf(record), 1);
    if (scenery.model === 'halo') this.halos.splice(this.halos.indexOf(record), 1);

    const dataset = this.entityManager.dataset;
    // SGMesh remains authored data when this system or its dataset detaches.
    // MeshSystem releases its own runtime instance through its native unlink.
    if (record.model) this.store.release(record.model);
    this.removeEmitters(record, dataset);
    this.rebuildGround();
  }

  handleDatasetDetached(dataset) {
    for (const lamp of this.lights) this.removeLamp(lamp, dataset);
  }

  async start(focus, progress = () => {}) {
    this.focus = focus;
    this.plan();
    const names = [...new Set(this.records.map(record => record.wanted).filter(Boolean))];
    const distantModels = new Set(Object.values(this.manifest.lods));
    let loaded = 0;
    await Promise.all(names.map(async name => {
      await this.store.load(name, {pin: distantModels.has(name)});
      progress(++loaded / names.length);
    }));
    await runSceneryTask(countTask(0, this.records.length, index => {
      const record = this.records[index];
      this.replace(record, record.wanted);
    }));
    this.rebuildGround();
    return this;
  }

  plan() {
    for (const record of this.records) {
      record.wanted = sceneryModel(record, this.focus, this.manifest);
      if (record.scenery.relic && record.opened) record.wanted = 'reliquarySpent';
      record.distance = distance(this.focus, record.scenery.bounds);
    }
    this.records.sort((a, b) => {
      const terrainOrder = Number(!a.scenery.model.startsWith('terrain_')) - Number(!b.scenery.model.startsWith('terrain_'));
      return terrainOrder || a.distance - b.distance;
    });
    this.refreshAt = this.clock + .2;
  }

  replace(record, name) {
    const dataset = this.entityManager.dataset;
    const current = dataset.getComponent(record.entity, SGMesh);
    if (name && name !== record.model) this.store.retain(name);

    // A URL change needs a native unlink/link. Reuse the authored component,
    // retaining its flags, and leave the old mesh until the asset is loaded.
    if (current && current.url !== name) dataset.removeComponentFromEntity(record.entity, SGMesh);
    if (name && (!current || current.url !== name)) {
      const mesh = record.mesh ?? SGMesh.fromURL(name);
      mesh.url = name;
      record.mesh = mesh;
      dataset.addComponentToEntity(record.entity, mesh);
    }
    if (record.model && record.model !== name) this.store.release(record.model);
    record.model = name;
  }

  rebuildGround() {
    this.groundEntities.length = 0;
    for (const record of this.records) {
      if (!record.model || !record.scenery.model.startsWith('terrain_')) continue;
      for (const entity of this.view.meshSystem.mesh_entities_of(record.entity)) {
        this.groundEntities.push(entity);
      }
    }
    return this.groundEntities;
  }

  updateView(player, dt) {
    this.clock += dt;
    const focus = [player.x, player.y, player.z];
    const moved = v3_distance(...focus, ...this.focus);
    for (const record of this.records) {
      if (!record.scenery.relic) continue;
      const opened = (player.relics ?? []).includes(record.scenery.relic);
      if (record.opened !== opened) {
        record.opened = opened;
        this.refreshAt = 0;
      }
    }
    if (this.clock >= this.refreshAt || moved > 15) {
      this.focus = focus;
      this.plan();
    }

    const start = performance.now();
    let changes = 0;
    for (const record of this.records) {
      if (record.model === record.wanted) continue;
      if (record.wanted && !this.store.models.has(record.wanted)) {
        this.requestModel(record.wanted);
        continue;
      }
      this.replace(record, record.wanted);
      if (++changes >= 16 || performance.now() - start > 3) break;
    }
    // Native mesh attachment finishes asynchronously, including on a frame
    // where no LOD changes. Follow its current mesh IDs for terrain row masks.
    this.rebuildGround();
    this.store.update(dt);
    this.updateEffects(focus);
  }

  requestModel(name) {
    if (this.loading.has(name) || this.clock < (this.retry.get(name) ?? 0)) return;
    const promise = this.store.load(name);
    this.loading.set(name, promise);
    promise.catch(error => {
      this.error = error;
      this.retry.set(name, this.clock + 5);
    }).finally(() => this.loading.delete(name));
  }

  removeEmitters(record, dataset) {
    for (const emitter of record.emitters ?? []) dataset.removeEntity(emitter.id);
    record.emitters = null;
  }

  removeLamp(lamp, dataset) {
    if (lamp.light) dataset.removeEntity(lamp.light.id);
    this.view.vfx.remove(lamp.effect);
    lamp.light = null;
    lamp.effect = null;
  }

  updateEffects(focus) {
    const dataset = this.entityManager.dataset;
    // Suspended monuments carry their own circulating energy. Move the native
    // emitter along the authored ring; particles remain behind as fading trails.
    for (const halo of this.halos) {
      const d = distance(focus, halo.scenery.bounds);
      if (halo.emitters && d > 260) this.removeEmitters(halo, dataset);
      if (!halo.emitters && d < 220) {
        halo.emitters = Array.from({length: 6}, (_,i) => this.view.emitter(i%3===0?'monument-glint':'levitation', halo.transform.translation, i%3===0?5:24));
      }
      for (const [index, emitter] of (halo.emitters ?? []).entries()) {
        const angle = this.clock * .18 + index * Math.PI / 3;
        const transform = halo.transform;
        const x = 4.62 * Math.cos(angle);
        const y = 4.62 * Math.sin(angle);
        const z = index % 2 ? -.34 : .34;
        emitter.t.setTranslation(
          transform[0] * x + transform[4] * y + transform[8] * z + transform[12],
          transform[1] * x + transform[5] * y + transform[9] * z + transform[13],
          transform[2] * x + transform[6] * y + transform[10] * z + transform[14]
        );
        emitter.t.updateMatrix();
        t64_announce_change(dataset, emitter.id);
      }
    }
    for (const [index, lamp] of this.lights.entries()) {
      const d = v3_distance(...lamp.position, ...focus);
      if (!lamp.light && d < 75) {
        lamp.light = this.view.light(lamp.position, [1, .48, .13], 9, Light.Type.POINT, index % 5 === 0, 8);
        // The light sits above the rim; particles start at the bowl's fuel surface.
        lamp.effect = this.view.vfx.create('brazier', [lamp.position[0],lamp.position[1]-.18,lamp.position[2]], {continuous:true,persistent:true});
      } else if (lamp.light && d > 90) {
        this.removeLamp(lamp, dataset);
      }
    }
  }

  get stats() {
    return {
      ...this.store.stats,
      props: this.records.filter(record => record.model).length,
      nearTerrain: this.records.filter(record => record.scenery.model.startsWith('terrain_') && record.model === record.scenery.model).length,
      totalProps: this.records.length
    };
  }
}
