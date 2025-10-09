// Copyright — todos os direitos reservados a Henrique
import { auth, signin, signout, db, storage, getUserRoles } from './firebase.js';
import { collection, onSnapshot, query, orderBy, limit, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getDownloadURL, ref, listAll } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const tabs = document.querySelectorAll('#tabs .tab');
const views = document.querySelectorAll('.view');
const content = document.getElementById('content');

// BASE da API: em localhost usamos rewrites ("/api" via Hosting), em produção Cloud Functions absoluto
const API_BASE = (location.hostname === "localhost" || location.hostname.startsWith("127."))
  ? ''
  : "https://us-central1-uz-lang-studio.cloudfunctions.net";

// Ink underline element for tabs
const nav = document.getElementById('tabs');
const ink = document.createElement('div');
ink.className = 'ink';
nav.appendChild(ink);

function moveInk(target){
  const r = target.getBoundingClientRect();
  const nr = nav.getBoundingClientRect();
  ink.style.width = r.width + 'px';
  ink.style.transform = `translateX(${r.left - nr.left + nav.scrollLeft}px)`;
}

function setActive(viewId) {
  tabs.forEach(btn => {
    const v = btn.getAttribute('data-view');
    const is = v === viewId;
    btn.classList.toggle('active', is);
    btn.setAttribute('aria-selected', String(is));
    if (is) moveInk(btn);
  });
  views.forEach(v => {
    const active = v.id === `view-${viewId}`;
    v.hidden = !active;
    v.classList.toggle('active', active);
  });
  content.focus();
}

nav.addEventListener('click', (e) => {
  const target = e.target.closest('.tab');
  if (target) {
    if (target.dataset.view === 'admin') { window.location.href = '/wp-admin.html'; return; }
    setActive(target.dataset.view);
  }
});

window.addEventListener('resize', () => {
  const current = document.querySelector('#tabs .tab.active');
  if (current) moveInk(current);
});

setActive('dashboard');

// Starfield minimal
(function starfield(){
  const cvs = document.getElementById('starfield');
  const ctx = cvs.getContext('2d');
  let stars = [];
  function resize(){ cvs.width = window.innerWidth; cvs.height = window.innerHeight; }
  function init(){
    stars = Array.from({length: 90}, () => ({
      x: Math.random()*cvs.width,
      y: Math.random()*cvs.height,
      z: 0.2 + Math.random()*0.8,
    }));
  }
  function draw(){
    ctx.clearRect(0,0,cvs.width,cvs.height);
    ctx.fillStyle = 'rgba(219,164,74,0.22)';
    for (const s of stars) {
      const r = s.z * 1.2;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI*2); ctx.fill();
      s.y += 0.08 * s.z; if (s.y > cvs.height) s.y = 0;
    }
    requestAnimationFrame(draw);
  }
  resize(); init(); draw(); window.addEventListener('resize', () => { resize(); init(); });
})();

// Toast helper
const toasts = document.createElement('div');
toasts.className = 'toast-container';
document.body.appendChild(toasts);
function showToast(msg, type=''){ const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = msg; toasts.appendChild(el); setTimeout(()=>{ el.remove(); }, 3000); }

// Auth UI
const btnSignin = document.getElementById('btn-signin');
const btnSignout = document.getElementById('btn-signout');
const userInfo = document.getElementById('user-info');
btnSignin.addEventListener('click', () => signin());
btnSignout.addEventListener('click', () => signout());

let currentRoles = [];

auth.onAuthStateChanged(async (user) => {
  if (user) {
    btnSignin.hidden = true; btnSignout.hidden = false;
    userInfo.textContent = user.displayName || user.email;
    currentRoles = await getUserRoles(user.uid);
    // Dev bootstrap de roles no emulador: se sem roles, atribui admin/editor
    if ((location.hostname === "localhost" || location.hostname === "127.0.0.1") && (!currentRoles.length)) {
      try {
        await setDoc(doc(db, "users", user.uid), { roles: ["admin", "editor"], updatedAt: new Date().toISOString() }, { merge: true });
        currentRoles = ["admin", "editor"];
        showToast("Roles de dev aplicadas: admin/editor", "success");
      } catch {}
    }
    document.getElementById('roles-alert').hidden = currentRoles.includes('admin') || currentRoles.includes('editor');
    document.getElementById('channel-admin')?.removeAttribute('hidden');
  } else {
    btnSignin.hidden = false; btnSignout.hidden = true;
    userInfo.textContent = '';
    currentRoles = [];
    document.getElementById('channel-admin')?.setAttribute('hidden','');
  }
  refreshData();
  fetchChannels();
});

// Dashboard stats
function refreshData(){
  const stats = document.getElementById('stats');
  const qVideos = query(collection(db, 'videos'), orderBy('createdAt', 'desc'), limit(5));
  onSnapshot(qVideos, (snap) => {
    const total = snap.size;
    const ready = snap.docs.filter(d => d.data().status === 'ready').length;
    stats.innerHTML = `<div class="row"><div class="badge">Vídeos: ${total}</div><div class="badge gold">Prontos: ${ready}</div></div>`;
  });
}

