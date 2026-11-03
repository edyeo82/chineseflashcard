// Optional secure Gemini proxy. Set GEMINI_API_KEY and FAMILY_ACCESS_CODE
// as Cloudflare Worker secrets. Never commit either secret.
const instructions={
 source:'Extract the Chinese 听写 vocabulary words and short phrases from this photo, in reading order. Exclude names, titles, dates, pinyin, numbers, examples, and translations. Do not invent text; use （看不清） for unreadable text.',
 answer:'Transcribe handwritten Chinese spelling answers in order, preserving mistakes. Use （空白） for blank numbered lines and （看不清） for unreadable handwriting. Exclude names, question numbers and explanations. Do not invent answers.'
};
export default {async fetch(request,env){
 const origin=request.headers.get('Origin')||'',allowed=env.ALLOWED_ORIGIN||'https://edyeo82.github.io';
 const headers={'Access-Control-Allow-Origin':origin===allowed?allowed:'null','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, x-tingxie-token','Vary':'Origin','Cache-Control':'no-store'};
 const reply=(body,status)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(origin!==allowed)return reply({error:{message:'Origin denied'}},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST'||new URL(request.url).pathname!=='/ocr')return reply({error:{message:'Not found'}},404);
 if(!env.GEMINI_API_KEY||!env.FAMILY_ACCESS_CODE)return reply({error:{message:'Secrets missing'}},503);
 if(request.headers.get('x-tingxie-token')!==env.FAMILY_ACCESS_CODE)return reply({error:{message:'Invalid family code'}},401);
 if(Number(request.headers.get('content-length')||0)>7e6)return reply({error:{message:'Image too large'}},413);
 let req;try{req=await request.json();}catch{return reply({error:{message:'Invalid JSON'}},400);}
 if(!req||!['source','answer'].includes(req.kind)||!['gemini-2.5-flash-lite','gemini-2.5-flash'].includes(req.model)||typeof req.imageBase64!=='string'||req.imageBase64.length<100||req.imageBase64.length>7e6||!/^[a-zA-Z0-9+/=]+$/.test(req.imageBase64))return reply({error:{message:'Invalid request'}},400);
 const body={contents:[{role:'user',parts:[{text:instructions[req.kind]},{inline_data:{mime_type:'image/jpeg',data:req.imageBase64}}]}],generationConfig:{responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{items:{type:'ARRAY',items:{type:'STRING'}}},required:['items']},temperature:0}};
 try{
  const res=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+req.model+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify(body)});
  const result=await res.json().catch(()=>({}));
  if(!res.ok)return reply({error:{message:result.error?.message||'Gemini API failed'}},res.status);
  let parsed;try{parsed=JSON.parse(result.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'');}catch{return reply({error:{message:'Could not parse AI result'}},502);}
  const items=Array.isArray(parsed.items)?parsed.items.filter(v=>typeof v==='string').map(v=>v.trim()).filter(Boolean).slice(0,150):[];
  return reply({items},200);
 }catch{return reply({error:{message:'AI service unavailable'}},502);}
}};
