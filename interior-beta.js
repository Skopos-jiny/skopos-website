(function(){
 'use strict';
 const start=document.getElementById('start'),message=document.getElementById('message'),frame=document.getElementById('betaFrame'),signout=document.getElementById('signout');
 let active=false,client=null,loading=false,wantsStart=false,expiryTimer=null,generation=0;
 function clear(text){generation++;frame.hidden=true;frame.removeAttribute('srcdoc');document.body.classList.remove('frame-open');start.hidden=false;start.disabled=!active;message.textContent=text;clearTimeout(expiryTimer);}
 async function status(){try{const res=await fetch('/api/interior-beta',{cache:'no-store'});if(!res.ok)throw Error();const data=await res.json();active=data.active===true;start.disabled=!active;message.textContent=active?'회원가입·로그인 후 무료로 참여할 수 있습니다.':'11월 무료 베타 운영 기간이 아닙니다.';}catch{active=false;message.textContent='운영 상태를 확인하지 못했습니다. 잠시 후 새로고침해 주세요.';}}
 async function open(){if(!active||loading)return;loading=true;start.disabled=true;const epoch=generation;
  try{const {data,error}=await client.auth.getSession();if(error)throw Error();if(!data.session){wantsStart=true;SkoposAuth.showGate({title:'인테리어 공간욕구검사 무료 베타',subtitle:'회원가입·로그인 후 참여할 수 있습니다.<br>베타 답변·결과는 자동 저장되지 않으니 PDF로 저장해 주세요.',cta:'로그인하고 무료 베타 시작'});return;}
   const res=await fetch('/api/interior-beta',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,apikey:SkoposAuth.CONFIG.anon},cache:'no-store'});const result=await res.json();if(epoch!==generation)return;
   if(res.status===410){active=false;clear('11월 무료 베타가 종료되었습니다.');return;}
   if(res.status===401){clear('회원가입·로그인이 필요합니다. 다시 로그인해 주세요.');SkoposAuth.showGate({title:'인테리어 공간욕구검사 무료 베타',subtitle:'회원가입·로그인 후 참여할 수 있습니다.<br>베타 답변·결과는 자동 저장되지 않으니 PDF로 저장해 주세요.',cta:'로그인하고 무료 베타 시작'});return;}
   if(!res.ok||typeof result.html!=='string')throw Error();frame.srcdoc=result.html;frame.hidden=false;document.body.classList.add('frame-open');start.hidden=true;signout.hidden=false;message.textContent='11월 무료 베타 참여 중 · 결과 화면에서 PDF를 저장해 주세요.';wantsStart=false;
   const remaining=result.endsAt-result.serverNow;expiryTimer=setTimeout(()=>{active=false;clear('11월 무료 베타가 종료되었습니다.');},Math.max(0,Math.min(remaining,2147483647)));
  }catch{clear('검사 화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');}finally{loading=false;start.disabled=!active;}
 }
 start.addEventListener('click',()=>{wantsStart=true;open();});signout.addEventListener('click',async()=>{clear('로그아웃 중입니다.');await client.auth.signOut();signout.hidden=true;clear('로그아웃했습니다. 다시 로그인하여 참여할 수 있습니다.');});
 (async()=>{await status();if(!active)return;try{client=await SkoposAuth.getClient();client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||!session){wantsStart=false;signout.hidden=true;clear('회원가입·로그인 후 무료로 참여할 수 있습니다.');}else{signout.hidden=false;if(wantsStart)setTimeout(open,0);}});await SkoposAuth.guard({passive:true,onReady(){signout.hidden=false;start.textContent='무료 베타 시작하기';if(wantsStart)setTimeout(open,0);}});setInterval(async()=>{if(frame.hidden)return;try{const {data,error}=await client.auth.getUser();if(error||!data.user){clear('로그인이 만료되었습니다. 다시 로그인해 주세요.');}}catch{clear('로그인을 확인하지 못했습니다. 다시 로그인해 주세요.');}},60000);}catch{active=false;start.disabled=true;message.textContent='로그인 서비스를 불러오지 못했습니다. 새로고침해 주세요.';}})();
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
 window.addEventListener('message',function(e){if(e.source!==frame.contentWindow)return;if(e.data&&e.data.type==='sdti-interior-exit'){clear('검사를 나왔습니다. 다시 시작할 수 있어요.');signout.hidden=false;}});
})();


