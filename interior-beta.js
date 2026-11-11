(function(){
 'use strict';
 const start=document.getElementById('start'),message=document.getElementById('message'),frame=document.getElementById('betaFrame'),signout=document.getElementById('signout');
 let active=false,client=null,loading=false,wantsStart=false,expiryTimer=null,generation=0;
 function clear(text){generation++;frame.hidden=true;frame.removeAttribute('srcdoc');document.body.classList.remove('frame-open');start.hidden=false;start.disabled=!active;message.textContent=text;clearTimeout(expiryTimer);}
 async function status(){try{const res=await fetch('/api/interior-beta',{cache:'no-store'});if(!res.ok)throw Error();const data=await res.json();active=data.active===true;start.disabled=!active;message.textContent=active?'회원가입·로그인 후 무료로 참여할 수 있습니다.':'11월 무료 베타 운영 기간이 아닙니다.';}catch{active=false;message.textContent='운영 상태를 확인하지 못했습니다. 잠시 후 새로고침해 주세요.';}}
 async function open(){if(!active||loading)return;loading=true;start.disabled=true;const epoch=generation;
  try{const {data,error}=await client.auth.getSession();if(error)throw Error();if(!data.session){wantsStart=true;SkoposAuth.showGate();return;}
   const res=await fetch('/api/interior-beta',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,apikey:SkoposAuth.CONFIG.anon},cache:'no-store'});const result=await res.json();if(epoch!==generation)return;
   if(res.status===410){active=false;clear('11월 무료 베타가 종료되었습니다.');return;}
   if(res.status===401){clear('회원가입·로그인이 필요합니다. 다시 로그인해 주세요.');SkoposAuth.showGate();return;}
   if(!res.ok||typeof result.html!=='string')throw Error();frame.srcdoc=result.html;frame.hidden=false;document.body.classList.add('frame-open');start.hidden=true;signout.hidden=false;message.textContent='11월 무료 베타 참여 중 · 결과 화면에서 PDF를 저장해 주세요.';wantsStart=false;
   const remaining=result.endsAt-result.serverNow;expiryTimer=setTimeout(()=>{active=false;clear('11월 무료 베타가 종료되었습니다.');},Math.max(0,Math.min(remaining,2147483647)));
  }catch{clear('검사 화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');}finally{loading=false;start.disabled=!active;}
 }
 start.addEventListener('click',()=>{wantsStart=true;open();});signout.addEventListener('click',async()=>{clear('로그아웃 중입니다.');await client.auth.signOut();signout.hidden=true;clear('로그아웃했습니다. 다시 로그인하여 참여할 수 있습니다.');});
 (async()=>{await status();if(!active)return;try{client=await SkoposAuth.getClient();client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||!session){wantsStart=false;signout.hidden=true;clear('회원가입·로그인 후 무료로 참여할 수 있습니다.');}else{signout.hidden=false;if(wantsStart)setTimeout(open,0);}});await SkoposAuth.guard({passive:true,onReady(){signout.hidden=false;start.textContent='무료 베타 시작하기';if(wantsStart)setTimeout(open,0);}});setInterval(async()=>{if(frame.hidden)return;try{const {data,error}=await client.auth.getUser();if(error||!data.user){clear('로그인이 만료되었습니다. 다시 로그인해 주세요.');}}catch{clear('로그인을 확인하지 못했습니다. 다시 로그인해 주세요.');}},60000);}catch{active=false;start.disabled=true;message.textContent='로그인 서비스를 불러오지 못했습니다. 새로고침해 주세요.';}})();
})();