// Dashboard charts (mock data for now)
function initCharts(){
  if (!(window.Chart)) return;
  const gold = '#DBA44A';
  // Retenção
  const c1 = document.getElementById('chart-retencao');
  if (c1 && !c1._chart) {
    c1._chart = new Chart(c1, {
      type: 'line', data: { labels: Array.from({length:20}, (_,i)=>i+1), datasets: [{ label:'Retenção %', data: Array.from({length:20}, (_,i)=>Math.max(30, 100 - i*3 + (i%5)*2)), borderColor: gold, tension:.3 }] }, options: { plugins:{ legend:{ display:false }}, scales:{ x:{ grid:{ color:'#222'}}, y:{ grid:{ color:'#222'}}}}
    });
  }
  // Crescimento
  const c2 = document.getElementById('chart-crescimento');
  if (c2 && !c2._chart) {
    c2._chart = new Chart(c2, {
      type: 'bar', data: { labels: ['Jan','Fev','Mar','Abr','Mai','Jun'], datasets:[{ label:'Views', data:[120,180,160,220,300,280], backgroundColor: 'rgba(219,164,74,.35)', borderColor: gold }] }, options:{ plugins:{ legend:{ display:false }}, scales:{ x:{ grid:{ color:'#222'}}, y:{ grid:{ color:'#222'}}}}
    });
  }
  // Idiomas
  const c3 = document.getElementById('chart-idiomas');
  if (c3 && !c3._chart) {
    c3._chart = new Chart(c3, {
      type: 'doughnut', data: { labels:['PT','EN','ES'], datasets:[{ data:[60,25,15], backgroundColor:['#1f2937', 'rgba(219,164,74,.6)', '#0ea5e9'] }] }, options:{ plugins:{ legend:{ position:'bottom', labels:{ color:'#dcdcdc' }}} }
    });
  }
}
setTimeout(initCharts, 300);

// Ingest form
const formIngest = document.getElementById('form-ingest');
const ingestMsg = document.getElementById('ingest-msg');
formIngest?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = new FormData(formIngest).get('url');
  ingestMsg.textContent = 'Enviando...';
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Faça login para criar jobs');
    const idToken = await user.getIdToken();
    const r = await fetch(apiUrl('/api/ingest'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ url })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Falha');
    ingestMsg.textContent = `Criado job ${j.jobId} para vídeo ${j.videoId}`;
    (document.getElementById('youtube-input')).value='';
    showToast('Job criado com sucesso!','success');
  } catch (e) {
    ingestMsg.textContent = `Erro: ${e.message}`;
    showToast(e.message || 'Erro ao criar job','error');
  }
});

// Videos list
const videosList = document.getElementById('videos-list');
const qVideos = query(collection(db, 'videos'), orderBy('createdAt', 'desc'), limit(20));
onSnapshot(qVideos, async (snap) => {
  const items = await Promise.all(snap.docs.map(async d => {
    const v = d.data();
    const id = d.id;
    const thumb = v.thumbnailUrl || await getSafeThumb(id);
    const srtPtRef = ref(storage, `subs/${id}/pt.srt`);
    const srtEnRef = ref(storage, `subs/${id}/en.srt`);
    const srtEsRef = ref(storage, `subs/${id}/es.srt`);
    const mp3EnRef = ref(storage, `dubs/${id}/en.mp3`);
    const mp3EsRef = ref(storage, `dubs/${id}/es.mp3`);

    async function urlOrNull(r) { try { return await getDownloadURL(r);} catch { return null; } }

    const [urlPt, urlEn, urlEs, urlMp3En, urlMp3Es] = await Promise.all([
      urlOrNull(srtPtRef), urlOrNull(srtEnRef), urlOrNull(srtEsRef), urlOrNull(mp3EnRef), urlOrNull(mp3EsRef)
    ]);

    return `
      <div class="video-item">
        <img class="thumb ${!v.title?'skeleton':''}" src="${thumb}" alt="Thumbnail" />
        <div>
          <div><strong>${v.title || id}</strong></div>
          <div class="muted">${v.durationSec ? (v.durationSec+'s') : ''}</div>
          <div class="row">
            <span class="badge ${v.status==='ready'?'gold':''}">${v.status}</span>
            ${urlPt?`<a class="btn" href="${urlPt}">PT.srt</a>`:''}
            ${urlEn?`<a class="btn" href="${urlEn}">EN.srt</a>`:''}
            ${urlEs?`<a class="btn" href="${urlEs}">ES.srt</a>`:''}
            ${urlMp3En?`<a class="btn" href="${urlMp3En}">EN.mp3</a>`:''}
            ${urlMp3Es?`<a class="btn" href="${urlMp3Es}">ES.mp3</a>`:''}
          </div>
        </div>
        <div class="muted">${v.langs?.en?'EN':''} ${v.langs?.es?'ES':''}</div>
      </div>`;
  }));
  videosList.innerHTML = items.join('');
});

async function getSafeThumb(id){
  try { return await getDownloadURL(ref(storage, `thumbs/${id}.jpg`)); } catch { return 'https://i.ytimg.com/vi/'+id+'/mqdefault.jpg'; }
}

