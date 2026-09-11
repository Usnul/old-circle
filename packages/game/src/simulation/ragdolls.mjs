import {System} from '@woosh/meep-engine/src/engine/ecs/System.js';
import {Joint} from '@woosh/meep-engine/src/engine/physics/ecs/Joint.js';
import {RigidBody} from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {BodyKind} from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import {CapsuleShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/CapsuleShape3D.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {Quaternion} from '@woosh/meep-engine/src/core/geom/Quaternion.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {clamp} from '@woosh/meep-engine/src/core/math/clamp.js';
import {GameWorld,DT} from './world.mjs';
import {actorJointPoses,actorRig,actorScale,rigs} from './animation.mjs';

const quaternion=values=>{const q=new Quaternion();q.set(...values);return q;};
const inverse=q=>quaternion(q).conjugate();
const rotated=(p,q)=>new Vector3(...p).applyQuaternion(quaternion(q));
const point=(origin,q,p)=>rotated(p,q).add(new Vector3(...origin));
const localPoint=(p,origin,q)=>new Vector3(...p).sub(new Vector3(...origin)).applyQuaternion(inverse(q));
const product=(a,b)=>{const q=quaternion(a);q.multiply(quaternion(b));return q;};
const IDENTITY=[0,0,0,1];
export const CORPSE_LIFETIME=45;

class JointSystem extends System {
  constructor(physics){super();this.physics=physics;this.dependencies=[Joint];}
  link(joint,_entity){this.physics.link_joint(joint);}
  unlink(joint,_entity){this.physics.unlink_joint(joint);}
}

/** Cosmetic jointed physics in the simulation Worker, against the authored world.
 * It cannot alter combat authority or prediction. Living capsules can push bodies.
 */
export class Ragdolls {
  constructor({maxActive=12}={}){this.world=new GameWorld();this.world.em.addSystem(new JointSystem(this.world.physics));this.records=new Map();this.seenDeaths=new Map();this.proxies=new Map();this.maxActive=maxActive;this.accumulator=0;}
  async start(){await this.world.start({populate:false});return this;}
  body(position,rotation,shape,{mass=1,kind=BodyKind.Dynamic,layer=2,mask=5,inertia=[1,1,1],velocity=[0,0,0]}={}){
    const ecd=this.world.ecd,id=ecd.createEntity(),t=new Transform64(),b=new RigidBody(),c=new Collider();
    t.setTranslation(...position);t.setRotation(...rotation);t.updateMatrix();b.mass=mass;b.kind=kind;b.layer=layer;b.mask=mask;b.inverseInertiaLocal.set(inertia);b.linearVelocity.set(velocity);b.linearDamping=.13;b.angularDamping=.8;c.shape=shape;c.friction=.85;c.restitution=.05;
    ecd.addComponentToEntity(id,t);ecd.addComponentToEntity(id,b);ecd.addComponentToEntity(id,c);return {id,t,b};
  }
  spawn(a){
    const key=`${a.id}:${a.deathTick??0}`;if(this.seenDeaths.get(a.id)===key)return;this.seenDeaths.set(a.id,key);
    const active=[...this.records.values()].filter(r=>r.active);if(active.length>=this.maxActive)this.freeze(active[0]);
    const name=actorRig(a),data=rigs[name],scale=actorScale(a),pose=actorJointPoses({...a,hurtTime:0}),bodies=new Map(),constraints=[];
    const velocity=(a.deathVelocity??[a.vx,a.vy,a.vz]).map(v=>clamp(v||0,-8,8));
    const locals=pose.map((p,i)=>{
      const parent=data.bones[i].parent;if(parent<0)return null;const q=pose[parent];
      return {position:Array.from(localPoint(p.position,q.position,q.rotation)),rotation:Array.from(product(inverse(q.rotation),p.rotation))};
    });
    for(let i=0;i<data.bones.length;i++){
      const bone=data.bones[i];if(!bone.mass)continue;
      const length=bone.length*scale,radius=bone.radius*scale,mass=bone.mass*scale**3,p=pose[i];
      const position=point(p.position,p.rotation,[0,length/2,0]);
      const transverse=12/(mass*(3*radius**2+length**2)),axial=2/(mass*radius**2);
      const body=this.body(position,p.rotation,CapsuleShape3D.from(radius,Math.max(.02,length-2*radius)),{mass,velocity,inertia:[transverse,axial,transverse]});
      body.b.angularVelocity.set([.3,0,.15]);body.length=length;bodies.set(i,body);
    }
    for(const [i,body] of bodies){
      const bone=data.bones[i],parent=bodies.get(bone.parent);if(!parent)continue;
      const joint=new Joint();joint.entityA=body.id;joint.entityB=parent.id;
      joint.localAnchorA.set([0,-body.length/2,0]);joint.localAnchorB.set(localPoint(pose[i].position,parent.t.translation,parent.t.rotation));
      const basis=bone.name.startsWith('calf')?IDENTITY:[0,0,Math.SQRT1_2,Math.SQRT1_2];
      joint.localBasisA.set(basis);joint.localBasisB.set(product(inverse(parent.t.rotation),product(body.t.rotation,basis)));
      if(bone.name.startsWith('calf'))joint.asHinge(0).setAngularLimit(0,-.15,1.85);
      else joint.asConeTwist(-.45,.45,bone.name.startsWith('upperArm')?1.25:.7);
      const id=this.world.ecd.createEntity();this.world.ecd.addComponentToEntity(id,joint);constraints.push(id);
    }
    this.records.set(key,{key,actorId:a.id,appearance:a.kind==='player'?'player':a.archetype,armor:a.inventory?.armor,name,scale,age:Math.min(35,a.deadTime??0),active:true,bodies,constraints,pose,locals,data,weapon:a.archetype==='hound'?null:a.weapon});
  }
  sync(actors){
    const live=new Set();
    for(const a of actors){
      if(a.hp<=0){if(a.deadTime<CORPSE_LIFETIME)this.spawn(a);continue;}
      live.add(a.id);let proxy=this.proxies.get(a.id),scale=a.boss?1.5:1;
      if(!proxy){proxy=this.body([a.x,a.y,a.z],IDENTITY,CapsuleShape3D.from(.32*scale,1.05*scale),{kind:BodyKind.Kinematic,layer:4,mask:2,inertia:[0,0,0]});this.proxies.set(a.id,proxy);}
      this.world.physics.setPose(proxy.b,[a.x,a.y,a.z],IDENTITY);proxy.b.linearVelocity.set([a.vx,a.vy,a.vz]);
    }
    for(const [id,proxy] of this.proxies)if(!live.has(id)){this.world.ecd.removeEntity(proxy.id);this.proxies.delete(id);}
  }
  readPose(record){
    for(let i=0;i<record.pose.length;i++){
      const body=record.bodies.get(i),p=record.pose[i];
      if(body){p.rotation=Array.from(body.t.rotation);p.position=Array.from(point(body.t.translation,body.t.rotation,[0,-body.length/2,0]));}
      else{const parent=record.pose[record.data.bones[i].parent],local=record.locals[i];p.rotation=Array.from(product(parent.rotation,local.rotation));p.position=Array.from(point(parent.position,parent.rotation,local.position));}
    }
  }
  update(dt,actors){
    this.sync(actors);this.accumulator+=Math.min(.1,dt);
    while(this.accumulator>=DT){this.world.physics.fixedUpdate(DT);this.accumulator-=DT;}
    for(const record of this.records.values()){
      if(record.active)this.readPose(record);record.age+=dt;
      if(record.age>CORPSE_LIFETIME)this.remove(record.key);
    }
  }
  freeze(record){
    if(!record.active)return;this.readPose(record);
    for(const id of record.constraints)this.world.ecd.removeEntity(id);
    for(const body of record.bodies.values())this.world.ecd.removeEntity(body.id);
    record.constraints=[];record.bodies.clear();record.active=false;
  }
  remove(key){const record=this.records.get(key);if(!record)return;this.freeze(record);this.records.delete(key);}
  clear(){for(const key of this.records.keys())this.remove(key);this.seenDeaths.clear();}
  snapshot(){return [...this.records.values()].map(r=>({key:r.key,actorId:r.actorId,name:r.name,appearance:r.appearance,armor:r.armor,scale:r.scale,age:r.age,joints:r.pose,weapon:r.weapon}));}
  async stop(){this.clear();await this.world.stop();}
}
