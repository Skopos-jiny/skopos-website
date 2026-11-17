(function(){
 'use strict';
 const start=document.getElementById('start'),message=document.getElementById('message'),frame=document.getElementById('betaFrame'),signout=document.getElementById('signout');
 let active=false,official=false,client=null,loading=false,wantsStart=false,expiryTimer=null,generation=0;
 const ORDER_FN='https://rgbukqphcqptnfeqipfn.supabase.co/functions/v1/interior-order';
 // 정식판(12/1~): 이용권이 없을 때 구매 화면으로 가는 버튼
 let buyLink=null;function showBuy(on){if(!buyLink){buyLink=document.createElement('a');buyLink.href='/interior-pay';buyLink.className='buy-link';buyLink.textContent='이용권 구매하기';buyLink.style.cssText='display:block;max-width:320px;margin:10px auto 0;padding:12px 16px;border-radius:50px;background:#E91E8C;color:#fff;font-weight:800;text-align:center;text-decoration:none';message.insertAdjacentElement('afterend',buyLink);}buyLink.hidden=!on;buyLink.style.display=on?'block':'none';}
 // 저장된 결과 다시 보기: /interior-beta?r=<id>
 const viewId=(()=>{const v=new URLSearchParams(location.search).get('r')||'';return /^[0-9a-f-]{36}$/i.test(v)?v:'';})();if(viewId)wantsStart=true;
 // 업체 상담 가이드 보기: /interior-beta?g=<고객 항목 id> · 업체 초대 검사: /interior-beta?i=<초대 코드>
 const QS=new URLSearchParams(location.search);
 const guideId=(()=>{const v=QS.get('g')||'';return !viewId&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)?v:'';})();if(guideId)wantsStart=true;
 const inviteCode=(()=>{const v=(QS.get('i')||'').toLowerCase();return !viewId&&!guideId&&/^[0-9a-f]{16}$/.test(v)?v:'';})();
 let inviteOk=false,inviteBiz='',inviteDone=false,inviteRun=false;const invCard=document.getElementById('inviteCard'),invAgree=document.getElementById('invAgree');
 const canStart=()=>inviteCode?(inviteOk&&!!invAgree&&invAgree.checked):!!(active||official||viewId||guideId);
 const GATE_INVITE=()=>({title:'SDTI 인테리어 공간욕구검사',subtitle:(inviteBiz||'업체')+'에서 보낸 검사예요.<br>로그인하면 바로 시작할 수 있고, 결과는 로그인한 계정에 저장돼요.',cta:'로그인하고 시작하기'});
 const GATE_GUIDE={title:'업체 화면',subtitle:'업체 계정으로 로그인하면 고객이 공유한 상담 가이드를 볼 수 있어요.',cta:'로그인하기'};
 // 초대받은 고객에게는 고객용 리포트만, 업체에는 상담 가이드만 보여 준다
 function frameCss(css){try{const d=frame.contentDocument;if(!d)return;const s=d.createElement('style');s.textContent=css;(d.head||d.documentElement).appendChild(s);}catch(_){}}
 async function loadInvite(){try{const {data,error}=await client.rpc('invite_info',{p_code:inviteCode});if(error)throw error;
   if(!data||data.ok!==true){inviteOk=false;message.textContent='사용할 수 없는 초대 링크예요. 링크를 보낸 업체에 다시 요청해 주세요.';start.disabled=true;return;}
   if(data.test_type==='premium'){location.replace('/skopos_premium_quiz.html?i='+inviteCode);return;}
  inviteBiz=String(data.business_name||'');document.querySelectorAll('.inv-biz').forEach(el=>{el.textContent=inviteBiz;});
   if(data.taken_by_other&&data.status!=='invited'){const {data:s}=await client.auth.getSession();if(s&&s.session){inviteOk=false;message.textContent='이 초대 링크는 다른 계정에서 이미 사용했어요. 처음 시작한 계정으로 로그인하거나, 업체에 새 링크를 요청해 주세요.';start.disabled=true;return;}}
   if(data.status==='completed'&&!data.taken_by_other){inviteOk=false;inviteDone=true;message.textContent='이 초대 검사는 이미 마쳤어요. 결과는 마이페이지에서 다시 볼 수 있어요.';start.disabled=true;return;}
   inviteOk=true;if(invCard)invCard.hidden=false;start.textContent=data.status==='testing'&&!data.taken_by_other?'검사 이어서 하기':'동의하고 검사 시작';message.textContent='아래 안내를 확인하고 동의하면 검사를 시작할 수 있어요.';start.disabled=!canStart();
  }catch(_){inviteOk=false;message.textContent='초대 정보를 확인하지 못했어요. 잠시 후 새로고침해 주세요.';start.disabled=true;}}
 if(invAgree)invAgree.addEventListener('change',()=>{start.disabled=!canStart();});
 // 앱 안 브라우저(카카오톡·인스타그램·네이버 등): 로그인과 PDF 저장이 막힐 수 있어 기본 브라우저로 여는 길을 안내
 const UA=navigator.userAgent||'',INAPP=/KAKAOTALK|Instagram|FBAN|FBAV|FB_IAB|NAVER\(inapp|DaumApps|Line\/|BAND\/|Barcelona/i.test(UA);
 const byId=id=>document.getElementById(id);let savedId='',sheetPrint=null;const sheet=byId('inappSheet');
 const HELP_OPEN="열리지 않으면 화면의 메뉴(⋯ 또는 공유 버튼)에서 '다른 브라우저로 열기'를 고르거나, 링크를 복사해 브라우저 주소창에 붙여 넣어 주세요.";
 function externalUrl(u){if(/KAKAOTALK/i.test(UA))return 'kakaotalk://web/openExternal?url='+encodeURIComponent(u);if(/Android/i.test(UA))return 'intent://'+u.replace(/^https?:\/\//,'')+'#Intent;scheme=https;package=com.android.chrome;end';if(/iPhone|iPad|iPod/i.test(UA))return 'x-safari-'+u;return '';}
 function openExternal(u,help){const x=externalUrl(u);if(x){try{window.location.href=x;}catch(_){}}setTimeout(()=>{help.textContent=HELP_OPEN;help.hidden=false;},x?1500:0);}
 async function copyText(t){try{await navigator.clipboard.writeText(t);return true;}catch(_){try{const a=document.createElement('textarea');a.value=t;a.setAttribute('readonly','');a.style.cssText='position:fixed;top:0;left:0;opacity:0';document.body.appendChild(a);a.select();a.setSelectionRange(0,t.length);const ok=document.execCommand('copy');a.remove();return ok;}catch(e){return false;}}}
 async function copyLink(u,help){const ok=await copyText(u);help.textContent=ok?'링크를 복사했어요. Chrome이나 Safari 주소창에 붙여 넣어 주세요.':'복사하지 못했어요. 주소창의 주소를 길게 눌러 복사해 주세요.';help.hidden=false;}
 const pageUrl=()=>location.origin+location.pathname+location.search,resultUrl=id=>location.origin+'/interior-beta?r='+id;
 function hideSheet(){if(sheet)sheet.hidden=true;sheetPrint=null;}
 // 앱 안 브라우저에서 PDF 저장을 누르면 바로 인쇄하지 않고, 기본 브라우저에서 저장된 결과를 여는 길을 먼저 보여 준다
 function showSheet(orig){if(!sheet){if(orig)orig();return;}sheetPrint=orig;const id=savedId||viewId;byId('sheetText').textContent=id?'지금은 앱 안에서 열린 화면이라 PDF 저장이 안 될 수 있어요. 결과는 내 계정에 저장돼 있으니, 기본 브라우저에서 같은 계정으로 로그인하면 이 결과지를 다시 열어 저장할 수 있어요.':'지금은 앱 안에서 열린 화면이라 PDF 저장이 안 될 수 있어요. 먼저 여기서 저장을 시도해 보고, 안 되면 기본 브라우저에서 다시 열어 주세요.';byId('sheetOpen').hidden=byId('sheetCopy').hidden=!id;byId('sheetTry').hidden=!orig;byId('sheetHelp').hidden=true;sheet.hidden=false;(id?byId('sheetOpen'):orig?byId('sheetTry'):byId('sheetClose')).focus();}
 function guardPrint(){if(!INAPP)return;try{const w=frame.contentWindow;if(!w||w.__sdtiPrintGuard)return;const orig=typeof w.print==='function'?w.print.bind(w):null;w.__sdtiPrintGuard=true;w.print=function(){showSheet(orig);};}catch(_){}}
 frame.addEventListener('load',guardPrint);
 if(sheet){byId('sheetOpen').addEventListener('click',()=>openExternal(resultUrl(savedId||viewId),byId('sheetHelp')));byId('sheetCopy').addEventListener('click',()=>copyLink(resultUrl(savedId||viewId),byId('sheetHelp')));byId('sheetTry').addEventListener('click',()=>{const p=sheetPrint;hideSheet();if(p)setTimeout(p,60);});byId('sheetClose').addEventListener('click',hideSheet);sheet.addEventListener('click',e=>{if(e.target===sheet)hideSheet();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden)hideSheet();});}
 if(INAPP&&byId('inappNotice')){byId('inappNotice').hidden=false;byId('inappOpen').addEventListener('click',()=>openExternal(pageUrl(),byId('inappHelp')));byId('inappCopy').addEventListener('click',()=>copyLink(pageUrl(),byId('inappHelp')));}
 function clear(text){generation++;hideSheet();savedId='';frame.hidden=true;frame.removeAttribute('srcdoc');document.body.classList.remove('frame-open');start.hidden=false;start.disabled=!canStart();message.textContent=text;clearTimeout(expiryTimer);showBuy(false);}
 async function status(){try{const res=await fetch('/api/interior-beta',{cache:'no-store'});if(!res.ok)throw Error();const data=await res.json();active=data.active===true;official=data.official===true;if(inviteCode){start.disabled=true;start.textContent='동의하고 검사 시작';message.textContent='초대 정보를 확인하고 있어요.';return;}start.disabled=!canStart();message.textContent=guideId?'업체 계정으로 로그인하면 상담 가이드를 불러옵니다.':viewId?'로그인하면 저장된 결과를 불러옵니다.':active?'회원가입·로그인 후 무료로 참여할 수 있습니다.':official?'이용권으로 검사를 시작할 수 있어요. 결과는 내 계정에 저장돼요.':'11월 무료 베타 운영 기간이 아닙니다.';if(guideId)start.textContent='상담 가이드 보기';else if(viewId)start.textContent='저장된 결과 보기';else if(official)start.textContent='이용권으로 검사 시작';}catch{active=false;if(inviteCode||guideId)return;message.textContent='운영 상태를 확인하지 못했습니다. 잠시 후 새로고침해 주세요.';}}
 async function open(){if(!canStart()||loading||!client)return;loading=true;start.disabled=true;const epoch=generation;
  try{const {data,error}=await client.auth.getSession();if(error)throw Error();if(!data.session){wantsStart=true;SkoposAuth.showGate(inviteCode?GATE_INVITE():guideId?GATE_GUIDE:official?{title:'SDTI 인테리어 공간욕구검사',subtitle:'로그인 후 이용권으로 검사를 시작할 수 있어요.<br>결과는 로그인한 계정에 저장돼요.',cta:'로그인하고 시작하기'}:{title:'인테리어 공간욕구검사 무료 베타',subtitle:'회원가입·로그인 후 참여할 수 있습니다.<br>결과는 로그인한 계정에 저장돼요 (베타).',cta:'로그인하고 무료 베타 시작'});return;}
   // 정식판: 시작 전에 남은 이용권을 확인하고, 새 회차를 쓰는 경우 한 번 더 묻는다
   if(inviteCode){const {data:ia,error:ie}=await client.rpc('invite_accept',{p_code:inviteCode});if(epoch!==generation)return;if(ie)throw ie;
    if(!ia||ia.ok!==true){const why=ia&&ia.reason;inviteOk=false;if(invCard)invCard.hidden=true;clear(why==='taken'?'이 초대 링크는 다른 계정에서 이미 사용했어요. 처음 시작한 계정으로 로그인하거나, 업체에 새 링크를 요청해 주세요.':why==='completed'?'이 초대 검사는 이미 마쳤어요. 결과는 마이페이지에서 다시 볼 수 있어요.':'사용할 수 없는 초대 링크예요. 링크를 보낸 업체에 다시 요청해 주세요.');return;}}
   if(official&&!viewId&&!guideId&&!inviteCode){
    const st=await fetch(ORDER_FN,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({action:'status'})}).then(r=>r.json()).catch(()=>null);if(epoch!==generation)return;
    const c=st&&st.credits;
    if(c&&!c.open_session&&c.remaining<=0){clear('남은 이용권이 없어요. 이용권을 구매하면 바로 검사를 시작할 수 있어요.');showBuy(true);return;}
    if(c&&!c.open_session&&!confirm('이용권 1회를 사용해 검사를 시작할까요? (남은 이용권 '+c.remaining+'회)\n시작 후 24시간 안에는 다시 들어와도 추가로 차감되지 않아요.')){clear('검사를 시작하지 않았어요. 준비되면 다시 눌러 주세요.');return;}
   }
   const res=await fetch('/api/interior-beta',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,apikey:SkoposAuth.CONFIG.anon,'Content-Type':'application/json'},body:JSON.stringify(inviteCode?{mode:'invite',code:inviteCode}:guideId?{mode:'guide',c:guideId}:viewId?{mode:'view',r:viewId}:{mode:'test'}),cache:'no-store'});const result=await res.json().catch(()=>({}));if(epoch!==generation)return;
   if(inviteCode&&res.status===402){clear((inviteBiz||'업체')+'의 이용권이 부족해 지금은 시작할 수 없어요. 초대한 업체에 알려 주세요. 따로 결제하실 필요는 없어요.');return;}
   if(inviteCode&&res.status===403){inviteOk=false;if(invCard)invCard.hidden=true;clear(result.error==='invite_completed'?'이 초대 검사는 이미 마쳤어요. 결과는 마이페이지에서 다시 볼 수 있어요.':'이 초대 링크로는 시작할 수 없어요. 링크를 보낸 업체에 다시 요청해 주세요.');return;}
   if(guideId&&(res.status===403||res.status===404)){const g=result.error||'';clear(g==='guide_not_completed'?'고객이 아직 검사를 마치지 않았어요.':g==='guide_not_purchased'?'상담 가이드를 구매하면 볼 수 있어요. 업체 화면의 고객 목록에서 구매해 주세요.':g==='guide_not_shared'?'고객이 결과 공유를 중지해 상담 가이드를 볼 수 있는 기간이 끝났어요.':g==='guide_result_deleted'?'고객이 결과를 삭제해 상담 가이드를 볼 수 없어요.':'이 계정으로는 볼 수 없는 상담 가이드예요. 업체 계정으로 로그인했는지 확인해 주세요.');start.disabled=true;return;}
   if(res.status===410){active=false;clear(viewId?'사전 베타가 종료되어 이 결과를 열 수 없어요. 마이페이지에서 저장한 결과를 다시 선택해 주세요.':'사전 베타가 종료되었습니다. 정식판 안내는 카카오톡 채널에서 확인해 주세요.');return;}
   if(res.status===402){clear('남은 이용권이 없어요. 이용권을 구매하면 바로 검사를 시작할 수 있어요.');showBuy(true);return;}
   if(res.status===404){clear('이 계정에 저장된 결과를 찾지 못했어요. 마이페이지에서 다시 선택해 주세요.');return;}
   if(res.status===401){clear('회원가입·로그인이 필요합니다. 다시 로그인해 주세요.');SkoposAuth.showGate(inviteCode?GATE_INVITE():guideId?GATE_GUIDE:{title:'인테리어 공간욕구검사 무료 베타',subtitle:'회원가입·로그인 후 참여할 수 있습니다.<br>결과는 로그인한 계정에 저장돼요 (베타).',cta:'로그인하고 무료 베타 시작'});return;}
   if(!res.ok||typeof result.html!=='string')throw Error();if(guideId)frame.addEventListener('load',()=>{if(epoch!==generation)return;frameCss('.report-tabs,#printCustomer,#customerView,#back{display:none!important}');try{frame.contentWindow.postMessage({type:'sdti-interior-restore',ok:true,id:result.id,date:result.date,state:result.state,readonly:true},'*');}catch(_){}let n=0;(function go(){if(epoch!==generation)return;try{const b=frame.contentDocument.getElementById('viewConsultant'),v=frame.contentDocument.getElementById('consultantView');if(b&&v&&!frame.contentDocument.getElementById('report').hidden){b.click();if(!v.classList.contains('view-hidden'))return;}}catch(_){}if(n++<60)setTimeout(go,250);})();},{once:true});else if(viewId)frame.addEventListener('load',()=>restoreSaved(epoch),{once:true});else{if(inviteCode){inviteRun=true;if(invCard)invCard.hidden=true;frame.addEventListener('load',()=>{if(epoch===generation)frameCss('.report-tabs,#print,#consultantView{display:none!important}');},{once:true});}draftUser=data.session.user.id;frame.addEventListener('load',()=>offerDraft(epoch),{once:true});}frame.srcdoc=result.html;frame.hidden=false;document.body.classList.add('frame-open');start.hidden=true;signout.hidden=false;message.textContent=guideId?'고객이 공유한 상담 가이드를 보는 중입니다.':inviteCode?'검사 진행 중 · 결과는 내 계정에 저장되고 '+(inviteBiz||'업체')+'에 공유돼요.':viewId?'저장된 결과를 보는 중입니다.':result.official?'검사 진행 중 · 결과는 내 계정에 저장돼요. (남은 이용권 '+(result.remaining??0)+'회)':'11월 무료 베타 참여 중 · 결과는 내 계정에 저장돼요.';wantsStart=false;
   const remaining=result.endsAt-result.serverNow;if(!viewId&&!guideId&&!inviteCode&&!result.official)expiryTimer=setTimeout(()=>{active=false;if(frame.hidden)clear('11월 무료 베타가 종료되었습니다.');else message.textContent='베타 기간이 끝났지만, 진행 중인 검사는 끝까지 마치고 결과를 저장할 수 있어요.';},Math.max(0,Math.min(remaining,2147483647)));
  }catch{clear('검사 화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');}finally{loading=false;start.disabled=!canStart();}
 }
 start.addEventListener('click',()=>{wantsStart=true;open();});signout.addEventListener('click',async()=>{clearDraft();clear('로그아웃 중입니다.');await client.auth.signOut();signout.hidden=true;clear('로그아웃했습니다. 다시 로그인하여 참여할 수 있습니다.');});
 (async()=>{await status();if(!active&&!official&&!viewId&&!guideId&&!inviteCode)return;try{client=await SkoposAuth.getClient();if(inviteCode)await loadInvite();client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||!session){wantsStart=false;signout.hidden=true;clear(inviteCode?'로그인하면 초대받은 검사를 시작할 수 있어요.':guideId?'업체 계정으로 로그인하면 상담 가이드를 불러옵니다.':'회원가입·로그인 후 무료로 참여할 수 있습니다.');if(inviteCode&&inviteOk&&invCard)invCard.hidden=false;}else{signout.hidden=false;if(wantsStart)setTimeout(open,0);}});await SkoposAuth.guard({passive:true,onReady(){signout.hidden=false;if(inviteCode){if(wantsStart)setTimeout(open,0);return;}start.textContent=guideId?'상담 가이드 보기':viewId?'저장된 결과 보기':official?'이용권으로 검사 시작':'무료 베타 시작하기';if(wantsStart)setTimeout(open,0);}});// 로그인 만료일 때만 화면을 닫고, 일시적인 통신 오류에는 검사를 유지
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
   if(!client)throw Error();if(guideId){reply({ok:false,message:'고객이 공유한 결과는 보기만 할 수 있어요.'});return;}if(!active&&!official&&!inviteRun){reply({ok:false,message:'사전 베타가 종료되어 새로 저장할 수 없어요. PDF로 저장해 주세요.'});return;}const {data:s}=await client.auth.getSession();if(!s||!s.session){reply({ok:false,message:'로그인이 만료되어 저장하지 못했어요. PDF로 저장해 주세요.'});return;}
   const d=e.data,row={scores:d.scores&&typeof d.scores==='object'?d.scores:{},top:Array.isArray(d.top)?d.top.slice(0,3).map(String):[],form_state:d.state&&typeof d.state==='object'?d.state:{},version:'beta',updated_at:new Date().toISOString()};
   let res;
   if(d.id&&/^[0-9a-f-]{36}$/i.test(d.id))res=await client.from('interior_results').update(row).eq('id',d.id).eq('user_id',s.session.user.id).select('id,created_at').single();
   else res=await client.from('interior_results').insert(Object.assign({user_id:s.session.user.id},row,inviteRun&&inviteCode?{invite_code:inviteCode}:{})).select('id,created_at').single();
   if(res.error){const m=String(res.error.message||'');
    if(/invite_not_active/.test(m)){reply({ok:false,message:'초대 검사 정보를 확인하지 못해 저장하지 못했어요. 지금 결과는 PDF로 저장하고, 업체가 보낸 초대 링크를 다시 열어 주세요.'});return;}
    if(/interior_no_session/.test(m)){reply({ok:false,message:'새 검사를 저장하려면 이용권 1회가 더 필요해요. 지금 결과는 PDF로 저장하고, 페이지를 새로 열어 시작해 주세요.'});return;}
    if(/interior_edit_window_closed/.test(m)){reply({ok:false,message:'저장 후 24시간이 지나 수정할 수 없어요. PDF로 저장해 주세요.'});return;}
    if(/interior_beta_readonly/.test(m)){reply({ok:false,message:'사전 베타 결과는 수정할 수 없어요. PDF로 저장해 주세요.'});return;}
    throw res.error;}
   clearDraft();savedId=res.data.id;reply({ok:true,id:res.data.id,date:res.data.created_at});if(inviteRun)message.textContent='결과가 내 계정에 저장됐어요. '+(inviteBiz||'업체')+'가 상담 가이드를 확인할 수 있어요.';
  }catch(_){reply({ok:false,message:'결과를 저장하지 못했어요. PDF로 저장해 주세요.'});}
 });
 async function restoreSaved(epoch){
  const send=m=>{try{frame.contentWindow.postMessage(Object.assign({type:'sdti-interior-restore'},m),'*');}catch(_){}};
  try{
   const {data:s}=await client.auth.getSession();if(epoch!==generation)return;
   const {data,error}=await client.from('interior_results').select('id,created_at,form_state,version').eq('id',viewId).eq('user_id',s.session.user.id).maybeSingle();
   if(error||!data){if(!active&&!official){clear('저장된 결과를 찾지 못했어요. 마이페이지에서 다시 선택해 주세요.');return;}send({ok:false,message:'저장된 결과를 찾지 못했어요. 마이페이지에서 다시 선택해 주세요.'});return;}
   try{const {data:sh}=await client.rpc('my_shares');if(epoch===generation&&sh&&sh.ok&&(sh.shares||[]).some(x=>x.result_id===data.id))frameCss('.report-tabs,#print,#consultantView{display:none!important}');}catch(_){}
   const editable=active||(official&&data.version==='official'&&Date.now()-Date.parse(data.created_at)<24*3600*1000);send({ok:true,id:data.id,date:data.created_at,state:data.form_state,readonly:!editable});
  }catch(_){if(!active&&!official){clear('저장된 결과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');return;}send({ok:false,message:'저장된 결과를 불러오지 못했어요.'});}
 }
 window.addEventListener('message',function(e){if(e.source!==frame.contentWindow)return;if(e.data&&e.data.type==='sdti-interior-exit'){clear(guideId?'상담 가이드를 닫았어요.':'검사를 나왔습니다. 다시 시작할 수 있어요.');signout.hidden=false;if(inviteCode&&inviteOk&&invCard)invCard.hidden=false;}});
})();


