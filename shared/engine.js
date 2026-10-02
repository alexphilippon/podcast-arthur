/* Moteur commun des jeux caméra : intro, caméra, suivi du visage (positions + expressions),
   enregistrement vertical 9:16, bandeau partenaire. Chaque jeu fournit start / update / draw. */
import {fixMp4} from "./mp4fix.js";

export const FW=720, FH=1280;
const LIB="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
const WASM="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const QUAL={stable:{w:720,h:1280,cam:[1280,720],vbr:8000000},max:{w:1080,h:1920,cam:[1920,1080],vbr:16000000}};
export const DISPLAY='"Big Shoulders Display","Arial Narrow",Impact,sans-serif';
export const theme={display:DISPLAY,flat:false,bg:null};

/* ---------- Utilitaires de dessin partagés ---------- */
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const lerp=(a,b,t)=>a+(b-a)*t;
export function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
export function drawCover(c,img,x,y,w,h){
  const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height,tr=w/h;
  let sx=0,sy=0,sw=iw,sh=ih;
  if(iw/ih>tr){sw=ih*tr;sx=(iw-sw)/2;}else{sh=iw/tr;sy=(ih-sh)/2;}
  c.drawImage(img,sx,sy,sw,sh,x,y,w,h);
}
export function text(c,t,x,y,size,o={}){
  const {align="center",alpha=1,color="#fff",maxw,weight=theme.flat?400:900,stroke="rgba(8,12,40,.7)",base="middle"}=o;
  c.save();c.textAlign=align;c.textBaseline=base;c.globalAlpha=alpha;
  c.font=`${weight} ${Math.round(size*(theme.flat?1.12:1))}px ${theme.display}`;
  if(stroke){c.lineWidth=Math.max(2,size*.08);c.strokeStyle=stroke;c.lineJoin="round";maxw?c.strokeText(t,x,y,maxw):c.strokeText(t,x,y);}
  c.fillStyle=color;maxw?c.fillText(t,x,y,maxw):c.fillText(t,x,y);
  c.restore();
}
export function wrapLines(c,t,maxw){
  const words=String(t).split(/\s+/),lines=[];let cur="";
  for(const w of words){const test=cur?cur+" "+w:w;if(c.measureText(test).width>maxw&&cur){lines.push(cur);cur=w;}else cur=test;}
  if(cur)lines.push(cur);return lines;
}
export function textBlock(c,t,x,y,size,maxw,o={}){
  c.save();c.font=`${theme.flat?400:(o.weight||800)} ${Math.round(size*(theme.flat?1.12:1))}px ${theme.display}`;const lines=wrapLines(c,t,maxw);c.restore();
  const lh=(o.lh||1.05)*size,y0=y-(lines.length-1)*lh/2;
  lines.forEach((l,i)=>text(c,l,x,y0+i*lh,size,{...o,maxw}));
  return lines.length;
}
export function loadFirst(urls){
  return new Promise(res=>{
    let i=0;const im=new Image();
    im.onload=()=>res(im);
    im.onerror=()=>{i++;if(i<urls.length)im.src=urls[i];else res(null);};
    im.src=urls[0];
  });
}
export const withExts=(base,exts=["jpg","png","webp","jpeg"])=>exts.map(e=>`${base}.${e}`);
export function initials(name){return String(name).split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();}
export function store(key,val){try{if(val===undefined)return localStorage.getItem(key);localStorage.setItem(key,val);}catch(e){}return null;}

