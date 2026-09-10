// Actor is gameplay state only. Spatial and collision state live in Meep components.
export class Actor {
  static typeName='OldCircleActor';
  id='';kind='enemy';archetype='hollow';name='';origin='pilgrim';weapon='sword';
  hp=100;healthMax=100;stamina=100;staminaMax=100;mana=70;manaMax=70;
  level=1;embers=0;flasks=3;pvp=false;seals=[];stats={vigor:12,endurance:12,might:12,insight:8};
  inventory={weapons:['sword'],arrows:30,armor:'road-worn mail'};
  yaw=0;cooldown=0;attackAge=-1;attackId=0;hitIds=[];hurtTime=0;deadTime=0;grounded=false;crouch=false;
  phase='idle';home=[0,0,0];boss=false;active=false;windup=0;attackKind='';lastButtons=0;
  mantle=null;checkpoint=[0,0,24];checkpointId='hearth';hearths=['hearth'];intent={x:0,z:0,yaw:0,buttons:0};
  x=0;y=0;z=0;vx=0;vy=0;vz=0;
  animationTime=0;gaitPhase=0;projectileReleased=false;
  airTime=0;fallSpeed=0;landingAge=-1;landingStrength=0;
  deathTick=0;deathVelocity=[0,0,0];
}
export class Projectile {
  static typeName='OldCircleProjectile';
  owner='';weapon='bow';damage=20;age=0;life=4;velocity=[0,0,0];hitIds=[];radius=.08;
}
