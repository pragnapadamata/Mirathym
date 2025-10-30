// Mirathym offscreen backend using on-device Gemini Nano APIs
// Receives AI_KEYSTROKE and AI_PROMPT_SUBMITTED from the service worker and emits MIRATHYM_UPDATE payloads

// Per user spec: CO2 (g) = tokens_used × 0.0003 × cpu_load_factor
const CO2_PER_TOKEN_G = 0.0003; // grams per token baseline
let lastText = '';
let keystrokeTimer = null;

function estimateTokens(text){
  if(!text) return 0;
  // rough 4 chars per token per spec
  return Math.max(1, Math.ceil(text.length/4));
}

function cpuLoadEstimate(){
  try{ return Math.round(20 + Math.random()*25); }catch(_){ return 25; }
}

async function getCpuLoad(){
  try{
    if(!chrome?.system?.cpu?.getInfo) return cpuLoadEstimate();
    const info = await chrome.system.cpu.getInfo();
    const p = (info?.processors && info.processors[0]) || null;
    const u = p?.usage;
    if(u){
      const total = (u.user||0) + (u.kernel||0) + (u.idle||0);
      if(total>0){
        const active = ((u.user||0) + (u.kernel||0)) / total;
        return Math.max(0, Math.min(100, Math.round(active*100)));
      }
    }
    return cpuLoadEstimate();
  }catch(_){ return cpuLoadEstimate(); }
}

async function nanoPrompt(userPrompt){
  const start = performance.now();
  let output = '';
  let inputTokens = null;
  let outputTokens = null;
  try{
    if(chrome?.ai?.prompt){
      const res = await chrome.ai.prompt({ model: 'gemini-nano', input: userPrompt });
      output = String(res?.output||'');
      const m = res?.metadata || {};
      // Use whichever fields are present
      inputTokens = m.inputTokens ?? m.tokensIn ?? null;
      outputTokens = m.outputTokens ?? m.tokensOut ?? (typeof m.tokensUsed==='number' ? Math.max(0, m.tokensUsed - (inputTokens||0)) : null);
    }else{
      // Fallback local echo for environments without chrome.ai
      await new Promise(r=> setTimeout(r, 120+Math.random()*180));
      output = (userPrompt||'').slice(0, 256);
    }
  }catch(_){
    output = '';
  }
  const dt = (performance.now() - start)/1000;
  return { output, seconds: dt, inputTokens, outputTokens };
}

async function nanoSummarize(text){
  try{
    if(chrome?.ai?.summarize){
      const res = await chrome.ai.summarize({ text });
      return String(res?.output||'');
    }
  }catch(_){ }
  // fallback simple summary
  return (text||'').split(/\s+/).slice(0, 16).join(' ') + (text?.length>0?'...':'');
}

async function maybeTranslateOrWrite(prompt, output){
  const suggestions = ["Use fewer tokens", "Batch prompts", "Use lighter models"];
  try{
    if(/\b(spanish|español|translate|translation|traduce)\b/i.test(prompt) && chrome?.ai?.translation){
      try{ await chrome.ai.translation({ text: output||prompt, to: 'es' }); suggestions.push('Use translation sparingly'); }catch(_){ }
    }
    if(/\b(poem|story|blog|write|rewrite)\b/i.test(prompt) && chrome?.ai?.writer){
      try{ await chrome.ai.writer({ instruction: 'Improve brevity and clarity', text: prompt }); suggestions.push('Prefer concise writing'); }catch(_){ }
    }
  }catch(_){ }
  return suggestions;
}

function buildPayload(userPrompt, output, seconds, tokensIn, tokensOut, cpuLoad){
  const totalTokens = (tokensIn||0) + (tokensOut||0);
  const eff = Math.min(100, tokensOut>0 && tokensIn>0 ? (tokensOut/tokensIn)*100 : (output.length / Math.max(1,userPrompt.length))*100);
  const cpu = Number.isFinite(cpuLoad) ? cpuLoad : cpuLoadEstimate();
  const cpuFactor = Math.max(0.1, Math.min(1, cpu/100));
  const co2 = +(totalTokens * CO2_PER_TOKEN_G * cpuFactor).toFixed(3);
  return {
    // Show tokens typed by the user on the dashboard
    tokensUsed: tokensIn,
    tokensIn,
    tokensOut,
    efficiency: `${eff.toFixed(1)}%`,
    loadTime: `${seconds.toFixed(2)}s`,
    cpuLoad: cpu,
    co2Emission: `${co2.toFixed(3)}g`,
    cpuLoadFactor: +cpuFactor.toFixed(2),
  };
}