// Channels
const channelsList = document.getElementById('channels-list');
const formChannel = document.getElementById('form-channel');
const channelMsg = document.getElementById('channel-msg');
async function fetchChannels() {
  try {
    const r = await fetch(apiUrl('/api/channels'));
    const j = await r.json();
    const items = (j.items||[]).map(ch => `
      <div class="channel-item">
        <div class="avatar" aria-hidden="true"></div>
        <div>
          <div><strong>${ch.title || ch.id}</strong></div>
          <div class="muted">Inscritos: ${ch.stats?.subscribers||0} · Views 30d: ${ch.stats?.views||0} · Vídeos: ${ch.stats?.videos||0}</div>
        </div>
        <div class="badge">${ch.id}</div>
      </div>`).join('');
    channelsList.innerHTML = items || '<div class="muted">Nenhum canal conectado</div>';
  } catch (e) {
    channelsList.innerHTML = '<div class="muted">Falha ao carregar canais</div>';
  }
}
formChannel?.addEventListener('submit', async (e) => {
  e.preventDefault();
  channelMsg.textContent = 'Conectando...';
  try {
    const user = auth.currentUser; if (!user) throw new Error('Faça login');
    const idToken = await user.getIdToken();
    const body = {
      channelId: document.getElementById('channel-id').value.trim(),
      title: document.getElementById('channel-title').value.trim()
    };
    const r = await fetch(apiUrl('/api/channels'), { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${idToken}` }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error||'Falha');
    showToast('Canal conectado!','success');
    channelMsg.textContent = 'OK';
    fetchChannels();
  } catch (e) {
    channelMsg.textContent = `Erro: ${e.message}`;
    showToast(e.message||'Erro ao conectar canal','error');
  }
});

// Jobs list (only editor/admin)
const jobsList = document.getElementById('jobs-list');
function watchJobs(){
  if (!(currentRoles.includes('admin') || currentRoles.includes('editor'))) {
    jobsList.innerHTML = '<div class="muted">Sem permissão para listar jobs.</div>';
    return () => {};
  }
  const qJobs = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'), limit(20));
  return onSnapshot(qJobs, (snap) => {
    jobsList.innerHTML = snap.docs.map(d => {
      const j = d.data();
      const logs = (j.log||[]).slice(-4).map(l=>`<div class=\"muted\">• ${l}</div>`).join('');
      return `<div class="job-item">
        <div class="badge">${j.videoId}</div>
        <div>
          <div><strong>${j.status}</strong> — passo: ${j.currentStep}</div>
          <div>${logs}</div>
        </div>
        <div class="muted">${new Date(j.updatedAt?.toDate?.()||Date.now()).toLocaleString()}</div>
      </div>`;
    }).join('');
  });
}
let unsubsJobs = () => {};
setInterval(() => { if (unsubsJobs) { unsubsJobs(); } unsubsJobs = watchJobs(); }, 5000);

// Transcripts
const transcriptText = document.getElementById('transcript-text');
const transcriptMsg = document.getElementById('transcript-msg');
const formTranscript = document.getElementById('form-transcript');
formTranscript?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('transcript-id').value.trim();
  transcriptMsg.textContent = 'Carregando...';
  try {
    // Preferir Storage: transcript.txt
    const txtRef = ref(storage, `transcripts/${id}/pt.txt`);
    const url = await getDownloadURL(txtRef);
    const body = await fetch(url).then(r=>r.text());
    transcriptText.value = body;
    transcriptMsg.textContent = 'OK';
  } catch (e) {
    transcriptMsg.textContent = 'Transcrição não encontrada';
    transcriptText.value = '';
  }
});

// Downloads & TTS
function bindDownloadBtn(btnId, path){
  const el = document.getElementById(btnId);
  el?.addEventListener('click', async () => {
    const id = document.getElementById('transcript-id').value.trim();
    if (!id) return showToast('Informe o ID do vídeo','error');
    try {
      const url = await getDownloadURL(ref(storage, path.replace('{id}', id)));
      window.open(url, '_blank');
    } catch { showToast('Arquivo não disponível ainda','error'); }
  });
}
bindDownloadBtn('btn-srt-pt', 'subs/{id}/pt.srt');
bindDownloadBtn('btn-srt-en', 'subs/{id}/en.srt');
bindDownloadBtn('btn-srt-es', 'subs/{id}/es.srt');
bindDownloadBtn('btn-txt-pt', 'transcripts/{id}/pt.txt');
bindDownloadBtn('btn-json', 'transcripts/{id}/transcript.json');

