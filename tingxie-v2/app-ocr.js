'use strict';
// Gemini AI OCR replaces all browser/Tesseract OCR in the normal V2 flow.
const AI2_MODELS=['gemini-2.5-flash-lite','gemini-2.5-flash'];
const AI2_KEY='ai:key',AI2_MODEL='ai:model',AI2_URL='ai:workerUrl',AI2_CODE='ai:workerCode';
function ai2Get(k){return sessionStorage.getItem(k)||localStorage.getItem(k)||'';}
function ai2Settings(){
 const v=id=>document.getElementById(id)?.value?.trim()||'';
 return {key:v('ai2Key')||ai2Get(AI2_KEY),model:v('ai2Model')||ai2Get(AI2_MODEL)||AI2_MODELS[0],url:v('ai2Url')||ai2Get(AI2_URL),code:v('ai2Code')||ai2Get(AI2_CODE)};
}
function ai2Save(){
 const s=ai2Settings(),remember=document.getElementById('ai2Remember').checked;
 [[AI2_KEY,s.key],[AI2_MODEL,s.model],[AI2_URL,s.url],[AI2_CODE,s.code]].forEach(([k,v])=>{
  sessionStorage.setItem(k,v);
  if(remember)localStorage.setItem(k,v);else localStorage.removeItem(k);
 });
 document.getElementById('ai2Status').textContent=(s.key||s.url)?'AI settings saved. Take a photo and tap Read.':'Add a free Gemini API key to scan.';
}
function ai2Install(){
 const scan=document.getElementById('scanSourceButton');
 if(!scan||document.getElementById('ai2Settings'))return;
 scan.textContent='✨ Read photo with AI';
 const box=document.createElement('details');box.id='ai2Settings';box.className='ai2box';box.open=!ai2Get(AI2_KEY)&&!ai2Get(AI2_URL);
 box.innerHTML='<summary>✨ AI photo reader · free-tier setup</summary>'+
 '<p>1. <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener noreferrer">Get a free Gemini API key</a>. 2. Paste it below. 3. Tap Save. No key is published in GitHub.</p>'+
 '<label for="ai2Key">Your Gemini API key</label><input id="ai2Key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste your own key here">'+
 '<label for="ai2Model">Model</label><select id="ai2Model"><option value="gemini-2.5-flash-lite">Flash-Lite · free tier (default)</option><option value="gemini-2.5-flash">Flash · free tier (harder handwriting)</option></select>'+
 '<details><summary>Advanced: use a private Cloudflare Worker instead</summary><label for="ai2Url">Worker endpoint URL (ends in /ocr)</label><input id="ai2Url" type="url" placeholder="https://example.workers.dev/ocr"><label for="ai2Code">Family access code</label><input id="ai2Code" type="password" autocomplete="off"></details>'+
 '<label class="checkrow"><input id="ai2Remember" type="checkbox"> Remember credentials on this device (less secure)</label>'+
 '<p><button type="button" id="ai2Save">Save AI settings</button><button type="button" id="ai2Forget">Forget credentials</button></p>'+
 '<p id="ai2Status" role="status">Photos are sent to Google only when you scan. Crop out names first. Free-tier data may be used by Google to improve products. Check every AI-recognised word.</p>';
 scan.insertAdjacentElement('afterend',box);
 for(const [id,key] of [['ai2Key',AI2_KEY],['ai2Model',AI2_MODEL],['ai2Url',AI2_URL],['ai2Code',AI2_CODE]]){const node=document.getElementById(id);if(ai2Get(key))node.value=ai2Get(key);}
 document.getElementById('ai2Save').addEventListener('click',ai2Save);
 document.getElementById('ai2Forget').addEventListener('click',()=>{
  [AI2_KEY,AI2_MODEL,AI2_URL,AI2_CODE].forEach(k=>{sessionStorage.removeItem(k);localStorage.removeItem(k);});
  for(const id of ['ai2Key','ai2Url','ai2Code'])document.getElementById(id).value='';
  document.getElementById('ai2Status').textContent='All AI credentials cleared from this device.';
 });
 const start=document.getElementById('startDictationButton');
 if(start){const mark=document.createElement('button');mark.className='ai2mark';mark.type='button';mark.textContent='📝 Optional: mark handwritten answers using AI';
 mark.addEventListener('click',()=>{
  const words=extractItems(document.getElementById('wordList').value);
  if(!words.length){showToast('Add a word list first.');return;}
  state.sessionWords=words.slice();
  const p=document.getElementById('markingPanel');p.hidden=false;p.removeAttribute('aria-hidden');
  const step=document.querySelector('.step[data-step="marking"]');if(step){step.hidden=false;step.removeAttribute('aria-hidden');}
  setPanel('marking');
 });start.insertAdjacentElement('afterend',mark);}
}
window.addEventListener('DOMContentLoaded',ai2Install);
function setOcrMessage(prefix,message,percent){
 const block=document.getElementById(prefix+'Progress'),bar=document.getElementById(prefix+'ProgressBar'),label=document.getElementById(prefix+'ProgressText');
 if(block)block.classList.remove('hidden');if(bar)bar.style.width=String(percent||0)+'%';if(label)label.textContent=message;
}
function ai2Prepare(file){
 return new Promise((resolve,reject)=>{
  const url=URL.createObjectURL(file),img=new Image();
  img.onload=()=>{URL.revokeObjectURL(url);const scale=Math.min(1,2400/Math.max(img.naturalWidth,img.naturalHeight));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
   const ctx=canvas.getContext('2d');if(!ctx)return reject(Error('Image processing is unavailable.'));
   ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
   canvas.toBlob(blob=>{if(!blob)return reject(Error('Image compression failed.'));const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Image conversion failed.'));reader.readAsDataURL(blob);
   },'image/jpeg',0.86);
  };
  img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('The selected image could not be opened.'));};img.src=url;
 });
}
function ai2Prompt(kind){
 return kind==='answer'
  ? 'Transcribe each handwritten Chinese spelling answer from this primary school worksheet. Preserve the actual spelling even if wrong. Return exactly one item per numbered answer line, in reading order. For blank lines use （空白）; unreadable answers use （看不清）. Do not invent, correct or rearrange answers. Exclude question numbers, names, headings and explanations.'
  : 'Extract only Chinese 听写 vocabulary words and short phrases from this photographed spelling sheet, in natural reading order. Return one item per word or phrase. Omit titles, names, dates, numbers, pinyin, translations and example explanations. Do not invent or correct uncertain Chinese characters. For unreadable items return （看不清）.';
}
function ai2Items(payload){
 if(Array.isArray(payload.items))return payload.items.filter(x=>typeof x==='string').map(x=>x.trim()).filter(Boolean).slice(0,150);
 const t=payload.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
 if(!t)throw Error('Gemini returned no text. Try a clearer photo.');
 let parsed;try{parsed=JSON.parse(t);}catch{throw Error('Gemini returned an unreadable answer. Please scan again.');}
 if(!Array.isArray(parsed.items))throw Error('Gemini did not return a list. Please scan again.');
 return parsed.items.filter(x=>typeof x==='string').map(x=>x.trim()).filter(Boolean).slice(0,150);
}
runOcr=async function geminiRunOcr(file,prefix){
 if(!file)throw Error('Take or choose a photo first.');
 if(file.size>18*1024*1024)throw Error('Please choose a photo smaller than 18 MB.');
 const s=ai2Settings();
 if(!s.url&&!s.key){document.getElementById('ai2Settings').open=true;throw Error('Enter a free Gemini API key in AI photo reader first.');}
 if(!AI2_MODELS.includes(s.model))throw Error('Unsupported AI model.');
 if(s.url&&!/^https:\/\/[^?#]+\/ocr\/?$/.test(s.url))throw Error('Worker URL must use HTTPS and end with /ocr.');
 setOcrMessage(prefix,'Preparing image for AI…',10);
 const image=await ai2Prepare(file);
 setOcrMessage(prefix,'Gemini is reading the Chinese text…',40);
 let url,headers,body;
 if(s.url){
  if(!s.code)throw Error('Enter your private Worker family access code.');
  url=s.url;headers={'Content-Type':'application/json','x-tingxie-token':s.code};
  body={model:s.model,kind:prefix,imageBase64:image};
 }else{
  url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(s.model)+':generateContent';
  headers={'Content-Type':'application/json','x-goog-api-key':s.key};
  body={contents:[{role:'user',parts:[{text:ai2Prompt(prefix)},{inline_data:{mime_type:'image/jpeg',data:image}}]}],
   generationConfig:{responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{items:{type:'ARRAY',items:{type:'STRING'}}},required:['items']},temperature:0}};
 }
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 try{
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){
   if(response.status===429)throw Error('AI free-tier quota reached. Try again later.');
   if(response.status===401||response.status===403)throw Error('AI access denied. Check the Gemini key or family code.');
   throw Error('AI request failed ('+response.status+'): '+String(payload.error?.message||'Check settings and connection.').slice(0,160));
  }
  const items=ai2Items(payload);if(!items.length)throw Error('No Chinese words found. Try another photo.');
  setOcrMessage(prefix,'AI scan finished — review and edit the words.',100);
  return items.join('\n');
 }catch(e){if(e.name==='AbortError')throw Error('AI scanning timed out. Try a smaller photo.');throw e;}
 finally{clearTimeout(timer);}
};
