export class LoadingScreen {
  constructor(element){this.element=element;this.cancelReveal=null;}
  show(resetProgress=true){
    this.cancelReveal?.();
    if(resetProgress){
      const progress=this.element.querySelector('#loading-progress');
      if(progress)progress.style.width='0%';
    }
    this.element.hidden=false;
  }
  reveal(engine){
    this.show(false);
    return new Promise((resolve,reject)=>{
      const {postRender,contextLost,contextFailed}=engine.graphics.on;
      let frames=0,animation=null,finished=false;
      const finish=(visible,error)=>{
        if(finished)return;finished=true;
        postRender.remove(onRender);contextLost.remove(onFailure);contextFailed.remove(onFailure);
        animation?.cancel();this.cancelReveal=null;this.element.hidden=visible;
        if(error)reject(error);else resolve(visible);
      };
      const onFailure=reason=>{engine.renderingEnabled=false;finish(false,new Error(reason?.message??'The graphics device stopped while opening the world. Please reload to try again.'));};
      const onRender=()=>{
        // Count rendered frames, not browser ticks: GPU uploads and temporal
        // effects need the initialized world to draw behind the opaque card.
        if(++frames<3)return;
        postRender.remove(onRender);
        try{
          animation=this.element.animate([{opacity:1},{opacity:0}],{duration:450,easing:'ease-out',fill:'forwards'});
          animation.finished.then(()=>finish(true),()=>finish(false));
        }catch(error){onFailure(error);}
      };
      this.cancelReveal=()=>{engine.renderingEnabled=false;finish(false);};
      postRender.add(onRender);contextLost.add(onFailure);contextFailed.add(onFailure);engine.renderingEnabled=true;
    });
  }
}