async function callTTS(lang){
  try {
    const user = auth.currentUser; if (!user) throw new Error('Faça login');
    const idToken = await user.getIdToken();
    const videoId = document.getElementById('transcript-id').value.trim();
    if (!videoId) throw new Error('Informe o ID do vídeo');
    const r = await fetch(apiUrl('/api/tts'), { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${idToken}` }, body: JSON.stringify({ videoId, lang }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error||'Falha');
    showToast('TTS iniciado! Job '+j.jobId,'success');
  } catch (e) {
    showToast(e.message||'Erro ao iniciar TTS','error');
  }
}

document.getElementById('btn-tts-en')?.addEventListener('click', ()=>callTTS('en'));
document.getElementById('btn-tts-es')?.addEventListener('click', ()=>callTTS('es'));

// Analytics
const analyticsForm = document.getElementById('form-analytics');
const analyticsCanvas = document.getElementById('analytics-canvas');
const analyticsMsg = document.getElementById('analytics-msg');
analyticsForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('analytics-id').value.trim();
  analyticsMsg.textContent = 'Buscando...';
  try {
    const r = await fetch(`/api/analytics/${encodeURIComponent(id)}`);
    const j = await r.json();
    drawLine(analyticsCanvas, j.series || []);
    analyticsMsg.textContent = 'OK';
  } catch (e) { analyticsMsg.textContent = 'Erro ao buscar'; }
});

function drawLine(canvas, series){
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.clientWidth; const H = canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle = '#DBA44A'; ctx.lineWidth = 2; ctx.beginPath();
  const maxX = Math.max(1, ...series.map(p=>p.t));
  const maxY = Math.max(1, ...series.map(p=>p.r));
  series.forEach((p,i)=>{
    const x = (p.t/maxX) * (W-20) + 10; const y = H - (p.r/maxY) * (H-20) - 10;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
}

// Settings
document.getElementById('cfg-project').textContent = (auth.app?.options?.projectId)||'(defina FIREBASE_PROJECT_ID)';
document.getElementById('cfg-tts').textContent = `TTS_ENABLED=${(window.env?.TTS_ENABLED)||'false'}`;

// Particles minimal (yellow, from brand logo)
(function particles(){
  const cvs = document.getElementById('particles');
  if (!cvs) return; // safety
  const ctx = cvs.getContext('2d');
  let W = 0, H = 0;
  function resize(){ W = cvs.width = window.innerWidth; H = cvs.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  const GOLD = { r: 219, g: 164, b: 74 };
  const MAX = 220;
  const particles = [];

  function emitterCenter(){
    const el = document.querySelector('.brand .logo');
    if (!el) return { x: 24, y: 24 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2 };
  }

  function spawn(n=2){
    const { x, y } = emitterCenter();
    for (let i=0;i<n;i++){
      if (particles.length >= MAX) { particles.shift(); }
      const speed = 0.3 + Math.random()*0.9; // drift right
      particles.push({
        x: x + (Math.random()*8 - 4),
        y: y + (Math.random()*8 - 4),
        vx: speed,
        vy: (Math.random()-0.5)*0.5,
        life: 60 + Math.random()*90,
        age: 0,
        size: 0.8 + Math.random()*1.4
      });
    }
  }

  let last = performance.now();
  function draw(now){
    const dt = Math.min(32, now - last); last = now;
    // spawn rate ~ 120/s
    if (particles.length < MAX) spawn(Math.random()>0.5?2:1);

    ctx.clearRect(0,0,W,H);
    ctx.globalCompositeOperation = 'lighter';
    for (let i=particles.length-1; i>=0; i--){
      const p = particles[i];
      p.x += p.vx * (dt/16.7);
      p.y += p.vy * (dt/16.7);
      p.age += dt/16.7;
      const t = Math.max(0, 1 - p.age/p.life);
      if (t <= 0 || p.x < -10 || p.x > W+10 || p.y < -10 || p.y > H+10) { particles.splice(i,1); continue; }
      ctx.beginPath();
      ctx.fillStyle = `rgba(${GOLD.r},${GOLD.g},${GOLD.b},${0.15 + 0.55*t})`;
      ctx.shadowColor = `rgba(${GOLD.r},${GOLD.g},${GOLD.b},${0.35*t})`;
      ctx.shadowBlur = 8 * t + 2;
      ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();

// Translations UI
const viewTranslations = document.getElementById('view-translations');
if (viewTranslations) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="row">
      <label class="field">
        <span class="label">YouTube ID</span>
        <input id="translate-id" type="text" placeholder="ID do vídeo" />
      </label>
      <button id="btn-tr-en" class="btn btn-primary">Traduzir para EN</button>
      <button id="btn-tr-es" class="btn btn-primary">Traduzir para ES</button>
      <span id="translate-msg" class="muted" role="status"></span>
    </div>
    <div class="row">
      <button id="btn-dl-en-srt" class="btn">Baixar EN.srt</button>
      <button id="btn-dl-es-srt" class="btn">Baixar ES.srt</button>
      <button id="btn-dl-en-json" class="btn">Baixar EN.json</button>
      <button id="btn-dl-es-json" class="btn">Baixar ES.json</button>
    </div>
  `;
  viewTranslations.appendChild(card);

  async function callTranslate(lang) {
    const msg = document.getElementById('translate-msg');
    try {
      const user = auth.currentUser; if (!user) throw new Error('Faça login');
      const idToken = await user.getIdToken();
      const videoId = document.getElementById('translate-id').value.trim();
      if (!videoId) throw new Error('Informe o ID do vídeo');
      const r = await fetch(apiUrl('/api/translate'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` }, body: JSON.stringify({ videoId, lang }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Falha');
      msg.textContent = `Job ${j.jobId} criado`;
      showToast('Tradução solicitada! Job '+j.jobId, 'success');
    } catch (e) {
      showToast(e.message || 'Erro ao solicitar tradução', 'error');
    }
  }
  document.getElementById('btn-tr-en')?.addEventListener('click', ()=>callTranslate('en'));
  document.getElementById('btn-tr-es')?.addEventListener('click', ()=>callTranslate('es'));

  function bindDl(btnId, path) {
    const el = document.getElementById(btnId);
    el?.addEventListener('click', async () => {
      const id = document.getElementById('translate-id').value.trim();
      if (!id) return showToast('Informe o ID do vídeo','error');
      try { const url = await getDownloadURL(ref(storage, path.replace('{id}', id))); window.open(url, '_blank'); }
      catch { showToast('Arquivo não disponível ainda','error'); }
    });
  }
  bindDl('btn-dl-en-srt', 'subs/{id}/en.srt');
  bindDl('btn-dl-es-srt', 'subs/{id}/es.srt');
  bindDl('btn-dl-en-json', 'transcripts/{id}/en.json');
  bindDl('btn-dl-es-json', 'transcripts/{id}/es.json');
}

// Dubs UI
const viewDubs = document.getElementById('view-dubs');
if (viewDubs) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="row">
      <label class="field">
        <span class="label">YouTube ID</span>
        <input id="dubs-id" type="text" placeholder="ID do vídeo" />
      </label>
      <button id="btn-dub-en" class="btn btn-primary">Gerar Dublagem EN</button>
      <button id="btn-dub-es" class="btn btn-primary">Gerar Dublagem ES</button>
      <span id="dubs-msg" class="muted" role="status"></span>
    </div>
    <div class="row">
      <button id="btn-dl-en-mp3" class="btn">Baixar EN.mp3</button>
      <button id="btn-dl-es-mp3" class="btn">Baixar ES.mp3</button>
    </div>
  `;
  viewDubs.appendChild(card);

  function callDub(lang){
    const input = document.getElementById('dubs-id');
    const transcriptInput = document.getElementById('transcript-id');
    if (input && !input.value && transcriptInput && transcriptInput.value) { input.value = transcriptInput.value; }
    const idEl = document.getElementById('dubs-id');
    const prev = document.getElementById('transcript-id');
    if (idEl && !idEl.value && prev?.value) idEl.value = prev.value;
    const id = idEl.value.trim();
    if (!id) return showToast('Informe o ID do vídeo','error');
    callTTS(lang);
  }
  document.getElementById('btn-dub-en')?.addEventListener('click', ()=>callDub('en'));
  document.getElementById('btn-dub-es')?.addEventListener('click', ()=>callDub('es'));

  function bindDl(btnId, path) {
    const el = document.getElementById(btnId);
    el?.addEventListener('click', async () => {
      const id = document.getElementById('dubs-id').value.trim();
      if (!id) return showToast('Informe o ID do vídeo','error');
      try { const url = await getDownloadURL(ref(storage, path.replace('{id}', id))); window.open(url, '_blank'); }
      catch { showToast('Arquivo não disponível ainda','error'); }
    });
  }
  bindDl('btn-dl-en-mp3', 'dubs/{id}/en.mp3');
  bindDl('btn-dl-es-mp3', 'dubs/{id}/es.mp3');
}
// Voices UI
const viewVoices = document.getElementById('view-voices');
if (viewVoices) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="row">
      <label class="field">
        <span class="label">Nome da Voz</span>
        <input id="voice-name" type="text" placeholder="Ex: UZ Golden" />
      </label>
      <label class="field">
        <span class="label">Idioma</span>
        <select id="voice-lang">
          <option value="en">EN</option>
          <option value="es">ES</option>
          <option value="pt">PT</option>
        </select>
      </label>
      <label class="field">
        <span class="label">Gênero</span>
        <select id="voice-gender">
          <option value="neutral">Neutro</option>
          <option value="female">Feminino</option>
          <option value="male">Masculino</option>
        </select>
      </label>
    </div>
    <div class="row">
      <label class="field" style="flex:1">
        <span class="label">Arquivos de treino (URLs http(s) ou paths do Storage; um por linha)</span>
        <textarea id="voice-files" rows="3" placeholder="https://exemplo.com/treino1.wav\ntranscripts/abc123/voz.wav"></textarea>
      </label>
      <label class="field" style="max-width:240px; align-items:center;">
        <span class="label">Consentimento</span>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="voice-consent" type="checkbox" />
          <span class="muted">Tenho autorização do dono da voz</span>
        </div>
      </label>
    </div>
    <div class="row">
      <button id="btn-voice-add" class="btn btn-primary">Clonar voz (ElevenLabs)</button>
      <button id="btn-tts-dev" class="btn">Gerar TTS (DEV)</button>
      <button id="btn-voices-refresh" class="btn">Atualizar lista</button>
      <span id="voice-msg" class="muted"></span>
    </div>
    <div class="row">
      <div id="voices-list" class="list"></div>
    </div>
  `;
  viewVoices.appendChild(card);

  // Helper para base da API
  function apiUrl(path){ const base = (window.env?.API_BASE ?? API_BASE)||''; return base ? `${base}${path}` : path; }
  function parseTrainingFiles(){
    const lines = (document.getElementById('voice-files').value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    return lines.map(s => s.startsWith('http') ? { url: s } : { storagePath: s });
  }
  
  async function fetchVoices(){
    const list = document.getElementById('voices-list');
    list.innerHTML = '<div class="muted">Carregando vozes...</div>';
    try {
      const user = auth.currentUser; const idToken = user ? await user.getIdToken() : null;
      const r = await fetch(apiUrl('/api/bridge/voices'), { headers: idToken ? { 'Authorization': `Bearer ${idToken}` } : {} });
      const ct = r.headers.get('content-type')||'';
      if (!r.ok || !ct.includes('application/json')) {
        const txt = await r.text().catch(()=> '');
        throw new Error(!r.ok ? `Falha ao listar (${r.status})` : 'Resposta não-JSON do servidor');
      }
      const j = await r.json();
      const voices = j.items||[];
      const profiles = j.profiles||[];
      const items = `
        <div class="item row" style="font-weight:600;">Vozes ElevenLabs</div>
        ${voices.map(v => `
          <div class="item row">
            <div class="badge">EL</div>
            <div style="flex:1"><strong>${v.name||v.voice_id||v.id}</strong><div class="muted">${v.voice_id||v.id}</div></div>
            <button class="btn btn-sm btn-voice-status" data-voice-id="${v.voice_id||v.id}">Ver status</button>
          </div>
        `).join('')}
        <div class="item row" style="font-weight:600; margin-top:8px;">Perfis Internos</div>
        ${profiles.length? profiles.map(p => `
          <div class="item row">
            <div class="badge">INT</div>
            <div style="flex:1"><strong>${p.name||p.profile_id}</strong><div class="muted">${p.profile_id} ⇢ ${p.voice_id||'-'}</div></div>
            ${p.voice_id?`<button class="btn btn-sm btn-voice-status" data-voice-id="${p.voice_id}">Ver status</button>`:''}
          </div>
        `).join('') : '<div class="muted">Nenhum perfil ainda</div>'}
      `;
      list.innerHTML = items || '<div class="muted">Sem vozes</div>';

      // Bind status buttons
      list.querySelectorAll('.btn-voice-status').forEach(btn => {
        btn.addEventListener('click', () => pollVoiceStatus(btn.getAttribute('data-voice-id')));
      });
    } catch(e) { list.innerHTML = `<div class="muted">${e.message||'Falha ao carregar vozes'}</div>`; showToast(e.message||'Erro ao listar vozes','error'); }
  }
  fetchVoices();

  async function pollVoiceStatus(voiceId){
    try {
      const user = auth.currentUser; const idToken = user ? await user.getIdToken() : null;
      if (!idToken) { showToast('Faça login para ver status','error'); return; }
      let attempts = 0; let delay = 500; const max = 5;
      while (attempts < max) {
        const r = await fetch(apiUrl(`/api/bridge/voices/${voiceId}/status`), { headers: { 'Authorization': `Bearer ${idToken}` } });
        const ct = r.headers.get('content-type')||'';
        if (!r.ok || !ct.includes('application/json')) {
          const txt = await r.text().catch(()=> '');
          throw new Error(!r.ok ? `Falha ao consultar (${r.status})` : 'Resposta não-JSON do servidor');
        }
        const j = await r.json();
        const state = j.voice?.status || j.voice?.state || j.voice?.training_state || j.voice?.status_description || 'desconhecido';
        showToast(`Status ${voiceId}: ${state}`,'');
        if (String(state).toLowerCase().includes('ready') || String(state).toLowerCase().includes('trained')) break;
        await new Promise(res => setTimeout(res, delay)); delay = Math.min(Math.floor(delay*1.7), 5000); attempts++;
      }
    } catch(e){ showToast(e.message||'Erro ao consultar status','error'); }
  }

  document.getElementById('btn-voices-refresh')?.addEventListener('click', fetchVoices);
  document.getElementById('btn-tts-dev')?.addEventListener('click', async () => {
    try {
      const user = auth.currentUser; if (!user) return showToast('Faça login','error');
      const idToken = await user.getIdToken();
      const r = await fetch(apiUrl('/api/bridge/tts/generate'), {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ text: 'Teste de TTS EN', format: 'mp3', project: 'default' })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Falha ao gerar TTS');
      showToast('TTS gerado! Abra Biblioteca para baixar.', 'success');
    } catch (e) {
      showToast(e.message || 'Erro ao gerar TTS', 'error');
    }
  });

  // Gate de consentimento
  const btnClone = document.getElementById('btn-voice-add');
  const chkConsent = document.getElementById('voice-consent');
  function updateCloneGate(){ btnClone.disabled = !chkConsent.checked; }
  chkConsent.addEventListener('change', updateCloneGate); updateCloneGate();

  document.getElementById('btn-voice-add')?.addEventListener('click', async ()=>{
    const msg = document.getElementById('voice-msg');
    try {
      const user = auth.currentUser; if (!user) throw new Error('Faça login');
      const idToken = await user.getIdToken();
      const trainingFiles = (document.getElementById('voice-files').value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      const body = {
        name: document.getElementById('voice-name').value.trim(),
        lang: document.getElementById('voice-lang').value,
        gender: document.getElementById('voice-gender').value,
        consent: document.getElementById('voice-consent').checked,
        training_files: trainingFiles
      };
      if (!body.name) throw new Error('Informe o nome da voz');
      if (!body.consent) throw new Error('Marque o consentimento');
      if (!body.training_files.length) throw new Error('Inclua ao menos um arquivo de treino');
      msg.textContent = 'Enviando para treinamento...';
      const r = await fetch(apiUrl('/api/bridge/voices/clone'), { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${idToken}` }, body: JSON.stringify(body) });
      const ct = r.headers.get('content-type')||'';
      if (!r.ok || !ct.includes('application/json')) {
        const txt = await r.text().catch(()=> '');
        throw new Error(!r.ok ? `Falha ao clonar (${r.status})` : 'Resposta não-JSON do servidor');
      }
      const j = await r.json();
      msg.textContent = `Voz clonada (profile ${j.profile_id})`; showToast('Clonagem iniciada/registrada!','success');
      document.getElementById('voice-name').value = '';
      document.getElementById('voice-files').value = '';
      document.getElementById('voice-consent').checked = false; updateCloneGate();
      fetchVoices();
    } catch(e) { msg.textContent = e.message||'Erro'; showToast(msg.textContent,'error'); }
  });
}