async function processPrompt(userPrompt){
  const res = await nanoPrompt(userPrompt);
  const inTokens = Number.isFinite(res.inputTokens) ? res.inputTokens : estimateTokens(userPrompt);
  const outTokens = Number.isFinite(res.outputTokens) ? res.outputTokens : estimateTokens(res.output);
  const cpu = await getCpuLoad();
  const payload = buildPayload(userPrompt, res.output, res.seconds, inTokens, outTokens, cpu);
  const summary = await nanoSummarize(userPrompt);
  const suggestions = await maybeTranslateOrWrite(userPrompt, res.output);

  // Eco-summary via Prompt API (energy equivalence) and translation to browser locale
  let ecoSummary = `This prompt ≈ ${payload.co2Emission} CO₂`;
  try{
    if(chrome?.ai?.prompt){
      const eq = await chrome.ai.prompt({ model: 'gemini-nano', input: `Given CO2 ${payload.co2Emission} for an AI prompt, express a short equivalence like "≈ charging a phone for a few seconds".`});
      if(eq?.output) ecoSummary = eq.output.slice(0, 140);
    }
  }catch(_){ }
  try{
    const loc = (navigator.language||'en').slice(0,2);
    if(loc && loc !== 'en' && chrome?.ai?.translation){
      const tr = await chrome.ai.translation({ text: ecoSummary, to: loc });
      if(tr?.output) ecoSummary = tr.output;
    }
  }catch(_){ }

  const data = { ...payload, summary, ecoSummary, suggestions };
  try{ chrome.storage?.local?.set && chrome.storage.local.set({ lastRun: data }); }catch(_){ }
  // Append to history (cap 50)
  try{
    chrome.storage?.local?.get && chrome.storage.local.get('history', (obj)=>{
      const hist = Array.isArray(obj?.history) ? obj.history : [];
      hist.unshift({ ts: Date.now(), type: 'submit', prompt: userPrompt, ...payload, summary });
      const trimmed = hist.slice(0, 50);
      try{ chrome.storage.local.set({ history: trimmed }); }catch(_){ }
    });
  }catch(_){ }
  try{ await computeAndStoreWeeklySummary(); }catch(_){ }
  try{ chrome.runtime.sendMessage({ type: 'MIRATHYM_UPDATE', data }); }catch(_){ }
  return data;
}

async function processKeystroke(userPrompt){
  // Lightweight: no prompt call; just estimate tokens and send quick update to keep UI live
  const inTokens = estimateTokens(userPrompt);
  const seconds = 0.05 + Math.random()*0.05;
  const outTokens = Math.round(inTokens*0.8);
  const cpu = await getCpuLoad();
  const payload = buildPayload(userPrompt, '', seconds, inTokens, outTokens, cpu);
  payload.summary = '';
  payload.suggestions = ["Keep typing...", "Aim for concise prompts"];
  try{ chrome.storage?.local?.set && chrome.storage.local.set({ lastRun: payload }); }catch(_){ }
  // Keystroke history entry (lightweight)
  try{
    chrome.storage?.local?.get && chrome.storage.local.get('history', (obj)=>{
      const hist = Array.isArray(obj?.history) ? obj.history : [];
      hist.unshift({ ts: Date.now(), type: 'keystroke', prompt: userPrompt, ...payload });
      const trimmed = hist.slice(0, 50);
      try{ chrome.storage.local.set({ history: trimmed }); }catch(_){ }
    });
  }catch(_){ }
  try{ chrome.runtime.sendMessage({ type: 'MIRATHYM_UPDATE', data: payload }); }catch(_){ }
  return payload;
}

async function computeAndStoreWeeklySummary(){
  try{
    const get = () => new Promise((res)=> chrome.storage.local.get('history', (o)=> res(o?.history||[])));
    const hist = await get();
    const now = Date.now();
    const weekAgo = now - 7*24*60*60*1000;
    const items = hist.filter(h=> (h?.ts||0) >= weekAgo);
    const totalIn = items.reduce((a,b)=> a + (b.tokensIn||0), 0);
    const totalOut = items.reduce((a,b)=> a + (b.tokensOut||0), 0);
    const totalCo2 = items.reduce((a,b)=> a + parseFloat(String(b.co2Emission||'0').replace(/[^0-9.]/g,'')), 0);
    const summary = { ts: now, totalIn, totalOut, totalCo2: +totalCo2.toFixed(3), items: items.length };
    await chrome.storage.local.set({ weeklySummary: summary });
  }catch(_){ }
}

function scheduleKeystroke(text){
  lastText = text;
  if(keystrokeTimer) clearTimeout(keystrokeTimer);
  keystrokeTimer = setTimeout(()=>{
    processKeystroke(lastText);
  }, 300);
}

try{
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
    try{
      if(!msg || !msg.__toOffscreen) return;
      if(msg.type === 'AI_KEYSTROKE'){
        scheduleKeystroke(String(msg.prompt||''));
        sendResponse?.({ ok: true });
        return true;
      }
      if(msg.type === 'AI_PROMPT_SUBMITTED'){
        processPrompt(String(msg.prompt||''))
          .then(data=> sendResponse?.(data))
          .catch(()=> sendResponse?.(null));
        return true;
      }
    }catch(_){ sendResponse?.(null); return true; }
  });
}catch(_){ }
