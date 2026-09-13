const lengths=[.038,.038,.22]; // Two visible links, then the lamp's centre of mass.
export class LanternChain {
  reset(anchor,scale){
    this.points=[anchor.slice()];this.scale=scale;
    for(const length of lengths){const p=this.points.at(-1);this.points.push([p[0],p[1]-length*scale,p[2]]);}
    this.previous=this.points.map(p=>p.slice());
  }
  update(anchor,scale,dt){
    if(!this.points||scale!==this.scale||Math.hypot(...anchor.map((v,i)=>v-this.points[0][i]))>scale*1.5)this.reset(anchor,scale);
    if(dt<=0)return this.points;
    const steps=Math.max(1,Math.ceil(Math.min(.1,dt)*120)),h=Math.min(.1,Math.max(0,dt))/steps,from=this.points[0].slice();
    for(let step=0;step<steps;step++){
      this.points[0]=anchor.map((v,i)=>from[i]+(v-from[i])*(step+1)/steps);
      for(let i=1;i<4;i++){
        const p=this.points[i],old=p.slice();
        for(let axis=0;axis<3;axis++)p[axis]+=(p[axis]-this.previous[i][axis])*Math.exp(-h*3)+(axis===1?-9.81*h*h:0);
        this.previous[i]=old;
      }
      for(let iteration=0;iteration<10;iteration++)for(let i=1;i<4;i++){
        const a=this.points[i-1],b=this.points[i],delta=b.map((v,j)=>v-a[j]),distance=Math.hypot(...delta)||1,length=lengths[i-1]*scale;
        for(let j=0;j<3;j++){const correction=delta[j]*(distance-length)/distance;if(i>1)a[j]+=correction*.5;b[j]-=correction*(i>1?.5:1);}
      }
      // A small cone limits contact with the wearer and caps violent starts.
      for(let i=1;i<4;i++){
        const a=this.points[i-1],b=this.points[i],dx=b[0]-a[0],dz=b[2]-a[2],horizontal=Math.hypot(dx,dz),length=lengths[i-1]*scale,limit=length*.55;
        const factor=horizontal>limit?limit/horizontal:1;
        b[0]=a[0]+dx*factor;b[2]=a[2]+dz*factor;b[1]=a[1]-Math.sqrt(Math.max(0,length*length-horizontal*horizontal*factor*factor));
      }
    }
    return this.points;
  }
}

/** Quaternion taking local down to a hanging segment, with alternating link planes. */
export function hangingRotation(from,to,twist=0){
  const d=to.map((v,i)=>v-from[i]),length=Math.hypot(...d)||1;
  const q=[-d[2]/length,0,d[0]/length,1-d[1]/length],n=Math.hypot(...q);for(let i=0;i<4;i++)q[i]/=n;
  const s=Math.sin(twist/2),c=Math.cos(twist/2);
  return [q[0]*c-q[2]*s,q[3]*s,q[2]*c+q[0]*s,q[3]*c];
}
