import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {Quaternion} from '@woosh/meep-engine/src/core/geom/Quaternion.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {PhysicsSystem} from '@woosh/meep-engine/src/engine/physics/ecs/PhysicsSystem.js';
import {RigidBody} from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import {BodyKind} from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {Joint} from '@woosh/meep-engine/src/engine/physics/ecs/Joint.js';
import {CapsuleShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/CapsuleShape3D.js';
import {BoxShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/BoxShape3D.js';
import {quat3_multiply} from '@woosh/meep-engine/src/core/geom/3d/quaternion/quat3_multiply.js';
import {quat3_nlerp} from '@woosh/meep-engine/src/core/geom/3d/quaternion/quat3_nlerp.js';
import {rigs} from '@old-circle/game/simulation/animation.mjs';
import {BVH} from '@woosh/meep-engine/src/core/bvh2/bvh3/BVH.js';
import {bvh_query_user_data_intersects_aabb} from '@woosh/meep-engine/src/core/bvh2/bvh3/query/bvh_query_user_data_intersects_aabb.js';
import {aabb3_transform_oriented} from '@woosh/meep-engine/src/core/geom/3d/aabb/aabb3_transform_oriented.js';

const STEP=1/120,IDENTITY=[0,0,0,1];
// Model origins are at the hooks; rigid-body origins are at their centres of mass.
const segments=[{length:.038,centre:.022,mass:.035},{length:.038,centre:.022,mass:.035},{centre:.222,mass:.45}];
const wearerRadii={hips:.20,spine:.19,chest:.20,thighL:.145,thighR:.145,calfL:.10,calfR:.10};
export const lanternBodyBones=rigs.pilgrim.bones.filter(b=>wearerRadii[b.name]);

export function lanternMount(socket){
  return new Vector3(-.22,.092,-.085).applyMatrix4(socket);
}

function point(transform,y){return new Vector3(0,y,0).applyMatrix4(transform);}

/** One read-only index of the baked scene, shared by all lanterns. Each solver
 * links only nearby static shapes, including native terrain and mesh colliders. */
export class LanternScenery {
  constructor(dataset){
    this.bvh=new BVH();this.colliders=[];
    const local=new Float64Array(6),world=new Float64Array(6);
    // The presentation bake strips RigidBody components. Build this index
    // immediately after decoding it, before adding animated wearer colliders.
    dataset.traverseEntities([Collider,Transform64],(collider,transform)=>{
      collider.shape.compute_bounding_box(local);
      aabb3_transform_oriented(world,0,...local,...transform.translation,...transform.rotation);
      const node=this.bvh.allocate_node();this.bvh.node_set_aabb_primitive(node,...world);
      this.bvh.node_set_user_data(node,this.colliders.length);this.bvh.insert_leaf(node);
      this.colliders.push({collider,transform});
    });
    this.hits=new Uint32Array(this.colliders.length);
  }
  nearby(position,radius){
    const [x,y,z]=position,count=bvh_query_user_data_intersects_aabb(this.hits,0,this.bvh,[x-radius,y-radius,z-radius,x+radius,y+radius,z+radius]);
    return this.hits.subarray(0,count);
  }
}

/** A small cosmetic Meep world owned by one lantern. The presented skeleton
 * drives kinematic colliders; the engine owns all integration and constraints.
 * Explicit link/unlink keeps its lifetime independent of the render engine clock. */
export class LanternChain {
  constructor(scenery=null){
    this.physics=new PhysicsSystem();this.bodies=[];this.joints=[];this.links=[];this.wearer=[];this.accumulator=0;
    this.scenery=scenery;this.statics=new Map();this.nextEntity=0;
    // Centimetre-scale links carrying the heavier cage need finer joint solves.
    this.physics.substeps=12;
    this.physics.setContactFilter((a,b)=>!this.joints.some(j=>(j.entityA===a&&j.entityB===b)||(j.entityA===b&&j.entityB===a)));
  }
  body(position,rotation,shape,mass=0,inertia=[0,0,0],kind=mass?BodyKind.Dynamic:BodyKind.KinematicVelocity){
    const id=this.nextEntity++,t=new Transform64(),b=new RigidBody(),c=shape?new Collider():null;
    t.setTranslation(...position);t.setRotation(...rotation);t.updateMatrix();
    b.kind=kind;b.mass=mass||1;
    b.inverseInertiaLocal.set(inertia);b.linearDamping=.5;b.angularDamping=3;
    this.physics.link(b,t,id);
    if(c){c.shape=shape;c.friction=.35;c.restitution=0;this.physics.attach_collider(id,c,t,id);}
    const body={id,t,b,c};this.bodies.push(body);return body;
  }
  syncScenery(anchor){
    if(!this.scenery)return;
    const nearby=new Set(this.scenery.nearby(anchor,this.scale));
    for(const [key,body] of this.statics)if(!nearby.has(key)){
      this.physics.unlink(body.b,body.t,body.id);this.bodies.splice(this.bodies.indexOf(body),1);this.statics.delete(key);
    }
    for(const key of nearby)if(!this.statics.has(key)){
      const {collider,transform}=this.scenery.colliders[key];
      const body=this.body(transform.translation,transform.rotation,collider.shape,0,[0,0,0],BodyKind.Static);
      body.c.friction=collider.friction;body.c.restitution=collider.restitution;this.statics.set(key,body);
    }
  }
  targets(socket,poses){
    return [{position:Array.from(lanternMount(socket)),rotation:IDENTITY},...poses.map((pose,i)=>({
      position:Array.from(point(pose,lanternBodyBones[i].length/2)),rotation:Array.from(pose.rotation)
    }))];
  }
  reset(socket,poses,targets){
    this.dispose();this.scale=socket.scale[0];const scale=this.scale;
    this.anchor=this.body(targets[0].position,IDENTITY,null);
    for(let i=0;i<poses.length;i++){
      const bone=lanternBodyBones[i],radius=wearerRadii[bone.name],length=/^(thigh|calf)/.test(bone.name)?bone.length:Math.max(.02,bone.length-2*radius);
      this.wearer.push(this.body(targets[i+1].position,targets[i+1].rotation,CapsuleShape3D.from(radius*scale,length*scale)));
    }
    // Spawn clear of the trousers. This is only the initial pose; contacts
    // and joints determine the resting angle and every subsequent swing.
    const centre=new Vector3(0,.092,0).applyMatrix4(socket),outward=new Vector3(...targets[0].position).sub(centre);
    outward.y=0;outward.normalize();
    const tilt=new Quaternion().fromUnitVectors(new Vector3(0,-1,0),new Vector3(outward.x*.8,-.6,outward.z*.8));
    let hook=targets[0].position.slice(),parent=this.anchor;
    for(let i=0;i<segments.length;i++){
      const spec=segments[i],mass=spec.mass*scale**3,centre=spec.centre*scale;
      const rotation=[0,0,0,1];quat3_multiply(rotation,0,...tilt,...(i===1?[0,Math.SQRT1_2,0,Math.SQRT1_2]:IDENTITY));
      const half=i===2?[.095*scale,.14*scale,.095*scale]:[.023*scale,.027*scale,.023*scale];
      const inertia=half.map((_,axis)=>3/(mass*(half[(axis+1)%3]**2+half[(axis+2)%3]**2)));
      const shape=i===2?BoxShape3D.from(...half):CapsuleShape3D.from(.023*scale,.01*scale);
      const initial=new Transform64();initial.setTranslation(...hook);initial.setRotation(...rotation);initial.updateMatrix();
      const body=this.body(point(initial,-centre),rotation,shape,mass,inertia);
      this.links.push(body);
      const joint=new Joint();joint.entityA=parent.id;joint.entityB=body.id;
      joint.localAnchorA.set([0,i?(segments[i-1].centre-segments[i-1].length)*scale:0,0]);
      joint.localAnchorB.set([0,centre,0]);
      // Align reference frames despite the second link's authored quarter turn.
      joint.localBasisA.set([-parent.t.rotation[0],-parent.t.rotation[1],-parent.t.rotation[2],parent.t.rotation[3]]);
      joint.localBasisB.set([-rotation[0],-rotation[1],-rotation[2],rotation[3]]);
      if(i){joint.setAngularLimit(0,-1.2,1.2);joint.setAngularLimit(2,-1.2,1.2);}
      this.physics.link_joint(joint);this.joints.push(joint);parent=body;
      if(spec.length)hook=Array.from(point(initial,-spec.length*scale));
    }
    this.previousTargets=targets;this.accumulator=0;
  }
  drive(body,from,to,fraction){
    const position=from.position.map((v,i)=>v+(to.position[i]-v)*fraction),rotation=[0,0,0,1],delta=[0,0,0,1];
    quat3_nlerp(rotation,0,...from.rotation,...to.rotation,fraction);
    const current=body.t.rotation;
    quat3_multiply(delta,0,...rotation,-current[0],-current[1],-current[2],current[3]);
    if(delta[3]<0)for(let i=0;i<4;i++)delta[i]=-delta[i];
    const sine=Math.hypot(delta[0],delta[1],delta[2]),factor=sine>1e-10?2*Math.atan2(sine,delta[3])/(sine*STEP):0;
    this.physics.setAngularVelocity(body.b,delta.slice(0,3).map(v=>v*factor));
    this.physics.setLinearVelocity(body.b,position.map((v,i)=>(v-body.t.translation[i])/STEP));
  }
  update(socket,dt,poses=[]){
    const targets=this.targets(socket,poses),anchor=targets[0].position;
    if(!this.anchor||Math.abs(socket.scale[0]-this.scale)>1e-6||poses.length!==this.wearer.length||dt>.1||Math.hypot(...anchor.map((v,i)=>v-this.previousTargets[0].position[i]))>this.scale*1.5){
      this.reset(socket,poses,targets);
    }
    this.syncScenery(anchor);
    if(dt>0&&dt<=.1){
      const previous=this.accumulator;this.accumulator+=dt;
      let elapsed=STEP-previous;
      while(this.accumulator+1e-10>=STEP){
        [this.anchor,...this.wearer].forEach((body,i)=>this.drive(body,this.previousTargets[i],targets[i],Math.min(1,elapsed/dt)));
        this.physics.fixedUpdate(STEP);this.accumulator-=STEP;elapsed+=STEP;
      }
    }
    this.previousTargets=targets;
    // Present the sub-tick belt displacement uniformly, without changing the
    // solver's body poses or re-solving the links in the renderer.
    const offset=anchor.map((v,i)=>v-this.anchor.t.translation[i]);
    this.poses=this.links.map((body,i)=>({
      position:Array.from(point(body.t,segments[i].centre*this.scale),(v,j)=>v+offset[j]),rotation:Array.from(body.t.rotation)
    }));
    this.ember=Array.from(this.links[2].t.translation,(v,i)=>v+offset[i]);
    return this.poses;
  }
  dispose(){
    for(const joint of this.joints)this.physics.unlink_joint(joint);
    for(const {b,t,id} of this.bodies)this.physics.unlink(b,t,id);
    this.joints.length=0;this.bodies.length=0;this.links.length=0;this.wearer.length=0;this.anchor=null;this.accumulator=0;
    this.statics.clear();this.nextEntity=0;
  }
}
