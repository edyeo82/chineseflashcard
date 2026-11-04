'use strict';
// Ting Xie V2: centrally configured Firebase AI Logic OCR.
// No user-generated Gemini keys. No public Gemini credential in source.
let ai2BackendPromise=null;
const ai2ModelName='gemini-3.5-flash-lite';

function ai2Install(){
  const scan=document.getElementById('scanSourceButton');
  if(!scan||document.getElementById('ai2Info'))return;
  scan.textContent='✨ Read photo with AI';
  const info=document.createElement('div');
  info.id='ai2Info';
  info.className='ai2box';
  info.innerHTML='<strong>✨ AI photo reader</strong><p>Take or choose a photo, then tap <b>Read photo with AI</b>. No account, API key, or setup needed for learners. AI can make mistakes; check the words before practising. Crop out names and personal information before scanning.</p><p id="ai2Status" role="status">AI photo scanning uses the app’s shared Firebase service.</p>';
  scan.insertAdjacentElement('afterend',info);
  const start=document.getElementById('startDictationButton');
  if(start){
    const mark=document.createElement('button');
    mark.className='ai2mark';
    mark.type='button';
    mark.textContent='📝 Optional: mark handwritten answers with AI';
    mark.addEventListener('click',()=>{
      const words=extractItems(document.getElementById('wordList').value);
      if(!words.length){showToast('Add your Chinese words first.');return;}
      state.sessionWords=words.slice();
      const p=document.getElementById('markingPanel');
      if(p){p.hidden=false;p.removeAttribute('aria-hidden');}
      const step=document.querySelector('.step[data-step="marking"]');
      if(step){step.hidden=false;step.removeAttribute('aria-hidden');}
      setPanel('marking');
    });
    start.insertAdjacentElement('afterend',mark);
  }
}
window.addEventListener('DOMContentLoaded',ai2Install);

function setOcrMessage(prefix,message,percent){
  const block=document.getElementById(prefix+'Progress');
  const bar=document.getElementById(prefix+'ProgressBar');
  const label=document.getElementById(prefix+'ProgressText');
  if(block)block.classList.remove('hidden');
  if(bar)bar.style.width=String(percent||0)+'%';
  if(label)label.textContent=message;
}

async function ai2GetModel(){
  if(ai2BackendPromise)return ai2BackendPromise;
  ai2BackendPromise=(async()=>{
    const config=window.TINGXIE_V2_AI_CONFIG;
    if(!config||!config.firebase||!config.appCheckSiteKey){
      throw new Error('AI photo scanning has not been activated by the site owner yet. You can still type or paste words manually.');
    }
    const VERSION='13.0.0';
    const [appSdk,checkSdk,aiSdk]=await Promise.all([
      import('https://www.gstatic.com/firebasejs/'+VERSION+'/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/'+VERSION+'/firebase-app-check.js'),
      import('https://www.gstatic.com/firebasejs/'+VERSION+'/firebase-ai.js')
    ]);
    const app=appSdk.getApps().find(a=>a.name==='tingxie-v2-ai')||
      appSdk.initializeApp(config.firebase,'tingxie-v2-ai');
    checkSdk.initializeAppCheck(app,{
      provider:new checkSdk.ReCaptchaEnterpriseProvider(config.appCheckSiteKey),
      isTokenAutoRefreshEnabled:true
    });
    const backend=aiSdk.getAI(app,{backend:new aiSdk.GoogleAIBackend()});
    const schema=aiSdk.Schema.object({
      properties:{items:aiSdk.Schema.array({items:aiSdk.Schema.string()})}
    });
    return aiSdk.getGenerativeModel(backend,{
      model:config.model||ai2ModelName,
      generationConfig:{
        temperature:0,
        responseMimeType:'application/json',
        responseSchema:schema
      }
    });
  })();
  try{return await ai2BackendPromise;}
  catch(e){ai2BackendPromise=null;throw e;}
}

function ai2CompressPhoto(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file),img=new Image();
    img.onload=()=>{
      URL.revokeObjectURL(url);
      const scale=Math.min(1,2400/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      const ctx=canvas.getContext('2d');
      if(!ctx)return reject(new Error('Unable to process the photo.'));
      ctx.fillStyle='#fff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      canvas.toBlob(blob=>{
        if(!blob)return reject(new Error('Photo could not be compressed.'));
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result).split(',')[1]);
        reader.onerror=()=>reject(new Error('Photo could not be read.'));
        reader.readAsDataURL(blob);
      },'image/jpeg',0.84);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('The photo could not be opened.'));};
    img.src=url;
  });
}

function ai2Prompt(prefix){
  if(prefix==='answer')return 'Transcribe this Singapore primary school handwritten Chinese spelling answer sheet faithfully. Output one item per numbered answer line, in natural reading order. Preserve the exact original characters, including spelling mistakes. Do not correct answers. For a blank numbered line output （空白）. For unreadable writing output （看不清）. Exclude headings, names, pinyin, English, line numbers, and explanations. Never invent missing answers.';
  return 'Extract only the Chinese 听写 vocabulary words or short phrases on this worksheet photo. Output one item per word or phrase, in reading order. Ignore child names, dates, headings, numbers, pinyin, translations and example sentences unless a whole sentence is explicitly an item to dictate. Do not invent words or silently fix uncertain Chinese characters. For unreadable items output （看不清）.';
}

function ai2ParseResult(text){
  let parsed;
  try{parsed=JSON.parse(text);}
  catch{
    const cleaned=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    try{parsed=JSON.parse(cleaned);}catch{throw new Error('AI returned an unreadable result. Please try scanning again.');}
  }
  const words=Array.isArray(parsed?.items)?parsed.items
    .filter(x=>typeof x==='string').map(x=>x.trim()).filter(Boolean).slice(0,150):[];
  if(!words.length)throw new Error('No Chinese words were found. Try another photo.');
  return words.join('\n');
}

runOcr=async function firebaseAiOcr(file,prefix){
  if(!file)throw new Error('Choose a photo first.');
  if(file.size>18*1024*1024)throw new Error('Photo is too large. Try a smaller image.');
  setOcrMessage(prefix,'Preparing AI reader…',8);
  try{
    const model=await ai2GetModel();
    setOcrMessage(prefix,'Preparing photo…',20);
    const base64=await ai2CompressPhoto(file);
    setOcrMessage(prefix,'AI is reading your Chinese words…',55);
    const result=await model.generateContent([
      ai2Prompt(prefix),
      {inlineData:{mimeType:'image/jpeg',data:base64}}
    ]);
    const output=result?.response?.text?.()||'';
    const words=ai2ParseResult(output);
    setOcrMessage(prefix,'AI scan completed. Review the text.',100);
    return words;
  }catch(error){
    const message=String(error?.message||error);
    if(/quota|429|resource.exhausted/i.test(message))throw new Error('Daily free AI scanning limit reached. Try again tomorrow, or type the list.');
    if(/app.check|recaptcha|403|permission.denied|not.enabled|not.activated|API.*disabled/i.test(message))throw new Error('AI photo scanning is not fully enabled by the site owner yet. Please try again later, or type the words.');
    if(/fetch|network|offline/i.test(message))throw new Error('Could not connect to the AI service. Check your connection and try again.');
    throw error;
  }
};
