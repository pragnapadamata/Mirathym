//

try{
  if(chrome?.webRequest?.onCompleted){
    chrome.webRequest.onCompleted.addListener(
      (details)=>{
        try{
          const ms = Math.max(0, (details.timeStamp||0) - (details.requestTime||details.timeStamp||0));
          chrome.storage.local.set({ lastLatencyMs: ms });
        }catch(_){ }
      },
      { urls: [
        "https://api.openai.com/*",
        "https://*.googleapis.com/*",
        "https://*.anthropic.com/*",
        "https://*.openai.com/*"
      ] }
    );
  }
}catch(_){ }

try{
  chrome.runtime.onInstalled.addListener(()=>{
    try{ chrome.storage.local.set({ installedAt: Date.now() }); }catch(_){ }
  });
}catch(_){ }

// Basic lifecycle logs to help diagnose startup issues
try{
  self.addEventListener('install', ()=>{ console.log('[Mirathym] SW install'); try{ ensureOffscreen(); }catch(_){ } });
  self.addEventListener('activate', ()=>{ console.log('[Mirathym] SW activate'); try{ ensureOffscreen(); }catch(_){ } });
}catch(_){ }

// Ensure an offscreen document exists to access chrome.ai.* APIs (not available in SW)
async function ensureOffscreen(){
  try{
    if(await chrome.offscreen.hasDocument?.()) return true;
  }catch(_){ }
  try{
    await chrome.offscreen.createDocument({
      url: 'ai_offscreen.html',
      reasons: ['IFRAME_SCRIPTING'],
      justification: 'Run on-device Gemini Nano APIs and compute live metrics'
    });
    return true;
  }catch(e){
    console.warn('[Mirathym] offscreen create failed', e);
    return false;
  }
}

// Broadcast helper: send to all extension views and persist snapshot for popup.js listeners
function broadcastAndPersist(payload){
  try{
    const tIn = Number(payload?.tokensIn||payload?.tokensUsed||0);
    if(tIn > 0){
      chrome.storage.local.set({ lastRun: payload });
    }
  }catch(_){ }
  try{ chrome.runtime.sendMessage({ type: 'MIRATHYM_UPDATE', data: payload }); }catch(_){ }
}

// Lightweight local estimators used if offscreen backend is unavailable
function estTokens(text){ try{ return Math.max(1, Math.ceil(String(text||'').length/5)); }catch(_){ return 1; } }
function estCpu(){ try{ return Math.round(10 + Math.random()*30); }catch(_){ return 15; } }
function makeSnapFromText(text, seconds){
  const tIn = estTokens(text);
  const tOut = Math.round(tIn*0.8);
  const total = tIn + tOut;
  const efficiency = Math.min(100, (tOut/Math.max(1,tIn))*100);
  const cpu = estCpu();
  const co2 = (total * 0.00012).toFixed(3);
  return {
    tokensUsed: tIn,
    tokensIn: tIn,
    tokensOut: tOut,
    efficiency: `${efficiency.toFixed(1)}%`,
    loadTime: `${(seconds||0.08).toFixed(2)}s`,
    cpuLoad: `${cpu}%`,
    co2Emission: `${co2}g`,
    suggestions: ["Use fewer tokens", "Batch prompts", "Use lighter models"]
  };
}

try{
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
    try{
      if(!msg){ return; }
      // Avoid handling messages intended for the offscreen page to prevent loops
      if(msg.__toOffscreen){ return; }

      // Relay updates coming back from offscreen backend
      if(msg.type === 'MIRATHYM_UPDATE'){
        // Already shaped payload from offscreen
        broadcastAndPersist(msg.data);
        sendResponse?.({ ok: true });
        return true;
      }

      // Forward prompt or keystroke events to offscreen backend
      if(msg.type === 'AI_PROMPT_SUBMITTED' || msg.type === 'AI_KEYSTROKE'){
        ensureOffscreen().then((ok)=>{
          if(!ok){
            // Local fallback: estimate and broadcast immediately
            const snap = makeSnapFromText(msg.prompt||'', msg.type==='AI_KEYSTROKE' ? 0.06 : 0.28);
            broadcastAndPersist(snap);
            sendResponse(snap);
            return;
          }
          try{
            chrome.runtime.sendMessage({
              __toOffscreen: true,
              type: msg.type,
              prompt: String(msg.prompt||''),
              url: msg.url||'',
              modelHint: msg.modelHint||'gemini-nano'
            }, (res)=>{
              // Optional immediate response
              sendResponse(res||null);
            });
          }catch(_){ sendResponse(null); }
        });
        return true;
      }

      // Fallback minimal analyze using cached latency only (no network callouts)
      if(msg.type === 'analyze'){
        const lat = chrome.storage?.local?.get ? new Promise(res=>{ chrome.storage.local.get('lastLatencyMs', v=> res(v?.lastLatencyMs||0)); }) : Promise.resolve(0);
        lat.then((latency)=>{
          const snap = {
            tokensUsed: 0,
            efficiency: '0%',
            loadTime: `${((latency||0)/1000).toFixed(2)}s`,
            cpuLoad: '0%',
            co2Emission: '0.000g'
          };
          try{ chrome.storage.local.set({ lastRun: snap }); }catch(_){ }
          sendResponse(snap);
        }).catch(()=> sendResponse(null));
        return true;
      }
    }catch(_){ sendResponse(null); return true; }
  });
}catch(_){ }

