import {expect,test,vi} from 'vitest';
import {LanternChain,LanternScenery,lanternBodyBones,lanternMount} from './lantern-chain.mjs';
import {RigidBody} from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {BoxShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/BoxShape3D.js';
import {compute_penetration} from '@woosh/meep-engine/src/engine/physics/narrowphase/compute_penetration.js';
import {BodyKind} from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Animation} from '@woosh/meep-engine/src/engine/ecs/animation/Animation.js';
import {Light} from '@woosh/meep-engine/src/engine/graphics/ecs/light/Light.js';
import {m4_invert} from '@woosh/meep-engine/src/core/geom/3d/mat4/m4_invert.js';
import {Actor} from '@old-circle/game/simulation/components.mjs';
import {actorSocket} from '@old-circle/game/simulation/animation.mjs';
import {Characters} from './characters.mjs';
import {ShadedGeometry} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import {SHADED_GEOMETRY_EVENT_CHANGE} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/SHADED_GEOMETRY_EVENT_CHANGE.js';
import {StandardShadeMaterial} from '@woosh/meep-engine/src/shade/renderer/material/StandardShadeMaterial.js';
import {TransparencyMode} from '@woosh/meep-engine/src/shade/renderer/material/TransparencyMode.js';
import {ShadeDrawMode} from '@woosh/meep-engine/src/shade/renderer/material/ShadeDrawMode.js';
import {ShadeDrawSide} from '@woosh/meep-engine/src/shade/renderer/material/ShadeDrawSide.js';
import {filter_materials_by_bucket} from '@woosh/meep-engine/src/shade/renderer/rasterize/bucket/filter_materials_by_bucket.js';

const makeSocket=(position=[0,1,0],scale=1)=>{
  const t=new Transform64();t.setTranslation(...position);t.setScale(scale,scale,scale);t.updateMatrix();return t;
};
const distance=(a,b)=>Math.hypot(...Array.from(a,(v,i)=>v-b[i]));
const jointError=chain=>Math.max(...chain.joints.map(joint=>
  new Vector3(...joint.localAnchorA).applyMatrix4(chain.bodies[joint.entityA].t)
    .distanceTo(new Vector3(...joint.localAnchorB).applyMatrix4(chain.bodies[joint.entityB].t))));
const cageDepth=(chain,body)=>{
  const cage=chain.links[2];return compute_penetration([0,0,0],cage.c.shape,cage.t.translation,cage.t.rotation,body.c.shape,body.t.translation,body.t.rotation);
};

test.each([30,60,120,144])('Meep joints retain attachment and dissipate swing at %s fps',fps=>{
  const chain=new LanternChain(),socket=makeSocket(),dt=1/fps;
  chain.update(socket,0);const bodies=chain.links.slice();let excursion=0,maxError=0;
  for(let frame=1;frame<=fps*3;frame++){
    const time=frame*dt;socket.setTranslation(Math.sin(time*6)*.05,1,0);socket.updateMatrix();
    chain.update(socket,dt);excursion=Math.max(excursion,Math.abs(chain.ember[0]-lanternMount(socket).x));maxError=Math.max(maxError,jointError(chain));
  }
  expect(excursion).toBeGreaterThan(.04);expect(maxError).toBeLessThan(.004);
  socket.setTranslation(0,1,0);socket.updateMatrix();let residual=0;
  for(let frame=0;frame<fps*10;frame++){
    chain.update(socket,dt);
    if(frame>=fps*9)residual=Math.max(residual,Math.hypot(chain.ember[0]-lanternMount(socket).x,chain.ember[2]-lanternMount(socket).z));
  }
  expect(chain.links).toEqual(bodies);expect(residual).toBeLessThan(.025);expect(residual).toBeLessThan(excursion*.2);
  chain.dispose();
});

test('variable render cadence advances only fixed physics ticks and preserves paused motion',()=>{
  const chain=new LanternChain(),socket=makeSocket(),dts=[1/30,1/90,1/144,1/75,1/45];
  chain.update(socket,0);const step=vi.spyOn(chain.physics,'fixedUpdate');let elapsed=0;
  for(let frame=0;frame<100;frame++){
    const dt=dts[frame%dts.length];elapsed+=dt;socket.setTranslation(elapsed*.3,1,0);socket.updateMatrix();chain.update(socket,dt);
    expect(distance(chain.poses[0].position,lanternMount(socket))).toBeLessThan(.004);
  }
  expect(step).toHaveBeenCalledTimes(Math.floor(elapsed*120+1e-8));
  expect(step.mock.calls.every(([dt])=>dt===1/120)).toBe(true);
  const count=step.mock.calls.length,poses=structuredClone(chain.poses);
  chain.update(socket,0);expect(step).toHaveBeenCalledTimes(count);expect(chain.poses).toEqual(poses);
  chain.dispose();
});