// Library UI
const viewLibrary = document.getElementById('view-library');
if (viewLibrary) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="row">
      <label class="field">
        <span class="label">YouTube ID</span>
        <input id="lib-id" type="text" placeholder="ID do vídeo" />
      </label>
      <button id="btn-lib-list" class="btn btn-primary">Listar artefatos</button>
      <span id="lib-msg" class="muted"></span>
    </div>
    <div id="lib-items" class="grid"></div>
  `;
  viewLibrary.appendChild(card);

  function videoIdOrFromOthers(){
    const el = document.getElementById('lib-id');
    const src = document.getElementById('translate-id')?.value || document.getElementById('transcript-id')?.value || document.getElementById('dubs-id')?.value;
    if (el && !el.value && src) el.value = src;
    return el.value.trim();
  }

  async function listPrefix(prefix){
    try {
      const res = await listAll(ref(storage, prefix));
      return res.items || [];
    } catch { return []; }
  }

  async function listArtifacts(){
    const id = videoIdOrFromOthers();
    const msg = document.getElementById('lib-msg');
    const grid = document.getElementById('lib-items');
    if (!id) { showToast('Informe o ID do vídeo','error'); return; }
    msg.textContent = 'Listando...'; grid.innerHTML = '';
    const prefixes = [`subs/${id}/`, `transcripts/${id}/`, `dubs/${id}/`, `thumbs/`, `bridge_tts/default/env/`];
    let items = [];
    for (const p of prefixes) {
      const arr = await listPrefix(p);
      items = items.concat(arr);
    }
    if (!items.length) { msg.textContent = 'Nenhum artefato encontrado'; return; }
    const cards = await Promise.all(items.map(async (itemRef) => {
      let url = null; try { url = await getDownloadURL(itemRef); } catch {}
      const path = itemRef.fullPath || itemRef._location?.path;
      return `<div class="card">
        <div class="row"><div class="badge">${path?.split('/')[0]}</div><div class="muted">${path}</div></div>
        <div class="row">${url?`<a class="btn" href="${url}" target="_blank">Baixar</a>`:'<span class="muted">Indisponível</span>'}</div>
      </div>`;
    }));
    grid.innerHTML = cards.join('');
    msg.textContent = `Itens: ${items.length}`;
  }

  document.getElementById('btn-lib-list')?.addEventListener('click', listArtifacts);
}

// Publish UI
const viewPublish = document.getElementById('view-publish');
if (viewPublish) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="row">
      <label class="field">
        <span class="label">YouTube ID</span>
        <input id="pub-id" type="text" placeholder="ID do vídeo" />
      </label>
      <label class="field">
        <span class="label">Idioma</span>
        <select id="pub-lang">
          <option value="en">EN</option>
          <option value="es">ES</option>
        </select>
      </label>
    </div>
    <div class="row">
      <label class="field">
        <span class="label">Título</span>
        <input id="pub-title" type="text" placeholder="Título para publicação" />
      </label>
    </div>
    <div class="row">
      <label class="field" style="flex:1">
        <span class="label">Descrição</span>
        <textarea id="pub-desc" rows="4" placeholder="Descrição..."></textarea>
      </label>
    </div>
    <div class="row">
      <button id="btn-publish" class="btn btn-primary">Publicar</button>
      <span id="pub-msg" class="muted"></span>
    </div>
  `;
  viewPublish.appendChild(card);

  function fillVideoId(){
    const el = document.getElementById('pub-id');
    const src = document.getElementById('lib-id')?.value || document.getElementById('translate-id')?.value || document.getElementById('transcript-id')?.value || document.getElementById('dubs-id')?.value;
    if (el && !el.value && src) el.value = src;
  }

  document.getElementById('btn-publish')?.addEventListener('click', async ()=>{
    fillVideoId();
    const msg = document.getElementById('pub-msg');
    try {
      const user = auth.currentUser; if (!user) throw new Error('Faça login');
      const idToken = await user.getIdToken();
      const body = {
        videoId: document.getElementById('pub-id').value.trim(),
        lang: document.getElementById('pub-lang').value,
        title: document.getElementById('pub-title').value.trim(),
        description: document.getElementById('pub-desc').value.trim()
      };
      if (!body.videoId) throw new Error('Informe o ID do vídeo');
      const r = await fetch(apiUrl('/api/publish'), { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${idToken}` }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error||'Falha');
      msg.textContent = `Job ${j.jobId} criado`; showToast('Publicação iniciada!','success');
    } catch(e){ msg.textContent = e.message||'Erro'; showToast(msg.textContent,'error'); }
  });
}

// ==== WP-ADMIN ====
const viewAdmin = document.getElementById('view-admin');
if (viewAdmin) {
  // state de sessão simples para WP-ADMIN (não confundir com Firebase Auth)
  let wpAdminLogged = false;

  const elUser = document.getElementById('wp-user');
  const elPass = document.getElementById('wp-pass');
  const elMsg = document.getElementById('wp-msg');
  const btnLogin = document.getElementById('btn-wp-login');
  const elApiBase = document.getElementById('cfg-api-base');
  const elTtsEnabled = document.getElementById('cfg-tts-enabled');
  const btnSaveCfg = document.getElementById('btn-save-config');
  const cfgMsg = document.getElementById('cfg-msg');

  // Carregar defaults
  elApiBase.value = (window.env?.API_BASE)||'';
  elTtsEnabled.value = (window.env?.TTS_ENABLED)||'false';

  async function loadAdminConfig(){
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) { cfgMsg.textContent = 'Faça login com sua conta (Firebase) para gerenciar config.'; return; }
      const r = await fetch(apiUrl('/api/admin/config'), { headers: { 'Authorization': `Bearer ${idToken}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error||'Falha ao carregar config');
      const cfg = j.config||{};
      elApiBase.value = cfg.apiBase||'';
      elTtsEnabled.value = String(!!cfg.ttsEnabled);
      cfgMsg.textContent = 'Configurações carregadas.';
    } catch (e) {
      cfgMsg.textContent = 'Erro ao carregar: ' + (e.message||e);
    }
  }

  function ensureLogged(){
    if (!wpAdminLogged) { elMsg.textContent = 'Faça login no WP-ADMIN.'; throw new Error('not_logged'); }
  }

  btnLogin?.addEventListener('click', () => {
    const u = elUser.value.trim();
    const p = elPass.value.trim();
    if (!u || !p) { elMsg.textContent = 'Informe usuário e senha'; return; }
    const U = (window.env?.WP_ADMIN_USER)||'';
    const P = (window.env?.WP_ADMIN_PASS)||'';
    if (u === U && p === P) {
      wpAdminLogged = true;
      elMsg.textContent = 'Logado com sucesso';
      showToast('WP-ADMIN logado','success');
      loadAdminConfig();
    } else {
      elMsg.textContent = 'Credenciais inválidas';
      showToast('Login inválido','error');
    }
  });

  btnSaveCfg?.addEventListener('click', async () => {
    try {
      ensureLogged();
      const base = elApiBase.value.trim();
      const ttsEnabled = elTtsEnabled.value === 'true';
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Faça login (Firebase)');
      const r = await fetch(apiUrl('/api/admin/config'), { method:'PUT', headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${idToken}` }, body: JSON.stringify({ apiBase: base, ttsEnabled }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error||'Falha ao salvar');
      // Persistência simples em localStorage (aplicável para Web/Electron)
      localStorage.setItem('APP_API_BASE', base);
      localStorage.setItem('APP_TTS_ENABLED', String(ttsEnabled));
      // Atualiza window.env em runtime (somente sessão atual)
      window.env = Object.assign({}, window.env, { API_BASE: base, TTS_ENABLED: String(ttsEnabled) });
      cfgMsg.textContent = 'Configurações salvas.';
      showToast('Configurações do app atualizadas','success');
    } catch (e) {
      cfgMsg.textContent = 'Erro ao salvar: ' + (e.message||e);
      showToast('Erro ao salvar config','error');
    }
  });

  // Roles management (usa Cloud Functions seguras com Firebase Auth do usuário logado)
  const elRoleUid = document.getElementById('role-uid');
  const elRoleRoles = document.getElementById('role-roles');
  const btnGetRoles = document.getElementById('btn-get-roles');
  const btnSetRoles = document.getElementById('btn-set-roles');
  const rolesMsg = document.getElementById('roles-msg');

  btnGetRoles?.addEventListener('click', async ()=>{
    try {
      ensureLogged();
      const uid = elRoleUid.value.trim();
      if (!uid) throw new Error('Informe UID');
      const idToken = await auth.currentUser?.getIdToken();
      const r = await fetch(apiUrl(`/api/admin/users/${uid}/roles`), { headers: { 'Authorization': `Bearer ${idToken}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error||'Falha');
      elRoleRoles.value = (j.roles||[]).join(',');
      rolesMsg.textContent = 'Roles carregadas';
    } catch (e) {
      rolesMsg.textContent = 'Erro: ' + (e.message||e);
    }
  });

  btnSetRoles?.addEventListener('click', async ()=>{
    try {
      ensureLogged();
      const uid = elRoleUid.value.trim();
      if (!uid) throw new Error('Informe UID');
      const roles = elRoleRoles.value.split(',').map(s=>s.trim()).filter(Boolean);
      const idToken = await auth.currentUser?.getIdToken();
      const r = await fetch(apiUrl(`/api/admin/users/${uid}/roles`), { method:'POST', headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${idToken}` }, body: JSON.stringify({ roles }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error||'Falha');
      rolesMsg.textContent = 'Roles atualizadas';
      showToast('Roles atualizadas','success');
    } catch (e) {
      rolesMsg.textContent = 'Erro: ' + (e.message||e);
      showToast('Erro ao atualizar roles','error');
    }
  });
}

// Restaurar config de localStorage ao carregar
(function restoreLocalConfig(){
  try {
    const base = localStorage.getItem('APP_API_BASE');
    const tts = localStorage.getItem('APP_TTS_ENABLED');
    if (base) window.env = Object.assign({}, window.env, { API_BASE: base });
    if (tts) window.env = Object.assign({}, window.env, { TTS_ENABLED: tts });
  } catch {}
})();