/* ---------- Interface ---------- */
const CSS=`
:root{--bg:#0B1230;--ink:#F2F4FF;--muted:#AEB8E6;--accent:#FF5A3C;--on-accent:#10163A;--line:rgba(255,255,255,.24);
 --display:${DISPLAY};--body:"Hanken Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}
html,body{height:100%;margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);overflow:hidden;-webkit-tap-highlight-color:transparent}
#stage{position:fixed;inset:0;touch-action:none}
canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#0B1230}
#video{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
#bar{position:absolute;left:0;right:0;bottom:0;padding:12px 12px calc(12px + env(safe-area-inset-bottom));display:flex;gap:8px;justify-content:center;flex-wrap:wrap;background:linear-gradient(to top,rgba(6,9,30,.85),rgba(6,9,30,0))}
button,.btnlink,.filebtn{font:600 15px var(--body);color:var(--ink);background:rgba(10,16,48,.78);border:1.5px solid var(--line);border-radius:10px;padding:0 14px;min-height:48px;cursor:pointer;backdrop-filter:blur(6px);display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
button.primary,.btnlink.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
button.rec-on{background:#D7263D;border-color:#D7263D;color:#fff}
button:disabled{opacity:.4;cursor:not-allowed}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,.btnlink:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
select,input[type=text],textarea{font:inherit;padding:8px;border-radius:8px;border:1.5px solid var(--line);background:#121A45;color:var(--ink);max-width:100%}
textarea{width:100%;min-height:120px;line-height:1.4}
#hint{position:absolute;left:50%;top:max(14px,env(safe-area-inset-top));transform:translateX(-50%);max-width:80%;text-align:center;background:rgba(6,9,30,.78);border-radius:999px;padding:8px 16px;font-size:14px}
#hint[hidden]{display:none}
.screen{position:absolute;inset:0;background:var(--bg);display:flex;flex-direction:column;justify-content:center;gap:18px;padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom));overflow:auto}
.screen[hidden]{display:none}
.screen .inner{max-width:520px;margin:0 auto;display:flex;flex-direction:column;gap:14px;width:100%}
.kicker{font:700 13px var(--display);letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
h1{font:900 clamp(46px,13vw,78px)/.9 var(--display);text-transform:uppercase;margin:0}
h2{font:800 28px/1 var(--display);text-transform:uppercase;margin:0}
p{margin:0;color:var(--muted);line-height:1.5}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.status{min-height:1.4em;color:var(--ink);font-size:14px}
.field{display:flex;gap:10px;align-items:center;font-weight:500;flex-wrap:wrap}
.field input[type=checkbox]{width:20px;height:20px;accent-color:var(--accent)}
.filebtn{position:relative;min-height:44px}
.filebtn input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%}
#preview{display:block;max-width:100%;max-height:58dvh;margin:0 auto;border-radius:12px;background:#000}
.small{font-size:13px}
`;

