const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  tokens: 0,
  efficiency: 87,
  loadTime: 3.2,
  cpu: 27,
  co2: 0.042,
  facts: [
    'Running GPT-4 for 1 hour = powering a bulb for 3 days.',
    'Optimized prompts could save 2,000 tons of CO₂ yearly.',
    'One AI query ≈ 20 Google searches worth of CO₂.'
  ],
  tips: [
    'Try shorter prompts — saves 20% energy.',
    'Avoid redundant model calls.',
    'Use lighter models for smaller tasks.'
  ],
  npuInferences: 1200
};

// Default snapshot showing 13 tokens when no backend data yet
const DEFAULT_SNAPSHOT = (()=>{
  const tokensIn = 13;
  const tokensOut = 10;
  const eff = (tokensOut / tokensIn) * 100; // 76.9%
  const co2g = (tokensIn * 0.00012).toFixed(3); // ~0.002g
  return {
    tokensIn,
    tokensOut,
    tokensUsed: tokensIn,
    efficiency: `${eff.toFixed(1)}%`,
    loadTime: `0.20s`,
    cpuLoad: `16%`,
    co2Emission: `${co2g}g`,
    suggestions: [
      'Use fewer tokens',
      'Batch prompts',
      'Use lighter models'
    ]
  };
})();

// Force fixed 13 tokens UI (frontend only override)
const FORCE_FIXED_13 = false;
const FIXED_SNAPSHOT = DEFAULT_SNAPSHOT;

async function backendRequest(type='analyze', payload={}, retries=3, delay=150){
  return new Promise((resolve)=>{
    if(!chrome?.runtime?.sendMessage){ resolve(null); return; }
    const message = { type, ...payload };
    const trySend = (left)=>{
      try{
        chrome.runtime.sendMessage(message, (res)=>{
          const err = chrome.runtime?.lastError;
          if(err && left>0){ setTimeout(()=> trySend(left-1), delay); return; }
          resolve(res||null);
        });
      }catch(_){ if(left>0){ setTimeout(()=> trySend(left-1), delay); } else { resolve(null); } }
    };
    trySend(retries);
  });
}

function applyMetrics(res){
  if(FORCE_FIXED_13){ res = FIXED_SNAPSHOT; }
  if(!res) return;
  // tokens
  const t = Number((res.tokensIn!=null ? res.tokensIn : res.tokensUsed)||0);
  if(!(t>0)) return; // ignore empty updates so values persist until next prompt
  state.tokens = t || state.tokens;
  animateCount($('#tokensValue'), state.tokens, 500);
  setRing($('#tokensRing'), Math.min(100, Math.round((state.tokens%1000)/10)));
  // efficiency
  const effStr = String(res.efficiency||'');
  const effParsed = parseFloat(effStr.replace(/[^0-9.]/g,''));
  const effNum = Number.isFinite(effParsed) ? effParsed : state.efficiency;
  state.efficiency = Math.max(0, Math.min(100, effNum));
  $('#efficiencyValue').textContent = state.efficiency + '%';
  setRing($('#efficiencyRing'), state.efficiency);
  // load time
  const lt = parseFloat(String(res.loadTime||'').replace(/[^0-9.]/g,''));
  if(!Number.isNaN(lt)) state.loadTime = lt;
  $('#loadTimeValue').textContent = state.loadTime.toFixed(1)+'s';
  drawSparkline('#sparkline');
  // cpu
  const cpuNum = parseInt(String(res.cpuLoad||'').replace(/[^0-9]/g,''));
  if(!Number.isNaN(cpuNum)) state.cpu = Math.max(0, Math.min(100, cpuNum));
  setBar($('#cpuBar'), state.cpu);
  $('#cpuValue').textContent = state.cpu+'%';
  // co2
  const co2Num = parseFloat(String(res.co2Emission||'').replace(/[^0-9.]/g,''));
  if(!Number.isNaN(co2Num)) state.co2 = co2Num;
  $('#co2Text').innerHTML = `This prompt emitted <strong>${state.co2.toFixed(3)} g CO₂</strong> — equivalent to charging your phone for 5 seconds.`;
  updateImpactBar(state.co2);
  co2Bubble();
  // suggestions
  if(Array.isArray(res.suggestions) && res.suggestions.length){ tipsRender(res.suggestions); }
}

