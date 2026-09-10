const labels=['N','NE','E','SE','S','SW','W','NW'];
export function compassMarkup(){
  let ticks='';for(let degrees=-360;degrees<=720;degrees+=15){const major=degrees%45===0;
    ticks+=`<span class="compass-tick ${major?'major':''}" style="left:calc(50% + ${degrees*2}px)">${major?labels[((degrees/45)%8+8)%8]:''}</span>`;}
  return `<div class="compass-window" aria-hidden="true"><div id="compass-track">${ticks}</div><span id="compass-goal">◇</span></div><span class="compass-needle"></span><span id="objective"></span>`;
}
export function updateCompass(yaw,player,landmark){
  const bearing=((-yaw*180/Math.PI)%360+360)%360;
  document.querySelector('#compass-track').style.transform=`translateX(${-bearing*2}px)`;
  const goal=document.querySelector('#compass-goal');
  if(landmark){const angle=Math.atan2(landmark.position[0]-player.x,-(landmark.position[2]-player.z)),delta=((angle+yaw+Math.PI*3)%(Math.PI*2))-Math.PI;
    goal.style.transform=`translateX(${delta*180/Math.PI*2}px)`;goal.style.opacity=Math.abs(delta)<Math.PI*.58?'1':'0';}
  else goal.style.opacity=0;
}