export function runGame(cfg){
  const GF=cfg.theme==="gfdj";
  if(GF){theme.display='"Bebas Neue","Arial Narrow",Impact,sans-serif';theme.flat=true;
    const im=new Image();im.onload=()=>{theme.bg=im;};im.src=new URL("./img/fond-sombre.jpg",import.meta.url).href;}
  const game=cfg.game,id=cfg.id||"jeu",home=cfg.home===undefined?"../":cfg.home;
  const fl=document.createElement("link");fl.rel="stylesheet";
  fl.href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900&family=Hanken+Grotesk:wght@400;500;600;700&display=swap";
  document.head.appendChild(fl);
  const st=document.createElement("style");st.textContent=CSS;document.head.appendChild(st);
  if(GF){const u=n=>new URL("./fonts/"+n,import.meta.url).href;const g=document.createElement("style");g.textContent=`
@font-face{font-family:"Bebas Neue";src:url(${u("BebasNeue-Regular.ttf")});font-weight:400}
@font-face{font-family:"Montserrat";src:url(${u("Montserrat-Regular.ttf")});font-weight:400 500}
@font-face{font-family:"Montserrat";src:url(${u("Montserrat-Bold.ttf")});font-weight:600 900}
:root{--bg:#1F294C;--ink:#fff;--muted:#D7DCE6;--accent:#E10819;--on-accent:#fff;--display:"Bebas Neue",Impact,sans-serif;--body:"Montserrat",system-ui,sans-serif}
html,body{background:#1F294C}canvas{background:#1F294C}
.screen{background:#1F294C url(${u("img/fond-sombre.jpg")}) center/cover}
h1,h2{font-weight:400;letter-spacing:.01em}h1{font-size:clamp(54px,15vw,92px);line-height:.92}.kicker{font-weight:400;font-size:18px;letter-spacing:.12em}
button,.btnlink,.filebtn{border-radius:4px;font-weight:700;background:rgba(31,41,76,.85)}
select,input[type=text],textarea{background:#203360;border-radius:4px}
#hint{border-radius:4px}`;document.head.appendChild(g);}

  const custom=(cfg.options||[]).map(o=>`<label class="field" for="opt-${o.id}">${o.label}<select id="opt-${o.id}">${o.choices.map(([v,l])=>`<option value="${v}"${v===o.def?" selected":""}>${l}</option>`).join("")}</select></label>`).join("");
  const savedPartner=store("gfdj."+id+".partner");
  document.body.innerHTML=`
<div id="stage"><video id="video" playsinline muted></video><canvas id="cv"></canvas><div id="hint" hidden></div>
 <div id="bar">
  ${home?`<a class="btnlink" id="home" href="${home}">Jeux</a>`:""}
  <button id="again" type="button" class="primary">Rejouer</button>
  <button id="flip" type="button">Retourner</button>
  <button id="rec" type="button">● Enregistrer</button>
 </div></div>
<section class="screen" id="intro"><div class="inner">
  <span class="kicker">${cfg.kicker||"Groupama-FDJ United"}</span>
  <h1>${cfg.title}</h1>
  <p>${cfg.intro||""}</p>
  ${custom}
  ${cfg.introExtra||""}
  <label class="field" for="partner">Partenaire affiché<input id="partner" type="text" maxlength="28" value="${(savedPartner!==null&&savedPartner!==undefined?savedPartner:(cfg.partner||"")).replace(/"/g,"&quot;")}" placeholder="Nom du partenaire (facultatif)"></label>
  <label class="field" for="quality">Qualité<select id="quality"><option value="stable" selected>Stable · 720 × 1280</option><option value="max">Maximale · 1080 × 1920 (plus lourd)</option></select></label>
  <input id="autorec" type="hidden" value="1">
  <label class="field" for="withmic"><input id="withmic" type="checkbox" checked> Enregistrer aussi le son (micro)</label>
  <div class="row"><button class="primary" id="startcam" type="button">Activer la caméra</button><button id="nocam" type="button">Jouer sans caméra</button></div>
  <div class="status" id="status" role="status"></div>
</div></section>
<section class="screen" id="ask" hidden><div class="inner">
  <h2>Enregistrer la vidéo ?</h2>
  <p>Voulez-vous enregistrer la vidéo ? Réponds <b>oui</b> si c'est pour livrer au CM.</p>
  <div class="row"><button class="primary" id="askyes" type="button">Oui, enregistrer</button><button id="askno" type="button">Non</button></div>
</div></section>
<section class="screen" id="result" hidden><div class="inner">
  <h2>Ta vidéo</h2>
  <video id="preview" controls playsinline></video>
  <div class="row"><a class="btnlink primary" id="dl" href="#">Télécharger</a><button id="share" type="button" hidden>Partager</button><button id="redo" type="button">Refaire</button></div>
  <p id="resinfo" class="small"></p>
</div></section>`;

  const $=i=>document.getElementById(i);
  const video=$("video"),cv=$("cv"),ctx=cv.getContext("2d");
  const view={fx:0,fy:0,sc:1,W:720,H:1280};
  const api={FW,FH,opts:{},useFace:false,camOK:false,now:0,view,restart:()=>startRound(),video,cv};
  let Q=QUAL.stable,wantAudio=true,lm=null,stream=null,facing="user",lastVT=-1,lastDet=0,wl=null,started=false,lastT=performance.now();
  let slots=[],seen=-9999,faces=[],pointer=null,autoStopAt=0,wasOver=false;

  /* ----- Caméra et suivi ----- */
  async function openCamera(){
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
    const v={facingMode:facing,width:{ideal:Q.cam[0]},height:{ideal:Q.cam[1]},frameRate:{ideal:30}};
    try{stream=await navigator.mediaDevices.getUserMedia({video:v,audio:wantAudio?{echoCancellation:true,noiseSuppression:true}:false});}
    catch(e){if(!wantAudio)throw e;wantAudio=false;stream=await navigator.mediaDevices.getUserMedia({video:v,audio:false});}
    video.srcObject=stream;await video.play();api.camOK=true;
  }
  async function loadTracker(){
    const mod=await import(LIB);
    const fs=await mod.FilesetResolver.forVisionTasks(WASM);
    const opts=d=>({baseOptions:{modelAssetPath:MODEL,delegate:d},runningMode:"VIDEO",numFaces:cfg.faces||1,outputFaceBlendshapes:true});
    try{lm=await mod.FaceLandmarker.createFromOptions(fs,opts("GPU"));}
    catch(e){lm=await mod.FaceLandmarker.createFromOptions(fs,opts("CPU"));}
  }
  const setStatus=t=>{$("status").textContent=t;};
  function readOptions(){
    Q=QUAL[$("quality").value]||QUAL.stable;wantAudio=$("withmic").checked;
    api.opts={quality:$("quality").value,autorec:$("autorec").value,partner:$("partner").value.trim()};
    for(const o of (cfg.options||[]))api.opts[o.id]=$("opt-"+o.id).value;
    api.Q=Q;store("gfdj."+id+".partner",api.opts.partner);
    if(cfg.onStart)cfg.onStart(api);
  }
  function askRec(){
    return new Promise(res=>{
      const a=$("ask");a.hidden=false;
      const done=v=>{a.hidden=true;$("autorec").value=v?"1":"0";res();};
      $("askyes").onclick=()=>done(true);$("askno").onclick=()=>done(false);
    });
  }
  $("startcam").onclick=async()=>{
    await askRec();
    readOptions();$("startcam").disabled=true;$("nocam").disabled=true;
    setStatus("Autorise la caméra quand le navigateur le demande…");
    try{await openCamera();}
    catch(e){setStatus("Caméra refusée ou indisponible. Vérifie l'autorisation du site, ou joue sans caméra.");$("startcam").disabled=false;$("nocam").disabled=false;return;}
    setStatus("Chargement du suivi du visage…");
    try{await loadTracker();}
    catch(e){lm=null;setStatus("Suivi du visage non chargé (connexion ?). Tu pourras jouer au doigt.");await new Promise(r=>setTimeout(r,1800));}
    begin();
  };
  $("nocam").onclick=async()=>{await askRec();readOptions();api.camOK=false;begin();};
  $("flip").onclick=async()=>{
    if(!api.camOK||rec.on)return;
    facing=facing==="user"?"environment":"user";
    try{await openCamera();}catch(e){facing=facing==="user"?"environment":"user";}
  };
  $("again").onclick=()=>startRound();
  async function keepAwake(){try{if("wakeLock" in navigator&&!wl){wl=await navigator.wakeLock.request("screen");wl.addEventListener("release",()=>{wl=null;});}}catch(e){}}
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&started)keepAwake();});
  async function begin(){
    keepAwake();$("intro").hidden=true;
    try{await document.fonts.load(GF?'400 24px "Bebas Neue"':'800 24px "Big Shoulders Display"');}catch(e){}
    if(game.init)await game.init(api);
    startRound();
    if(!started){started=true;requestAnimationFrame(loop);}
  }
  function startRound(){
    wasOver=false;autoStopAt=0;game.start(api);
    if(api.opts.autorec==="1"&&!rec.on)startRec();
  }

  /* ----- Pointeur (jeu au doigt) ----- */
  function toField(e){
    const r=cv.getBoundingClientRect(),s=Math.min(r.width/cv.width,r.height/cv.height);
    const px=(e.clientX-r.left-(r.width-cv.width*s)/2)/s,py=(e.clientY-r.top-(r.height-cv.height*s)/2)/s;
    return {x:px/view.sc,y:py/view.sc};
  }
  const stage=$("stage");
  stage.addEventListener("pointermove",e=>{const p=toField(e);pointer={x:p.x,y:p.y,down:pointer?pointer.down:false};});
  stage.addEventListener("pointerdown",e=>{
    if(e.target.closest("#bar"))return;
    const p=toField(e);pointer={x:p.x,y:p.y,down:true};
    if(game.isOver&&game.isOver())startRound();
  });
  const up=()=>{if(pointer)pointer.down=false;};
  stage.addEventListener("pointerup",up);stage.addEventListener("pointercancel",up);

  /* ----- Extraction des données du visage ----- */
  const KEYS=["x","y","w","h","roll","jaw","smile","squint","brow","puff","blink","tongue"];
  function extract(res,mir){
    const L=(res&&res.faceLandmarks)||[],B=(res&&res.faceBlendshapes)||[];
    const out=L.map((p,i)=>{
      const P=k=>({x:((mir?1-p[k].x:p[k].x)*view.vw-view.cx)/view.sc,y:(p[k].y*view.vh-view.cy)/view.sc});
      const a=P(234),b=P(454),top=P(10),chin=P(152),m1=P(13),m2=P(14);
      const bs={};((B[i]&&B[i].categories)||[]).forEach(c=>{bs[c.categoryName]=c.score;});
      const g=n=>bs[n]||0;
      return {
        x:(top.x+chin.x)/2,y:(top.y+chin.y)/2,cx:(a.x+b.x)/2,
        w:Math.hypot(b.x-a.x,b.y-a.y),h:Math.hypot(top.x-chin.x,top.y-chin.y),
        roll:Math.atan2(top.x-chin.x,-(top.y-chin.y)),
        mouth:{x:(m1.x+m2.x)/2,y:(m1.y+m2.y)/2},
        jaw:g("jawOpen"),smile:(g("mouthSmileLeft")+g("mouthSmileRight"))/2,
        squint:(g("eyeSquintLeft")+g("eyeSquintRight"))/2,
        brow:.5*g("browInnerUp")+.25*(g("browOuterUpLeft")+g("browOuterUpRight")),
        puff:Math.max(g("cheekPuff"),.8*g("mouthPucker"),.6*g("mouthFunnel")),
        blink:(g("eyeBlinkLeft")+g("eyeBlinkRight"))/2,tongue:g("tongueOut")
      };
    });
    out.sort((p,q)=>p.cx-q.cx);
    return out;
  }
  function smooth(list){
    return list.map((f,i)=>{
      const p=slots[i];
      if(!p){slots[i]={...f,mouth:{...f.mouth}};return slots[i];}
      const a=.6;
      for(const k of KEYS)p[k]+=(f[k]-p[k])*a;
      p.mouth.x+=(f.mouth.x-p.mouth.x)*a;p.mouth.y+=(f.mouth.y-p.mouth.y)*a;p.cx=f.cx;
      return p;
    });
  }

  /* Capture du visage (à appeler au tout début de draw, avant que le jeu ne dessine par-dessus la caméra) */
  const snap=document.createElement("canvas");snap.width=snap.height=192;
  const sctx=snap.getContext("2d");
  api.faceSnap=f=>{
    if(!f)return null;
    const s=Math.max(f.h,f.w)*1.45*view.sc,cx=f.x*view.sc,cy=f.y*view.sc;
    sctx.clearRect(0,0,192,192);
    try{sctx.drawImage(cv,cx-s/2,cy-s/2,s,s,0,0,192,192);}catch(e){return null;}
    return snap;
  };

  /* ----- Boucle ----- */
  function loop(ts){
    requestAnimationFrame(loop);
    const dt=Math.min(.05,Math.max(0,(ts-lastT)/1000));lastT=ts;api.now=ts;
    frame(ts,dt);
    if(rec.on){recordFrame();}
    const over=!!(game.isOver&&game.isOver());
    if(over&&!wasOver&&rec.on&&api.opts.autorec==="1")autoStopAt=ts+2600;
    wasOver=over;
    if(autoStopAt&&ts>autoStopAt){autoStopAt=0;stopRec();}
  }
  function drawPartner(c){
    const p=(api.opts.partner||"").trim();if(!p)return;
    c.save();c.fillStyle="rgba(8,12,44,.72)";c.fillRect(0,FH-74,FW,74);c.restore();
    text(c,"AVEC",40,FH-37,22,{align:"left",alpha:.75,stroke:false});
    text(c,p.toUpperCase(),FW/2+24,FH-37,40,{maxw:FW-210});
  }
  function frame(ts,dt){
    const live=api.camOK&&video.readyState>=2&&video.videoWidth>0;
    const vw=live?video.videoWidth:720,vh=live?video.videoHeight:1280;
    const chf=Math.min(vh,vw*16/9),cwf=chf*9/16,CW=Math.round(cwf),CH=Math.round(chf);
    if(cv.width!==CW||cv.height!==CH){cv.width=CW;cv.height=CH;}
    const mir=facing==="user";
    ctx.clearRect(0,0,CW,CH);
    view.sc=CW/FW;view.fx=0;view.fy=0;view.vw=vw;view.vh=vh;view.cx=(vw-cwf)/2;view.cy=(vh-chf)/2;view.W=CW;view.H=CH;
    if(live){ctx.save();if(mir){ctx.translate(CW,0);ctx.scale(-1,1);}ctx.drawImage(video,view.cx,view.cy,cwf,chf,0,0,CW,CH);ctx.restore();}
    else if(theme.bg){ctx.drawImage(theme.bg,0,0,CW,CH);}
    else{const g=ctx.createRadialGradient(CW/2,CH*.2,40,CW/2,CH*.2,CH*.9);g.addColorStop(0,"#14306E");g.addColorStop(1,"#0B1230");ctx.fillStyle=g;ctx.fillRect(0,0,CW,CH);}
    api.useFace=!!(api.camOK&&lm);
    if(live&&lm&&video.currentTime!==lastVT&&ts-lastDet>30){
      lastVT=video.currentTime;lastDet=ts;
      try{const res=lm.detectForVideo(video,ts),list=extract(res,mir);if(list.length){faces=smooth(list);seen=ts;}}catch(e){}
    }
    const fresh=ts-seen<700;
    if(!fresh)slots=[];
    const need=cfg.minFaces||1;
    const input={faces:fresh?faces:[],ok:api.useFace?(fresh&&faces.length>=need):true,pointer,now:ts,dt};
    if(started)game.update(dt,input,api);
    ctx.save();ctx.scale(view.sc,view.sc);
    ctx.beginPath();ctx.rect(0,0,FW,FH);ctx.clip();
    if(started){game.draw(ctx,api,input);drawPartner(ctx);}
    ctx.restore();
    let h=(game.hint&&game.hint(api,input))||"";
    if(!h&&api.useFace&&!input.ok)h=need>1?"Il faut "+need+" visages dans le cadre":"Place ton visage dans le cadre";
    if(!h&&game.isOver&&game.isOver())h="Touche l'écran ou « Rejouer »";
    const el=$("hint");if(h){el.hidden=false;el.textContent=h;}else el.hidden=true;
  }

  /* ----- Enregistrement ----- */
  const rec={on:false,mr:null,chunks:[],canvas:document.createElement("canvas"),t0:0,timer:null,url:null,file:null,failed:false,done:false,elapsed:0};
  rec.ctx=rec.canvas.getContext("2d");
  api.recording=()=>rec.on;
  function pickMime(){
    if(!window.MediaRecorder)return null;
    const c=["video/mp4;codecs=avc1.640028,mp4a.40.2","video/mp4;codecs=avc1.4D0028,mp4a.40.2","video/mp4;codecs=avc1.42E01E,mp4a.40.2","video/mp4","video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"];
    return c.find(m=>MediaRecorder.isTypeSupported(m))||"";
  }
  function recordFrame(){
    rec.ctx.imageSmoothingQuality="high";rec.ctx.drawImage(cv,0,0,rec.canvas.width,rec.canvas.height);
  }
  const fmt=ms=>{const s=Math.floor(ms/1000);return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");};
  function startRec(){
    const mime=pickMime();
    if(mime===null){return;}
    rec.canvas.width=Q.w;rec.canvas.height=Q.h;recordFrame();
    const out=rec.canvas.captureStream(30);
    if(stream)stream.getAudioTracks().forEach(t=>out.addTrack(t));
    rec.chunks=[];
    const o={videoBitsPerSecond:Q.vbr,audioBitsPerSecond:192000};if(mime)o.mimeType=mime;
    rec.mr=new MediaRecorder(out,o);
    rec.mr.ondataavailable=e=>{if(e.data&&e.data.size)rec.chunks.push(e.data);};
    rec.failed=false;rec.done=false;
    rec.mr.onerror=()=>{rec.failed=true;stopRec();};
    rec.mr.onstop=()=>{if(rec.on){rec.failed=true;stopRec();}if(!rec.done){rec.done=true;showResult();}};
    rec.mr.start(1000);rec.on=true;rec.t0=Date.now();
    const b=$("rec");b.classList.add("rec-on");b.textContent="■ 00:00";$("flip").disabled=true;
    rec.timer=setInterval(()=>{b.textContent="■ "+fmt(Date.now()-rec.t0);},500);
  }
  function stopRec(){
    if(!rec.on)return;
    rec.elapsed=Date.now()-rec.t0;rec.on=false;clearInterval(rec.timer);
    const b=$("rec");b.classList.remove("rec-on");b.textContent="● Enregistrer";$("flip").disabled=false;
    try{rec.mr.stop();}catch(e){}
  }
  async function showResult(){
    const type=(rec.mr&&rec.mr.mimeType)||"video/webm",ext=type.includes("mp4")?"mp4":"webm";
    const d=new Date(),pad=n=>String(n).padStart(2,"0");
    const name=`${id}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
    let blob=new Blob(rec.chunks,{type}),fixed=false;
    if(ext==="mp4"){try{const f=await fixMp4(blob);if(f&&f.size>0){blob=f;fixed=true;}}catch(e){}}
    if(rec.url)URL.revokeObjectURL(rec.url);
    rec.url=URL.createObjectURL(blob);
    rec.file=new File([blob],name,{type:ext==="mp4"?"video/mp4":type});
    $("preview").src=rec.url;
    const dl=$("dl");dl.href=rec.url;dl.setAttribute("download",name);
    $("share").hidden=!(navigator.canShare&&navigator.canShare({files:[rec.file]}));
    const info="Format Reel 9:16, "+rec.canvas.width+" × "+rec.canvas.height+", "+ext.toUpperCase()+(fixed?" standard":"")+", "+(blob.size/1048576).toFixed(1)+" Mo. Durée enregistrée : "+fmt(rec.elapsed||0)+"."+(ext==="webm"?" Ce navigateur ne produit pas de MP4 : Instagram peut refuser le WebM, réessaie avec Chrome à jour ou convertis le fichier.":"")+(rec.failed?" ⚠ L'enregistrement a été interrompu par le navigateur avant la fin.":"");
    $("resinfo").textContent=info;
    const pv=$("preview");
    pv.onloadedmetadata=()=>{const dd=pv.duration,real=(rec.elapsed||0)/1000;if(isFinite(dd)&&real>3&&dd<real*.8)$("resinfo").textContent=info+" ⚠ La vidéo ne dure que "+Math.round(dd)+" s sur "+Math.round(real)+" s : l'encodage du téléphone a décroché. Choisis la qualité Stable.";};
    $("result").hidden=false;
  }
  $("rec").onclick=()=>{rec.on?stopRec():startRec();};
  $("share").onclick=async()=>{try{await navigator.share({files:[rec.file],title:cfg.title});}catch(e){}};
  $("redo").onclick=()=>{$("preview").pause();$("result").hidden=true;startRound();};

  if(cfg.onIntro)cfg.onIntro(api,$);
  api.$=$;
  return api;
}