function animateCount(el, to, duration=900){
  if(!el) return;
  if(prefersReduced){ el.textContent = to.toLocaleString(); return; }
  const start = performance.now();
  const from = 0;
  function tick(now){
    const p = Math.min(1, (now - start)/duration);
    el.textContent = Math.round(from + (to-from)*p).toLocaleString();
    if(p<1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
function setRing(el, pct){
  if(!el) return;
  const clamp = Math.max(0, Math.min(100, pct));
  const off = 100 - clamp;
  el.style.strokeDashoffset = String(off);
}
function drawSparkline(id){
  const c = $(id);
  if(!c) return;
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  const pts = Array.from({length: 16}, (_,i)=> Math.sin(i/2)+Math.random()*0.5 + 2);
  const max = Math.max(...pts), min = Math.min(...pts);
  ctx.clearRect(0,0,w,h);
  ctx.beginPath(); ctx.strokeStyle = '#79d39b'; ctx.lineWidth = 2;
  pts.forEach((v,i)=>{
    const x = (i/(pts.length-1))*w;
    const y = h - ((v-min)/(max-min))*h;
    i? ctx.lineTo(x,y) : ctx.moveTo(x,y);
  });
  ctx.stroke();
}
function setBar(el, pct){
  if(!el) return;
  el.style.width = pct + '%';
}
function co2Bubble(){
  const b = $('#co2Bubble');
  if(!b) return;
  if(!prefersReduced){
    b.classList.remove('bubble-pop');
    void b.offsetWidth; // reflow
    b.classList.add('bubble-pop');
  }
}
function updateImpactBar(co2){
  // Map co2 g to 0-100 scale (example thresholds: <0.05 low, 0.05-0.2 med, >0.2 high)
  const pct = Math.max(0, Math.min(100, (co2/0.25)*100));
  const fill = $('#impactFill'); if(fill) fill.style.width = pct + '%';
}
function tipsRender(items){
  const ul = $('#tipsList');
  if(!ul) return;
  ul.innerHTML = '';
  items.forEach((t,i)=>{
    const li = document.createElement('li');
    li.textContent = t;
    if(!prefersReduced){
      li.style.animationDelay = (i*40)+'ms';
      li.classList.add('slide-in');
    }
    ul.appendChild(li);
  });
}
function systemBars(cpuT=42, gpu=27, npu=12){
  const cpuEl = $('#cpuTemp'), gpuEl = $('#gpuUsage'), npuEl = $('#npuWear');
  if(cpuEl) cpuEl.style.width = Math.min(100, cpuT) + '%';
  if(gpuEl) gpuEl.style.width = Math.min(100, gpu) + '%';
  if(npuEl) npuEl.style.width = Math.min(100, npu) + '%';
  ;[cpuEl,gpuEl,npuEl].forEach(el=>{
    if(!el) return;
    if(!prefersReduced){
      el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    }
    const val = parseFloat(el.style.width);
    if(val>75){ el.style.boxShadow = '0 0 0 2px rgba(255,107,107,.45)'}
    else if(val>50){ el.style.boxShadow = '0 0 0 2px rgba(255,214,102,.35)'}
    else{ el.style.boxShadow = 'none'}
  });
  const note = $('#sysNote'); if(note) note.textContent = `Your NPU handled ${state.npuInferences} inferences this week. Keep it cool for longer life.`;
}
function carouselInit(){
  const track = $('#carouselTrack');
  track.innerHTML = '';
  const hl = (s)=> s.replace(/(\b\d+(?:\.\d+)?\b|CO₂|GPT-4|Google|kWh|tons?)/gi, '<span class="hl">$1<\/span>');
  state.facts.forEach(f=>{
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = hl(f);
    track.appendChild(card);
  });
  let idx = 0; let timer;
  function go(i){ idx = i % state.facts.length; track.style.transform = `translateX(-${idx*100}%)`; }
  function start(){ if(prefersReduced) return; timer = setInterval(()=> go(idx+1), 4000); }
  function stop(){ clearInterval(timer); }
  start();
  $('#carousel').addEventListener('mouseenter', stop);
  $('#carousel').addEventListener('mouseleave', start);
}

function openModal(){ $('#scoreModal').showModal(); }
function closeModal(){ $('#scoreModal').close(); }
function togglePopover(show){ $('#savePopover').classList.toggle('show', show); }

function recalc(){
  // Try backend; fallback to local estimate
  backendRequest('analyze').then((res)=>{
    if(res && !res.error){ applyMetrics(res); return; }
    // Fallback mock recompute using local formula
    const tokens = state.tokens;
    const response = state.loadTime;
    const cpu = state.cpu;
    const avgPowerW = 15;
    const grid = 442; // g/kWh
    const energyLocal = (cpu/100) * avgPowerW * (response/3600) / 1000; // kWh
    const modelFactor = tokens * 0.0000021; // kWh/token (spec)
    const totalEnergy = energyLocal + modelFactor;
    const co2 = totalEnergy * (grid);
    state.co2 = +(co2.toFixed(3));
    $('#co2Text').innerHTML = `This prompt emitted <strong>${state.co2} g CO₂</strong> — equivalent to charging your phone for 5 seconds.`;
    updateImpactBar(state.co2);
    co2Bubble();
  });
}

function saveAsPdf(){
  // Simple print approach for hackathon demo: open a printable view of the popup content
  const w = window.open('', '_blank', 'width=420,height=640');
  if(!w){ return; }
  const cssLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map(node=> node.outerHTML).join('\n');
  const content = document.querySelector('#app').outerHTML;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Mirathym Report</title>${cssLinks}
    <style>@page{size:auto;margin:12mm} html,body{background:#fff} .popup{box-shadow:none;border-radius:0;width:auto;height:auto}
    dialog{display:block;position:static;inset:auto;}
    </style></head><body>${content}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(()=>{ w.print(); w.close(); }, 300);
}

function init(){
  let bootApplied = false;

  // Load last persisted metrics first to avoid zero flicker on open
  try{
    if(FORCE_FIXED_13){ applyMetrics(FIXED_SNAPSHOT); bootApplied = true; }
    else {
      chrome.storage.local.get('lastRun', (obj)=>{
        const snap = obj?.lastRun;
        if(snap){ applyMetrics(snap); bootApplied = true; }
        else{ applyMetrics(DEFAULT_SNAPSHOT); bootApplied = true; }
      });
    }
  }catch(_){ }

  // Defer fallback visuals to allow storage get to complete first
  setTimeout(()=>{ if(bootApplied) return; applyMetrics(DEFAULT_SNAPSHOT); }, 120);

  tipsRender(state.tips);
  systemBars(48, 27, 10);
  carouselInit();

  // Removed SSE to localhost: backend is on-device via offscreen; avoid connection errors

  // Already attempted to load lastRun earlier

  // React to backend updates (e.g., from content script prompt captures)
  try{
    if(chrome?.storage?.onChanged){
      chrome.storage.onChanged.addListener((changes, areaName)=>{
        if(areaName === 'local' && changes.lastRun){
          applyMetrics(changes.lastRun.newValue);
        }
      });
    }
  }catch(_){ }

  // Also listen to direct runtime messages for immediate UI updates
  try{
    if(chrome?.runtime?.onMessage){
      chrome.runtime.onMessage.addListener((msg)=>{
        if(msg && msg.type === 'MIRATHYM_UPDATE' && msg.data){
          applyMetrics(msg.data);
        }
      });
    }
  }catch(_){ }

  // actions
  $('#recalcBtn').addEventListener('click', ()=>{ recalc(); });
  const scoreBtn = $('#scoreBtn'); if(scoreBtn) scoreBtn.addEventListener('click', ()=>{ const gs=$('#greenScore'); if(gs){ gs.textContent = String( Math.round( (state.efficiency + (100-state.cpu))/2 ) ); } openModal(); });
  const closeBtn = $('#closeModal'); if(closeBtn) closeBtn.addEventListener('click', closeModal);

  const pop = $('#savePopover');
  const saveBtn = $('#saveBtn'); if(saveBtn) saveBtn.addEventListener('click', (e)=>{
    if(pop){ pop.style.right = '12px'; pop.style.bottom = '62px'; }
    togglePopover(true);
  });
  const savePdfBtn = $('#savePdfBtn'); if(savePdfBtn) savePdfBtn.addEventListener('click', ()=>{ saveAsPdf(); togglePopover(false); });
  document.addEventListener('click', (e)=>{
    const sp = $('#savePopover');
    if(sp && !sp.contains(e.target) && e.target.id !== 'saveBtn') togglePopover(false);
  });

  const refresh = $('#refreshTip'); if(refresh) refresh.addEventListener('click', (e)=>{
    const tgt = e.currentTarget; if(tgt){
      tgt.style.transform = 'rotate(360deg)';
      tgt.style.transition = 'transform .3s linear';
      setTimeout(()=>{ if(tgt) tgt.style.transform = '';}, 320);
    }
    const t = state.tips.shift(); state.tips.push(t); tipsRender(state.tips);
  });
}

document.addEventListener('DOMContentLoaded', init);

// Stubs for APIs (not invoked by default)
export async function getCpuInfo(){ try{ return await chrome.system.cpu.getInfo(); }catch(e){ return null; } }
export async function getMemoryInfo(){ try{ return await chrome.system.memory.getInfo(); }catch(e){ return null; } }
export async function getBattery(){ try{ return await navigator.getBattery?.(); }catch(e){ return null; } }
export async function co2Signal(country){
  try{ const res = await fetch(`https://api.co2signal.com/v1/latest?countryCode=${country}`, { headers: { 'auth-token': 'YOUR_CO2SIGNAL_KEY' }}); if(!res.ok) throw 0; return res.json(); }catch(e){ return null; }
}
