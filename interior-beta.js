(function(){
 'use strict';
 const start=document.getElementById('start'),message=document.getElementById('message'),frame=document.getElementById('betaFrame'),signout=document.getElementById('signout');
 let active=false,client=null,loading=false,wantsStart=false,expiryTimer=null,generation=0;
 // 저장된 결과 다시 보기: /interior-beta?r=<id>
 const viewId=(()=>{const v=new URLSearchParams(location.search).get('r')||'';return /^[0-9a-f-]{36}$/i.test(v)?v:'';})();if(viewId)wantsStart=true;
 function clear(text){generation++;frame.hidden=true;frame.removeAttribute('srcdoc');document.body.classList.remove('frame-open');start.hidden=false;start.disabled=!(active||viewId);message.textContent=text;clearTimeout(expiryTimer);}
 async function status(){try{const res=await fetch('/api/interior-beta',{cache:'no-store'});if(!res.ok)throw Error();const data=await res.json();active=data.active===true;start.disabled=!(active||viewId);message.textContent=viewId?'로그인하면 저장된 결과를 불러옵니다.':active?'회원가입·로그인 후 무료로 참여할 수 있습니다.':'11월 무료 베타 운영 기간이 아닙니다.';if(viewId)start.textContent='저장된 결과 보기';}catch{active=false;message.textContent='운영 상태를 확인하지 못했습니다. 잠시 후 새로고침해 주세요.';}}
 async function open(){if((!active&&!viewId)||loading)return;loading=true;start.disabled=true;const epoch=generation;
  try{const {data,error}=await client.auth.getSession();if(error)throw Error();if(!data.session){wantsStart=true;SkoposAuth.showGate({title:'인테리어 공간욕구검사 무료 베타',subtitle:'회원가입·로그인 후 참여할 수 있습니다.<br>결과는 로그인한 계정에 저장돼요 (베타).',cta:'로그인하고 무료 베타 시작'});return;}
   const res=await fetch('/api/interior-beta',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,apikey:SkoposAuth.CONFIG.anon,'Content-Type':'application/json'},body:JSON.stringify({mode:viewId?'view':'test'}),cache:'no-store'});const result=await res.json();if(epoch!==generation)return;
   if(res.status===410){active=false;clear('11월 무료 베타가 종료되었습니다.');return;}
   if(res.status===401){clear('회원가입·로그인이 필요합니다. 다시 로그인해 주세요.');SkoposAuth.showGate({title:'인테리어 공간욕구검사 무료 베타',subtitle:'회원가입·로그인 후 참여할 수 있습니다.<br>결과는 로그인한 계정에 저장돼요 (베타).',cta:'로그인하고 무료 베타 시작'});return;}
   if(!res.ok||typeof result.html!=='string')throw Error();if(viewId)frame.addEventListener('load',()=>restoreSaved(epoch),{once:true});else{draftUser=data.session.user.id;frame.addEventListener('load',()=>offerDraft(epoch),{once:true});}frame.srcdoc=result.html;frame.hidden=false;document.body.classList.add('frame-open');start.hidden=true;signout.hidden=false;message.textContent=viewId?'저장된 결과를 보는 중입니다.':'11월 무료 베타 참여 중 · 결과는 내 계정에 저장돼요.';wantsStart=false;
   const remaining=result.endsAt-result.serverNow;if(!viewId)expiryTimer=setTimeout(()=>{active=false;if(frame.hidden)clear('11월 무료 베타가 종료되었습니다.');else message.textContent='베타 기간이 끝났지만, 진행 중인 검사는 끝까지 마치고 결과를 저장할 수 있어요.';},Math.max(0,Math.min(remaining,2147483647)));
  }catch{clear('검사 화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');}finally{loading=false;start.disabled=!active;}
 }
 start.addEventListener('click',()=>{wantsStart=true;open();});signout.addEventListener('click',async()=>{clearDraft();clear('로그아웃 중입니다.');await client.auth.signOut();signout.hidden=true;clear('로그아웃했습니다. 다시 로그인하여 참여할 수 있습니다.');});
 (async()=>{await status();if(!active&&!viewId)return;try{client=await SkoposAuth.getClient();client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||!session){wantsStart=false;signout.hidden=true;clear('회원가입·로그인 후 무료로 참여할 수 있습니다.');}else{signout.hidden=false;if(wantsStart)setTimeout(open,0);}});await SkoposAuth.guard({passive:true,onReady(){signout.hidden=false;start.textContent=viewId?'저장된 결과 보기':'무료 베타 시작하기';if(wantsStart)setTimeout(open,0);}});// 로그인 만료일 때만 화면을 닫고, 일시적인 통신 오류에는 검사를 유지
  setInterval(async()=>{if(frame.hidden)return;try{const {data,error}=await client.auth.getUser();const expired=error?[400,401,403].includes(error.status):!data.user;if(expired){clear('로그인이 만료되었습니다. 다시 로그인하면 하던 검사를 이어서 할 수 있어요.');}else if(error){message.textContent='연결이 잠시 불안정해요. 검사는 계속할 수 있어요.';}}catch{message.textContent='연결이 잠시 불안정해요. 검사는 계속할 수 있어요.';}},60000);}catch{active=false;start.disabled=true;message.textContent='로그인 서비스를 불러오지 못했습니다. 새로고침해 주세요.';}})();
 // 제한 시간 조정용: 문항별 응답 시간·시간 초과 여부만 이름 없이 기록 (답변 내용·계정 정보는 보내지 않음)
 window.addEventListener('message',async function(e){
  if(e.source!==frame.contentWindow||!e.data||e.data.type!=='sdti-interior-timing'||!Array.isArray(e.data.items))return;
  try{
   if(!client)return;
   const lim=Number(e.data.limit)||0;
   const rows=e.data.items.slice(0,64).filter(x=>/^q\d{2}$/.test(x.q)&&['answered','partial','timeout'].includes(x.st)).map(x=>({event:'interior_q_'+x.st,result_type:x.q,value:Math.max(0,Math.min(600000,Math.round(Number(x.ms)||0))),page:'/interior-beta',utm_content:'limit_'+(Number(x.lim)||lim)}));
   if(rows.length)await client.from('funnel_events').insert(rows);
  }catch(_){}
 });
 const TYPE_NAMES={sanctuary_deep:'고요한 회복형',sanctuary_zen:'비움 추구형',nature_forest:'초록 충전형',nature_earth:'핸드메이드 감성형',luxe_royal:'품격 감각형',luxe_gallery:'갤러리 큐레이터형',artistic_wild:'개성 표현형',artistic_indie:'빈티지 스토리형',minimal_pure:'순수 미니멀형',minimal_grid:'구조·정렬 추구형',cozy_hearth:'포근한 회복형',cozy_family:'함께하는 공간형'};
 // 검사 화면에서 '정밀검사 결과 불러오기'를 누르면 로그인한 본인의 최근 정밀검사 결과만 전달 (서버에 새로 저장하지 않음)
 window.addEventListener('message',async function(e){
  if(e.source!==frame.contentWindow||!e.data||e.data.type!=='sdti-premium-request')return;
  const reply=m=>{try{frame.contentWindow.postMessage(Object.assign({type:'sdti-premium-result'},m),window.location.origin);}catch(_){}};
  try{
   if(!client)throw Error();
   const {data:s}=await client.auth.getSession();
   if(!s||!s.session){reply({ok:false,message:'로그인이 필요해요. 다시 로그인해 주세요.'});return;}
   const {data,error}=await client.from('premium_results').select('result_type,scores,created_at').eq('user_id',s.session.user.id).order('created_at',{ascending:false}).limit(1);
   if(error)throw error;
   if(!data||!data.length){reply({ok:false,message:'이 계정에 저장된 정밀검사 결과가 없어요. 결과지를 보고 상위 욕구를 직접 골라 주세요.'});return;}
   const r=data[0],sc=r.scores||{};
   const top=Object.keys(sc).filter(k=>typeof sc[k]==='number').sort((a,b)=>sc[b]-sc[a]).slice(0,3);
   const d=new Date(r.created_at),date=d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+String(d.getDate()).padStart(2,'0');
   reply({ok:true,data:{type:r.result_type,typeName:TYPE_NAMES[r.result_type]||'정밀검사 유형',date,top}});
  }catch(_){reply({ok:false,message:'결과를 불러오지 못했어요. 잠시 후 다시 시도하거나 직접 골라 주세요.'});}
 });
 // 진행 중 답변 임시 저장: 이 기기(브라우저)에만 7일 보관, 서버로 보내지 않음. 결과 저장·새로 시작·로그아웃 시 삭제
 let draftUser='';const DKEY='skopos_interior_draft_v1',DTTL=7*24*3600*1000;
 function readDraft(){try{const d=JSON.parse(localStorage.getItem(DKEY)||'null');if(!d||d.uid!==draftUser||Date.now()-d.ts>DTTL||!d.state)return null;return d;}catch(_){return null;}}
 function clearDraft(){try{localStorage.removeItem(DKEY);}catch(_){}}
 function offerDraft(epoch){if(epoch!==generation)return;const d=readDraft();if(!d)return;setTimeout(()=>{try{frame.contentWindow.postMessage({type:'sdti-interior-draft-offer',state:d.state,ts:d.ts},'*');}catch(_){}},600);}
 window.addEventListener('message',function(e){
  if(e.source!==frame.contentWindow||!e.data)return;
  if(e.data.type==='sdti-interior-draft'&&draftUser&&e.data.state&&typeof e.data.state==='object'){try{const raw=JSON.stringify({uid:draftUser,ts:Date.now(),state:e.data.state});if(raw.length<300000)localStorage.setItem(DKEY,raw);}catch(_){}}
  if(e.data.type==='sdti-interior-draft-clear'||e.data.type==='sdti-interior-exit')clearDraft();
 });
 // 결과 저장 (베타): 로그인한 본인 계정에만 저장, RLS로 본인만 조회
 window.addEventListener('message',async function(e){
  if(e.source!==frame.contentWindow||!e.data||e.data.type!=='sdti-interior-save')return;
  const reply=m=>{try{frame.contentWindow.postMessage(Object.assign({type:'sdti-interior-saved'},m),'*');}catch(_){}};
  try{
   if(!client)throw Error();const {data:s}=await client.auth.getSession();if(!s||!s.session){reply({ok:false,message:'로그인이 만료되어 저장하지 못했어요. PDF로 저장해 주세요.'});return;}
   const d=e.data,row={scores:d.scores&&typeof d.scores==='object'?d.scores:{},top:Array.isArray(d.top)?d.top.slice(0,3).map(String):[],form_state:d.state&&typeof d.state==='object'?d.state:{},version:'beta',updated_at:new Date().toISOString()};
   let res;
   if(d.id&&/^[0-9a-f-]{36}$/i.test(d.id))res=await client.from('interior_results').update(row).eq('id',d.id).eq('user_id',s.session.user.id).select('id,created_at').single();
   else res=await client.from('interior_results').insert(Object.assign({user_id:s.session.user.id},row)).select('id,created_at').single();
   if(res.error)throw res.error;
   clearDraft();reply({ok:true,id:res.data.id,date:res.data.created_at});
  }catch(_){reply({ok:false,message:'결과를 저장하지 못했어요. PDF로 저장해 주세요.'});}
 });
 async function restoreSaved(epoch){
  const send=m=>{try{frame.contentWindow.postMessage(Object.assign({type:'sdti-interior-restore'},m),'*');}catch(_){}};
  try{
   const {data:s}=await client.auth.getSession();if(epoch!==generation)return;
   const {data,error}=await client.from('interior_results').select('id,created_at,form_state').eq('id',viewId).eq('user_id',s.session.user.id).maybeSingle();
   if(error||!data){send({ok:false,message:'저장된 결과를 찾지 못했어요. 마이페이지에서 다시 선택해 주세요.'});return;}
   send({ok:true,id:data.id,date:data.created_at,state:data.form_state,readonly:!active});
  }catch(_){send({ok:false,message:'저장된 결과를 불러오지 못했어요.'});}
 }
 window.addEventListener('message',function(e){if(e.source!==frame.contentWindow)return;if(e.data&&e.data.type==='sdti-interior-exit'){clear('검사를 나왔습니다. 다시 시작할 수 있어요.');signout.hidden=false;}});
})();


