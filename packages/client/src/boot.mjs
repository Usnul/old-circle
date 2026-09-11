import './ui/style.scss';

// Content modules await their baked assets. Catch failures outside that import
// graph so a missing download or stale bake still gives the player a way back.
try{
  await import('./main.mjs');
}catch(error){
  console.error('Could not load Old Circle',error);
  const app=document.querySelector('#app');
  app.innerHTML='<section class="screen loading"><div role="alert"><h2>Could not load Old Circle</h2><p>Please reload to try again.</p><button type="button">Reload</button></div></section>';
  app.querySelector('button').addEventListener('click',()=>location.reload());
}
