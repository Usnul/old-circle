import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {sampler2d_to_f16} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/sampler2d_to_f16.js';
import {SceneAtmosphere} from '@woosh/meep-engine/src/shade/renderer/atmosphere/SceneAtmosphere.js';
import {octahedral_z_pole_uv_to_direction} from '@woosh/meep-engine/src/shade/renderer/light/environment/octahedral_z_pole_uv_to_direction.js';
import {sampler2d_octahedral_skirt_fill} from '@woosh/meep-engine/src/shade/renderer/light/environment/sampler2d_octahedral_skirt_fill.js';
import {ShadeImage} from '@woosh/meep-engine/src/shade/renderer/texture/source/ShadeImage.js';
import {ShadeTexture} from '@woosh/meep-engine/src/shade/renderer/texture/ShadeTexture.js';
import {smoothStep} from '@woosh/meep-engine/src/core/math/smoothStep.js';
import {lerp} from '@woosh/meep-engine/src/core/math/lerp.js';
import {euclidean_modulo} from '@woosh/meep-engine/src/core/math/euclidean_modulo.js';

const nightFill=[.10,.16,.24],N=254,TW=64,TH=16,MW=16,MH=16,SW=64,SH=48,MIN_SKY_Y=.3/Math.hypot(1,.3,.35);
function celestial(hour){
  const angle=(hour-6)/24*Math.PI*2,elevation=Math.sin(angle),day=Math.max(0,elevation),night=Math.max(0,-elevation),side=elevation>=0?1:-1;
  const warm=smoothStep(0,1,(elevation+.1)/.2),moon=[.40,.57,.86],sun=[1,.66+day*.23,.36+day*.41];
  return {angle,day,night,nightBlend:smoothStep(0,1,(.18-elevation)/.36),direction:[Math.cos(angle)*side,Math.max(.06,Math.abs(elevation)),.35*side],color:moon.map((v,i)=>lerp(v,sun[i],warm)),intensity:(.12+day*3.6+night*.72)*smoothStep(0,1,Math.abs(elevation)/.08)};
}

