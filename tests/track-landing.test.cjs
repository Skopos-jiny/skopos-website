// 광고 랜딩 계측 (2026-11-23): utm 유입 시 landing_view 1회, 로그인 시 user_attribution 1회 + 신규 가입 signup
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname,'..','skopos-track.js'),'utf8');

function store(){const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},m};}
function run(search, shared){
  const posts=[];
  const ls=shared?.ls||store(), ss=shared?.ss||store();
  const el=()=>({style:{},classList:{contains:()=>false},appendChild(){},addEventListener(){},setAttribute(){},children:[]});
  const document={referrer:'',readyState:'complete',head:{appendChild(){}},body:{appendChild(){}},createElement:el,getElementById:()=>null,getElementsByTagName:()=>[{parentNode:{insertBefore(){}}}]};
  const window={location:{pathname:'/skopos_quiz',search,hash:''},gtag(){},fbq(){}};
  const ctx=vm.createContext({window,document,localStorage:ls,sessionStorage:ss,URLSearchParams,URL,Date,Math,JSON,String,Number,setTimeout,
    fetch:(u,o)=>{posts.push(JSON.parse(o.body));return Promise.resolve({});},MutationObserver:function(){this.observe=()=>{}}});
  vm.runInContext(src.replace('})(window, document);','})(window, document);'),ctx);
  return {posts,ls,ss,T:window.SkoposTrack};
}

test('utm 랜딩은 landing_view 를 utm 과 함께 1회 기록',()=>{
  const a=run('?utm_source=kakao&utm_campaign=free_quiz_test_2611');
  const lv=a.posts.filter(p=>p.event==='landing_view');
  assert.equal(lv.length,1);
  assert.equal(lv[0].utm_source,'kakao');
  assert.equal(lv[0].utm_campaign,'free_quiz_test_2611');
  const b=run('?utm_source=kakao&utm_campaign=free_quiz_test_2611',{ls:a.ls,ss:a.ss});
  assert.equal(b.posts.filter(p=>p.event==='landing_view').length,0);
});

test('직접 방문(출처 없음)은 landing_view 를 남기지 않음',()=>{
  assert.equal(run('').posts.length,0);
});

function fakeSb(insertResult){
  const ins=[], handlers=[];
  const sb={from:t=>({insert:row=>{ins.push([t,row]);return Promise.resolve(typeof insertResult==='function'?insertResult(ins.length):insertResult);}}),
    auth:{onAuthStateChange:h=>{handlers.push(h);return {data:{subscription:{unsubscribe(){}}}};},
          getSession:()=>Promise.resolve({data:{session:sb.__session||null}})}};
  return {sb,ins,handlers};
}
const tick=()=>new Promise(r=>setTimeout(r,10));

test('로그인 시 첫 유입 출처를 계정에 1회 저장하고, 신규 가입이면 signup 기록',async()=>{
  const a=run('?utm_source=instagram&utm_campaign=suneung');
  const f=fakeSb({error:null});
  a.T.linkUser(f.sb,{id:'u1',created_at:new Date().toISOString()});
  a.T.linkUser(f.sb,{id:'u1',created_at:new Date().toISOString()}); // 동시 호출도 1회
  await tick();
  a.T.linkUser(f.sb,{id:'u1',created_at:new Date().toISOString()});
  await tick();
  assert.equal(f.ins.length,1);
  assert.equal(f.ins[0][0],'user_attribution');
  assert.equal(f.ins[0][1].first_source,'instagram');
  assert.equal(a.posts.filter(p=>p.event==='signup').length,1);
});

test('이미 연결된 계정(중복 키)은 signup 을 다시 남기지 않음, 오래된 계정은 signup 아님',async()=>{
  const a=run('');
  const dup=fakeSb({error:{code:'23505'}});
  a.T.linkUser(dup.sb,{id:'u2',created_at:new Date().toISOString()});
  await tick();
  assert.equal(a.posts.filter(p=>p.event==='signup').length,0);
  assert.equal(a.ls.getItem('skopos_attr_linked_u2')!==null,true);
  const old=fakeSb({error:null});
  a.T.linkUser(old.sb,{id:'u3',created_at:'2026-01-01T00:00:00Z'});
  await tick();
  assert.equal(old.ins.length,1);
  assert.equal(a.posts.filter(p=>p.event==='signup').length,0);
});

test('일시 오류면 표시를 남기지 않고 다음에 다시 시도',async()=>{
  const a=run('');
  const f=fakeSb(n=>n===1?{error:{code:'PGRST301'}}:{error:null});
  a.T.linkUser(f.sb,{id:'u4',created_at:new Date().toISOString()});
  await tick();
  a.T.linkUser(f.sb,{id:'u4',created_at:new Date().toISOString()});
  await tick();
  assert.equal(f.ins.length,2);
  assert.equal(a.posts.filter(p=>p.event==='signup').length,1);
});

test('로그인 후 마이페이지 직행 경로: 페이지 자체 클라이언트를 watch 하면 기존 세션도 연결',async()=>{
  const a=run('?utm_source=kakao&utm_campaign=free_quiz_test_2611');
  const f=fakeSb({error:null});
  f.sb.__session={user:{id:'u5',created_at:new Date().toISOString()}};
  a.T.watch(f.sb); a.T.watch(f.sb); // 두 번 호출해도 구독 1회
  assert.equal(f.handlers.length,1);
  f.handlers[0]('INITIAL_SESSION',f.sb.__session);
  await tick();
  assert.equal(f.ins.length,1);
  assert.equal(f.ins[0][1].first_source,'kakao');
  assert.equal(a.posts.filter(p=>p.event==='signup').length,1);
});

test('skopos-track.js 보다 먼저 만든 클라이언트는 대기열로 넘겨 받아 연결',async()=>{
  const f=fakeSb({error:null});
  f.sb.__session={user:{id:'u6',created_at:new Date().toISOString()}};
  const ls=store(), ss=store();
  // run() 은 새 window 를 만들므로, 대기열 처리 자체를 소스에서 확인
  assert.match(src,/w\.__skoposWatch\.forEach\(watch\)/);
  for(const p of ['login.html','mypage.html','payment.html','index.html']){
    const html=fs.readFileSync(path.join(__dirname,'..',p),'utf8');
    assert.match(html,/SkoposTrack\.watch\(sb\)/,p);
    assert.match(html,/__skoposWatch/,p);
  }
  const auth=fs.readFileSync(path.join(__dirname,'..','skopos-auth.js'),'utf8');
  assert.match(auth,/SkoposTrack\.watch\(_client\)/);
});