test.each([30,60,144])('animated wearer colliders maintain cage clearance and joint continuity at %s fps',fps=>{
  const actor=Object.assign(new Actor(),{kind:'player',y:.845,grounded:true,weapon:'sword'});
  const chain=new LanternChain(),socket=new Transform64(),poses=lanternBodyBones.map(()=>new Transform64());
  let firstBodies,maxDepth=0,maxError=0;
  for(let frame=0;frame<fps*4;frame++){
    const time=frame/fps;actor.yaw=Math.sin(time)*1.3;actor.x=time*.5;actor.gaitPhase=time*.5;actor.animationTime=time;
    actorSocket(socket,actor,'hips');lanternBodyBones.forEach((bone,i)=>actorSocket(poses[i],actor,bone.name));
    chain.update(socket,1/fps,poses);firstBodies??=chain.links.slice();
    // Matrix decomposition introduces tiny scale differences during a turn;
    // they must not rebuild the bodies and discard their momentum.
    expect(chain.links).toEqual(firstBodies);
    maxError=Math.max(maxError,jointError(chain));
    for(const body of chain.wearer)maxDepth=Math.max(maxDepth,cageDepth(chain,body));
  }
  expect(maxError).toBeLessThan(.004);expect(maxDepth).toBeLessThan(.009);
  expect(chain.wearer.every(body=>body.b.kind===BodyKind.KinematicVelocity)).toBe(true);
  expect(chain.links.every(body=>body.b.kind===BodyKind.Dynamic)).toBe(true);
  chain.dispose();
});

test('a moving wearer capsule pushes the cage through native contacts',()=>{
  const chain=new LanternChain(),control=new LanternChain(),socket=makeSocket(),hip=makeSocket([-.9,.70,-.085]);
  control.physics.setContactFilter(()=>false);
  for(let frame=0;frame<360;frame++){chain.update(socket,1/120,[hip]);control.update(socket,1/120,[hip]);}
  let separation=0,contacts=0;
  for(let frame=1;frame<=180;frame++){
    hip.setTranslation(-.9+Math.min(1,frame/120)*.43,.70,-.085);hip.updateMatrix();
    chain.update(socket,1/120,[hip]);control.update(socket,1/120,[hip]);
    separation=Math.max(separation,distance(chain.ember,control.ember));
    if(cageDepth(control,control.wearer[0])>.02)contacts++;
  }
  expect(contacts).toBeGreaterThan(10);expect(separation).toBeGreaterThan(.04);
  expect(cageDepth(chain,chain.wearer[0])).toBeLessThan(.009);
  chain.dispose();control.dispose();
});

test('teleport, scale changes and long stalls reset bodies without leaking solver state',()=>{
  const chain=new LanternChain(),socket=makeSocket();chain.update(socket,0);
  for(const [position,scale,dt] of [[[100,11,-50],1,1/60],[[100,11,-50],2,0],[[100,11,-50],2,.5]]){
    const oldBodies=chain.bodies.slice(),oldJoints=chain.joints.slice();
    socket.setTranslation(...position);socket.setScale(scale,scale,scale);socket.updateMatrix();chain.update(socket,dt);
    expect(chain.links[0]).not.toBe(oldBodies[1]);expect(chain.physics.storage.size).toBe(4);
    expect(oldBodies.every(body=>body.b._bodyId===-1)).toBe(true);expect(oldJoints.every(joint=>joint._jointId===-1)).toBe(true);
    expect(distance(chain.poses[0].position,lanternMount(socket))).toBeLessThan(.004);
    expect(chain.links[2].c.shape.half_extents.y).toBeCloseTo(.14*scale);
    expect(jointError(chain)).toBeLessThan(.004);
  }
  chain.dispose();chain.dispose();expect(chain.physics.storage.size).toBe(0);
});