let sharedBaker=null;
function skyBaker(){
  if(sharedBaker)return sharedBaker;
  const atmosphere=new SceneAtmosphere();
  atmosphere.ground_albedo=[.16,.21,.19];
  atmosphere.mie_phase_g=.62;
  atmosphere.rayleigh_scattering=atmosphere.rayleigh_scattering.map(v=>v*2.3);
  atmosphere.mie_scattering=atmosphere.mie_scattering.map(v=>v*2.4);
  atmosphere.mie_extinction=atmosphere.mie_extinction.map(v=>v*2.4);
  atmosphere.ozone_absorption=atmosphere.ozone_absorption.map(v=>v*.9);
  const atm=atmosphere.write_uniform(),R=atm.planet_radius,H=atm.atmosphere_height,topR=R+H,obsR=R+atmosphere.reference_altitude*1e-3;
  const cosHoriz=-Math.sqrt(Math.max(0,(obsR-R)*(obsR+R)))/obsR;
  const rSH=atm.rayleigh_scale_height,mSH=atm.mie_scale_height,oCenter=atm.ozone_center_height,oHalf=atm.ozone_half_width;
  const [r0,r1,r2]=atm.rayleigh_scattering,[m0,m1,m2]=atm.mie_scattering;
  const e0=m0+atm.mie_absorption[0],e1=m1+atm.mie_absorption[1],e2=m2+atm.mie_absorption[2];
  const [o0,o1,o2]=atm.ozone_absorption,[a0,a1,a2]=atm.ground_albedo,g=atm.mie_phase_g,g2=g*g;

  const transLut=new Float32Array(TW*TH*3),msLut=new Float32Array(MW*MH*3),tmpT=new Float32Array(3),tmpMS=new Float32Array(3);
  const sampleLut=(lut,W,Ht,h,cosZ,out)=>{
    const u=Math.min(1,Math.max(0,.5+.5*cosZ))*(W-1),v=Math.min(1,Math.max(0,h/H))*(Ht-1);
    const x0=u|0,y0=v|0,x1=Math.min(W-1,x0+1),y1=Math.min(Ht-1,y0+1),fx=u-x0,fy=v-y0;
    const i00=(y0*W+x0)*3,i10=(y0*W+x1)*3,i01=(y1*W+x0)*3,i11=(y1*W+x1)*3;
    for(let c=0;c<3;c++)out[c]=(lut[i00+c]+(lut[i10+c]-lut[i00+c])*fx)*(1-fy)+(lut[i01+c]+(lut[i11+c]-lut[i01+c])*fx)*fy;
  };
  for(let y=0;y<TH;y++){
    const h=y/(TH-1)*H,r=R+Math.max(1e-4,h);
    for(let x=0;x<TW;x++){
      const cosZ=x/(TW-1)*2-1,b=r*cosZ,idx=(y*TW+x)*3;
      if(b<0&&b*b-(r-R)*(r+R)>=0)continue;
      const tMax=-b+Math.sqrt(Math.max(0,b*b-(r-topR)*(r+topR))),sinZ=Math.sqrt(Math.max(0,1-cosZ*cosZ));
      let od0=0,od1=0,od2=0,t=0;
      for(let s=0;s<24;s++){
        const newT=(s+.3)/24*tMax,dt=newT-t;t=newT;
        const lh=Math.max(0,Math.hypot(sinZ*t,r+cosZ*t)-R),dr=Math.exp(-lh/rSH),dm=Math.exp(-lh/mSH),do3=Math.max(0,1-Math.abs(lh-oCenter)/oHalf);
        od0+=(dr*r0+dm*e0+do3*o0)*dt;od1+=(dr*r1+dm*e1+do3*o1)*dt;od2+=(dr*r2+dm*e2+do3*o2)*dt;
      }
      transLut[idx]=Math.exp(-od0);transLut[idx+1]=Math.exp(-od1);transLut[idx+2]=Math.exp(-od2);
    }
  }

  const DIRS=32,golden=Math.PI*(3-Math.sqrt(5)),dirX=new Float32Array(DIRS),dirY=new Float32Array(DIRS),dirZ=new Float32Array(DIRS);
  for(let d=0;d<DIRS;d++){const y=1-(d+.5)/DIRS*2,rad=Math.sqrt(Math.max(0,1-y*y)),phi=d*golden;dirX[d]=Math.cos(phi)*rad;dirY[d]=y;dirZ[d]=Math.sin(phi)*rad;}
  for(let y=0;y<MH;y++){
    const h=y/(MH-1)*H,r=R+Math.max(1e-4,h);
    for(let x=0;x<MW;x++){
      const sunCos=x/(MW-1)*2-1,sunSin=Math.sqrt(Math.max(0,1-sunCos*sunCos));
      let lum0=0,lum1=0,lum2=0,fms0=0,fms1=0,fms2=0;
      for(let d=0;d<DIRS;d++){
        const rx=dirX[d],ry=dirY[d],rz=dirZ[d],b=r*ry,gd=b*b-(r-R)*(r+R),hg=b<0&&gd>=0;
        const tMax=hg?Math.max(0,-b-Math.sqrt(Math.max(0,gd))):(-b+Math.sqrt(Math.max(0,b*b-(r-topR)*(r+topR))));
        const cosTheta=rx*sunSin+ry*sunCos,pR=3/(16*Math.PI)*(1+cosTheta*cosTheta),denom=1+g2-2*g*cosTheta;
        const pM=3/(8*Math.PI)*((1-g2)*(1+cosTheta*cosTheta))/((2+g2)*denom*Math.sqrt(denom));
        let tr0=1,tr1=1,tr2=1,l0=0,l1=0,l2=0,f0=0,f1=0,f2=0,t=0;
        for(let s=0;s<12;s++){
          const newT=(s+.3)/12*tMax,dt=newT-t;t=newT;
          const sx=rx*t,sy=r+ry*t,sz=rz*t,sr=Math.hypot(sx,sy,sz),lh=Math.max(0,sr-R);
          const dr=Math.exp(-lh/rSH),dm=Math.exp(-lh/mSH),do3=Math.max(0,1-Math.abs(lh-oCenter)/oHalf);
          const rs0=dr*r0,rs1=dr*r1,rs2=dr*r2,ms0=dm*m0,ms1=dm*m1,ms2=dm*m2;
          const ex0=Math.max(1e-12,rs0+dm*e0+do3*o0),ex1=Math.max(1e-12,rs1+dm*e1+do3*o1),ex2=Math.max(1e-12,rs2+dm*e2+do3*o2);
          const st0=Math.exp(-dt*ex0),st1=Math.exp(-dt*ex1),st2=Math.exp(-dt*ex2);
          f0+=tr0*(rs0+ms0)*(1-st0)/ex0;f1+=tr1*(rs1+ms1)*(1-st1)/ex1;f2+=tr2*(rs2+ms2)*(1-st2)/ex2;
          sampleLut(transLut,TW,TH,lh,(sx*sunSin+sy*sunCos)/sr,tmpT);
          l0+=tr0*(rs0*pR+ms0*pM)*tmpT[0]*(1-st0)/ex0;l1+=tr1*(rs1*pR+ms1*pM)*tmpT[1]*(1-st1)/ex1;l2+=tr2*(rs2*pR+ms2*pM)*tmpT[2]*(1-st2)/ex2;
          tr0*=st0;tr1*=st1;tr2*=st2;
        }
        if(hg){
          const hx=rx*tMax,hy=r+ry*tMax,hz=rz*tMax,upSun=(hx*sunSin+hy*sunCos)/Math.hypot(hx,hy,hz);
          if(upSun>0){sampleLut(transLut,TW,TH,0,upSun,tmpT);const k=upSun/Math.PI;l0+=tr0*a0*k*tmpT[0];l1+=tr1*a1*k*tmpT[1];l2+=tr2*a2*k*tmpT[2];}
        }
        lum0+=l0/DIRS;lum1+=l1/DIRS;lum2+=l2/DIRS;fms0+=f0/DIRS;fms1+=f1/DIRS;fms2+=f2/DIRS;
      }
      const idx=(y*MW+x)*3;
      msLut[idx]=lum0/Math.max(1e-4,1-fms0);msLut[idx+1]=lum1/Math.max(1e-4,1-fms1);msLut[idx+2]=lum2/Math.max(1e-4,1-fms2);
    }
  }

  const gridHx=new Float32Array(N*N),gridHz=new Float32Array(N*N),gridV=new Float32Array(N*N),tmpDir=new Float32Array(3);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    octahedral_z_pole_uv_to_direction(tmpDir,(x+.5)/N,(y+.5)/N);
    const k=y*N+x,dy=tmpDir[1],dh=Math.hypot(tmpDir[0],tmpDir[2]);
    gridHx[k]=dh>1e-6?tmpDir[0]/dh:1;gridHz[k]=dh>1e-6?tmpDir[2]/dh:0;
    gridV[k]=dy<cosHoriz?.5*(1-Math.sqrt((cosHoriz-dy)/(1+cosHoriz))):.5*(1+Math.sqrt((dy-cosHoriz)/(1-cosHoriz)));
  }

  const skyCache=new Map();
  const skyView=sunY=>{
    const key=Math.round(sunY*1e5);let lut=skyCache.get(key);if(lut)return lut;
    if(skyCache.size>=64)skyCache.clear();
    lut=new Float32Array(SW*SH*3);
    const sunSin=Math.sqrt(Math.max(0,1-sunY*sunY));
    for(let j=0;j<SH;j++){
      const v=j/(SH-1),u=v<.5?1-2*v:2*v-1,ry=v<.5?cosHoriz-u*u*(1+cosHoriz):cosHoriz+u*u*(1-cosHoriz),rHoriz=Math.sqrt(Math.max(0,1-ry*ry));
      const b=obsR*ry,gd=b*b-(obsR-R)*(obsR+R),hg=b<0&&gd>=0;
      const tMax=hg?Math.max(0,-b-Math.sqrt(Math.max(0,gd))):(-b+Math.sqrt(Math.max(0,b*b-(obsR-topR)*(obsR+topR))));
      for(let i=0;i<SW;i++){
        const cosAz=i/(SW-1)*2-1,rx=cosAz*rHoriz,rz=Math.sqrt(Math.max(0,1-cosAz*cosAz))*rHoriz;
        const cosTheta=rx*sunSin+ry*sunY,pR=3/(16*Math.PI)*(1+cosTheta*cosTheta),denom=1+g2-2*g*cosTheta;
        const pM=3/(8*Math.PI)*((1-g2)*(1+cosTheta*cosTheta))/((2+g2)*denom*Math.sqrt(denom));
        let tr0=1,tr1=1,tr2=1,l0=0,l1=0,l2=0,t=0;
        for(let s=0;s<20;s++){
          const newT=(s+.3)/20*tMax,dt=newT-t;t=newT;
          const sx=rx*t,sy=obsR+ry*t,sz=rz*t,sr=Math.hypot(sx,sy,sz),lh=Math.max(0,sr-R);
          const dr=Math.exp(-lh/rSH),dm=Math.exp(-lh/mSH),do3=Math.max(0,1-Math.abs(lh-oCenter)/oHalf);
          const rs0=dr*r0,rs1=dr*r1,rs2=dr*r2,ms0=dm*m0,ms1=dm*m1,ms2=dm*m2;
          const ex0=Math.max(1e-12,rs0+dm*e0+do3*o0),ex1=Math.max(1e-12,rs1+dm*e1+do3*o1),ex2=Math.max(1e-12,rs2+dm*e2+do3*o2);
          const st0=Math.exp(-dt*ex0),st1=Math.exp(-dt*ex1),st2=Math.exp(-dt*ex2),upSun=(sx*sunSin+sy*sunY)/sr;
          sampleLut(transLut,TW,TH,lh,upSun,tmpT);sampleLut(msLut,MW,MH,lh,upSun,tmpMS);
          l0+=tr0*(rs0*(pR*tmpT[0]+tmpMS[0])+ms0*(pM*tmpT[0]+tmpMS[0]))*(1-st0)/ex0;
          l1+=tr1*(rs1*(pR*tmpT[1]+tmpMS[1])+ms1*(pM*tmpT[1]+tmpMS[1]))*(1-st1)/ex1;
          l2+=tr2*(rs2*(pR*tmpT[2]+tmpMS[2])+ms2*(pM*tmpT[2]+tmpMS[2]))*(1-st2)/ex2;
          tr0*=st0;tr1*=st1;tr2*=st2;
        }
        if(hg){
          const hx=rx*tMax,hy=obsR+ry*tMax,hz=rz*tMax,upSun=(hx*sunSin+hy*sunY)/Math.hypot(hx,hy,hz);
          sampleLut(transLut,TW,TH,0,upSun,tmpT);sampleLut(msLut,MW,MH,0,upSun,tmpMS);
          const db=Math.max(0,upSun)/Math.PI;
          l0+=tr0*a0*(db*tmpT[0]+tmpMS[0]);l1+=tr1*a1*(db*tmpT[1]+tmpMS[1]);l2+=tr2*a2*(db*tmpT[2]+tmpMS[2]);
        }
        const idx=(j*SW+i)*3;lut[idx]=l0;lut[idx+1]=l1;lut[idx+2]=l2;
      }
    }
    skyCache.set(key,lut);return lut;
  };

  return sharedBaker=(outData,hx,hz,sunY,brightness,tint,nightBlend)=>{
    const shLen=Math.hypot(hx,hz),shx=shLen>1e-6?hx/shLen:1,shz=shLen>1e-6?hz/shLen:0;
    const lut=skyView(sunY),low=Math.pow(Math.max(0,1-sunY),1.35)*(1-.85*nightBlend);
    const E0=22.5*(1+1.8*low),E1=25*(1+1.1*low),E2=29.5*(1+.2*low);
    const t0=brightness*tint[0],t1=brightness*tint[1],t2=brightness*tint[2];
    const nf0=nightFill[0]*nightBlend,nf1=nightFill[1]*nightBlend,nf2=nightFill[2]*nightBlend,sw1=SW-1,sh1=SH-1;
    for(let y=0;y<N;y++){
      const row=(y+1)*256+1,kRow=y*N;
      for(let x=0;x<N;x++){
        const k=kRow+x,u=(.5+.5*(gridHx[k]*shx+gridHz[k]*shz))*sw1,v=gridV[k]*sh1;
        const x0=u|0,y0=v|0,x1=x0<sw1?x0+1:sw1,y1=y0<sh1?y0+1:sh1,fx=u-x0,fy=v-y0,ofy=1-fy;
        const i00=(y0*SW+x0)*3,i10=(y0*SW+x1)*3,i01=(y1*SW+x0)*3,i11=(y1*SW+x1)*3;
        const rOut=((lut[i00]+(lut[i10]-lut[i00])*fx)*ofy+(lut[i01]+(lut[i11]-lut[i01])*fx)*fy)*E0;
        const gOut=((lut[i00+1]+(lut[i10+1]-lut[i00+1])*fx)*ofy+(lut[i01+1]+(lut[i11+1]-lut[i01+1])*fx)*fy)*E1;
        const bOut=((lut[i00+2]+(lut[i10+2]-lut[i00+2])*fx)*ofy+(lut[i01+2]+(lut[i11+2]-lut[i01+2])*fx)*fy)*E2;
        const offset=(row+x)*4;
        outData[offset]=rOut/(1+rOut/1.9)*t0+nf0;outData[offset+1]=gOut/(1+gOut/1.9)*t1+nf1;outData[offset+2]=bOut/(1+bOut/1.9)*t2+nf2;outData[offset+3]=1;
      }
    }
  };
}

