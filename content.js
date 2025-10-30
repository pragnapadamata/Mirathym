(()=>{
  let lastSent = { text: '', ts: 0 };
  let keyTimer = null;

  function readValue(el){
    if(!el) return '';
    if(el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type==='text')) return el.value || '';
    if(el.getAttribute('contenteditable') === 'true') return el.innerText || el.textContent || '';
    return '';
  }

  async function onSubmit(el){
    const text = (readValue(el) || '').trim();
    const now = performance.now();
    if(!text) return;
    if(text === lastSent.text && (now - lastSent.ts) < 1500) return; // debounce duplicates
    lastSent = { text, ts: now };
    try{
      const url = location.href;
      const modelHint = /gemini|nano|google|chrome-ai/i.test(url) ? 'gemini-nano' : 'unknown';
      const payload = { type: 'AI_PROMPT_SUBMITTED', prompt: text, url, modelHint };
      let tries = 0;
      const send = ()=>{
        tries++;
        chrome.runtime.sendMessage(payload, ()=>{
          const err = chrome.runtime?.lastError;
          if(err && tries < 3){ setTimeout(send, 150); return; }
        });
      };
      send();
    }catch(_){ }
  }

  function onKeystroke(el){
    if(keyTimer) clearTimeout(keyTimer);
    keyTimer = setTimeout(()=>{
      try{
        const raw = (readValue(el) || '');
        const text = raw.slice(0, 2000);
        if(!text.trim()) return; // ignore empty to keep previous tokens visible
        const url = location.href;
        const modelHint = /gemini|nano|google|chrome-ai/i.test(url) ? 'gemini-nano' : 'unknown';
        chrome.runtime.sendMessage({ type: 'AI_KEYSTROKE', prompt: text, url, modelHint }, ()=>{});
      }catch(_){ }
    }, 220);
  }

  function attach(el){
    if(el.__mirathym) return; el.__mirathym = true;
    el.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' && !e.shiftKey){ onSubmit(e.currentTarget); }
    });
  }

  function scan(){
    const inputs = document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]');
    inputs.forEach(attach);
    // form submits
    document.querySelectorAll('form').forEach(f=>{
      if(f.__mirathym) return; f.__mirathym = true;
      f.addEventListener('submit', (e)=>{
        const el = f.querySelector('textarea, [contenteditable="true"], input[type="text"]');
        if(el) onSubmit(el);
      });
    });
    // common send buttons
    const buttons = document.querySelectorAll('[aria-label="Send"], button[type="submit"], [data-testid*="send"]');
    buttons.forEach(btn=>{
      if(btn.__mirathym) return; btn.__mirathym = true;
      btn.addEventListener('click', ()=>{
        const root = btn.closest('form') || document;
        const el = root.querySelector('textarea, [contenteditable="true"], input[type="text"]');
        if(el) onSubmit(el);
      });
    });

    // ChatGPT-specific: role=textbox contenteditable + send button
    try{
      if(/chat\.openai\.com$/i.test(location.hostname)){
        const box = document.querySelector('div[role="textbox"][contenteditable="true"]');
        if(box) attach(box);
        const sendBtn = document.querySelector('button[data-testid="send-button"]');
        if(sendBtn && !sendBtn.__mirathym){
          sendBtn.__mirathym = true;
          sendBtn.addEventListener('click', ()=>{
            const el = document.querySelector('div[role="textbox"][contenteditable="true"]');
            if(el) onSubmit(el);
          });
        }
      }
    }catch(_){ }
  }

  function init(){
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.documentElement, {subtree:true, childList:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