test('nearby authored scenery supports a corpse lantern and releases distant statics',()=>{
  const ecd=new EntityComponentDataset();ecd.setComponentTypeMap([RigidBody,Collider,Transform64]);
  const floor=new Collider();floor.shape=BoxShape3D.from(20,.1,20);floor.friction=.8;
  const transform=makeSocket([0,-.1,0]),body=new RigidBody();body.kind=BodyKind.Static;
  new Entity().add(transform).add(body).add(floor).build(ecd);
  const remote=new Collider();remote.shape=BoxShape3D.from(1,.1,1);
  new Entity().add(makeSocket([100,-.1,0])).add(Object.assign(new RigidBody(),{kind:BodyKind.Static})).add(remote).build(ecd);
  const scenery=new LanternScenery(ecd),chain=new LanternChain(scenery),socket=makeSocket([0,.12,0]);
  for(let frame=0;frame<600;frame++)chain.update(socket,1/120);
  expect(chain.statics.size).toBe(1);const support=[...chain.statics.values()][0];
  expect(support.c).not.toBe(floor);expect(support.c.shape).toBe(floor.shape);
  expect(support.c.friction).toBe(.8);expect(body._bodyId).toBe(-1);
  expect(cageDepth(chain,support)).toBeLessThan(.008);expect(chain.ember[1]).toBeGreaterThan(.09);
  expect(jointError(chain)).toBeLessThan(.004);
  socket.setTranslation(100,.12,0);socket.updateMatrix();chain.update(socket,0);
  expect(chain.statics.size).toBe(1);expect(support.b._bodyId).toBe(-1);
  expect([...chain.statics.values()][0].c.shape).toBe(remote.shape);
  chain.dispose();expect(chain.physics.storage.size).toBe(0);
});

test('characters removal disposes lantern bodies and joints',()=>{
  const ecd=new EntityComponentDataset();
  ecd.registerComponentType(Transform64);ecd.registerComponentType(Light);ecd.registerComponentType(ShadedGeometry);
  const model=name=>(name==='pilgrimLantern'?['brass','ember','iron']:['brass']).map(material=>{
    const t=new Transform64(),geometry=new ShadedGeometry();geometry.material=new StandardShadeMaterial();
    geometry.material.diffuse_color.set(...material==='ember'?[1,.37,.06,1]:[.48,.31,.12,1]);
    return {id:new Entity().add(t).add(geometry).build(ecd),t};
  });

  const events=vi.spyOn(ecd,'sendEvent');
  const removeEntity=vi.spyOn(ecd,'removeEntity');
  const removedEntities=[];
  const view={
    ecd,
    model,
    materials:{ember:new StandardShadeMaterial(),brass:new StandardShadeMaterial(),iron:new StandardShadeMaterial()},
    animations:{playbacks_of:()=>[]},
    light(position,color,intensity,type,shadow,distance,radius){
      const t=new Transform64();t.setTranslation(...position);const l=new Light();l.castShadow.set(shadow);l.radius.set(radius);l.distance.set(distance);
      return {id:new Entity().add(t).add(l).build(ecd),t,l};
    },
    remove:(items)=>{
      for(const {id} of items){removedEntities.push(id);ecd.removeEntity(id);}
    }
  };

  const characters=new Characters(view);
  const root=model()[0];
  const rig={...root,clips:new Map(),animation:new Animation(),weaponName:'bow',weapon:[]};
  const actor=Object.assign(new Actor(),{kind:'player',y:.845,grounded:true,weapon:'bow',attackAge:0,attackKind:'weapon'});
  actor.yaw=.35;
  for(let frame=0;frame<2;frame++){
    actor.attackAge=frame/60;
    characters.update(rig,actor,1/60);
  }

  const chain=rig.lantern.chain;
  expect(chain.links.length).toBe(3);
  expect(chain.joints.length).toBe(3);
  const bodies=chain.bodies.slice(),joints=chain.joints.slice();
  const lightId=rig.lantern.light.id;

  characters.remove(rig);
  expect(chain.links.length).toBe(0);
  expect(chain.joints.length).toBe(0);
  expect(chain.wearer).toHaveLength(0);
  expect(chain.physics.storage.size).toBe(0);
  expect(bodies.every(body=>body.b._bodyId===-1)).toBe(true);
  expect(joints.every(joint=>joint._jointId===-1)).toBe(true);
  expect(removeEntity).toHaveBeenCalledWith(lightId);
  expect(events).toHaveBeenCalled();
  expect(removedEntities.length).toBeGreaterThan(0);
  expect(removedEntities.every(id=>!ecd.entityExists(id))).toBe(true);
  expect(rig.lantern).toBeUndefined();
});