/** Meep's Hillaire SceneAtmosphere supplies the HDR background and environment light.
 * A sun and opposing moon follow the world clock; 64 cached skies bound memory. */
export class WorldSky {
  constructor(){this.levels=new Map();this.last=-1;}
  async prepare(){
    // Bake the small, bounded cycle while the loading screen is present. A sky
    // change during walking should only select a texture, never raymarch LUTs.
    for(let level=0;level<64;level++){this.texture(level);if(level%4===3)await new Promise(resolve=>setTimeout(resolve,0));}
  }
  update(scene,hour){
    if(scene.atmosphere)scene.atmosphere.enabled=false;
    const light=celestial(hour),level=euclidean_modulo(Math.round(hour/24*64),64),texture=this.texture(level);
    if(level===this.last&&scene.lights.environment===texture)return light;this.last=level;
    scene.lights.environment=texture;return light;
  }
  texture(rawLevel){
    const level=euclidean_modulo(Math.round(rawLevel),64);
    let texture=this.levels.get(level);
    if(!texture){
      const {angle,day,night,nightBlend}=celestial(level/64*24),hx=Math.cos(angle),hz=.35,clampedY=Math.max(.3,day);
      // Twilight skylight remains after the directional source meets the
      // horizon. Keep that diffuse fill independent of the moon's elevation.
      const sunY=day>0?clampedY/Math.hypot(hx,clampedY,hz):MIN_SKY_Y;
      const octahedral=Sampler2D.float32(4,256,256),brightness=.22+day*.62+night*.07,tint=[1-nightBlend*.66,1-nightBlend*.50,1-nightBlend*.18];
      // Sample the 254x254 interior in the renderer's direction convention and
      // mirror the 1-texel octahedral border skirt required by GPULightCollection.
      skyBaker()(octahedral.data,hx,hz,sunY,brightness,tint,nightBlend);
      sampler2d_octahedral_skirt_fill(octahedral);
      texture=ShadeTexture.from(ShadeImage.fromSampler2D(sampler2d_to_f16(octahedral)));this.levels.set(level,texture);
    }
    return texture;
  }
}