test.each(['bow','spear'])('%s arm motion leaves the lamp on the hips belt without light shadows',weapon=>{
  const ecd=new EntityComponentDataset();
  ecd.registerComponentType(Transform64);ecd.registerComponentType(Light);ecd.registerComponentType(ShadedGeometry);
  const events=vi.spyOn(ecd,'sendEvent'),materials={ember:new StandardShadeMaterial(),brass:new StandardShadeMaterial(),iron:new StandardShadeMaterial()};
  const model=name=>(name==='pilgrimLantern'?['brass','ember','iron']:['brass']).map(material=>{
    const t=new Transform64(),geometry=new ShadedGeometry();geometry.material=materials[material];return {id:new Entity().add(t).add(geometry).build(ecd),t};
  });
  const view={ecd,model,materials,animations:{playbacks_of:()=>[]},light(position,color,intensity,type,shadow,distance,radius){
    const t=new Transform64();t.setTranslation(...position);const l=new Light();l.castShadow.set(shadow);l.radius.set(radius);l.distance.set(distance);
    return {id:new Entity().add(t).add(l).build(ecd),t,l};
  }},characters=new Characters(view),root=model()[0],rig={...root,clips:new Map(),animation:new Animation(),weaponName:weapon,weapon:[]};
  const actor=Object.assign(new Actor(),{kind:'player',y:.845,grounded:true,weapon,attackAge:0,attackKind:'weapon'}),hips=new Transform64(),hand=new Transform64(),inverse=new Float64Array(16),handOffsets=[];
  for(let frame=0;frame<45;frame++){
    actor.attackAge=frame/60;actor.yaw=.35;characters.update(rig,actor,1/60);actorSocket(hips,actor,'hips');actorSocket(hand,actor,'handL');m4_invert(inverse,hips);
    const local=new Vector3(...rig.lantern.chain.poses[0].position).applyMatrix4(inverse);
    expect(local.x).toBeCloseTo(-.22,2);expect(local.y+.94).toBeGreaterThan(1.005);expect(local.y+.94).toBeLessThan(1.058);expect(local.z).toBeCloseTo(-.085,2);
    const ellipse=Math.hypot(local.x/.238,local.z/.168),distanceToBelt=Math.hypot(local.x,local.z)*(1-1/ellipse);
    expect(distanceToBelt).toBeGreaterThan(0);expect(distanceToBelt).toBeLessThan(.02);
    const light=rig.lantern.light.t.translation;
    const emberInMesh=new Vector3(0,-.222,0).applyMatrix4(rig.lantern.parts[0].t);
    expect(distance(light,emberInMesh)).toBeLessThan(1e-6);
    [...rig.lantern.links,[...rig.lantern.parts]].forEach((parts,i)=>{
      for(const part of parts)expect(Array.from(part.t.rotation)).toEqual(Array.from(rig.lantern.chain.links[i].t.rotation));
    });
    handOffsets.push(new Vector3(...hand.translation).applyMatrix4(inverse));
  }
  expect(Math.max(...handOffsets.map(p=>p.distanceTo(handOffsets[0])))).toBeGreaterThan(.1);
  expect(rig.lantern.light.l.castShadow.getValue()).toBe(false);expect(rig.lantern.light.l.radius.getValue()).toBe(.045);expect(rig.lantern.light.l.distance.getValue()).toBe(7);
  const chunks=[...rig.lantern.parts,...rig.lantern.links.flat()].map(({id})=>ecd.getComponent(id,ShadedGeometry).material);
  const ember=rig.lantern.parts[1],core=ecd.getComponent(ember.id,ShadedGeometry).material,shadowCasters=[];
  // The real point shadow job draws exactly opaque and alpha-tested buckets;
  // classify with the native material filter, rather than trusting ECS flags
  // that this version of Shade does not forward to its scene rows.
  for(const mode of [TransparencyMode.Opaque,TransparencyMode.AlphaTested])for(const side of [ShadeDrawSide.Front,ShadeDrawSide.Double])filter_materials_by_bucket(shadowCasters,shadowCasters.length,mode,ShadeDrawMode.Triangles,side,chunks,chunks.length);
  expect(shadowCasters).not.toContain(core);expect(shadowCasters).toEqual([materials.brass,materials.iron,materials.brass,materials.brass]);
  const translucent=[];filter_materials_by_bucket(translucent,0,TransparencyMode.Transparent,ShadeDrawMode.Triangles,core.draw_side,chunks,chunks.length);expect(translucent).toEqual([core]);
  expect(core).not.toBe(materials.ember);expect(core.diffuse_color.a).toBe(.85);expect(materials.ember.transparency_mode).toBe(TransparencyMode.Opaque);expect(materials.ember.diffuse_color.a).toBe(1);
  expect(events.mock.calls.filter(([,event])=>event===SHADED_GEOMETRY_EVENT_CHANGE).map(([id])=>id)).toEqual([ember.id]);
  rig.lantern.chain.dispose();
});
