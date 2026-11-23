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
  const ctx=vm.createContext({window,document,localStorage:ls,sessionStorage:ss,URLSearchParams,URL,Date,Math,JSON,String,Number,
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

test('로그인 시 첫 유입 출처를 계정에 1회 저장하고, 신규 가입이면 signup 기록',async()=>{
  const a=run('?utm_source=instagram&utm_campaign=suneung');
  const ups=[];
  const sb={from:t=>({upsert:(row,opt)=>{ups.push([t,row,opt]);return Promise.resolve({error:null});}})};
  a.T.linkUser(sb,{id:'u1',created_at:new Date().toISOString()});
  await new Promise(r=>setTimeout(r,5));
  a.T.linkUser(sb,{id:'u1',created_at:new Date().toISOString()});
  await new Promise(r=>setTimeout(r,5));
  assert.equal(ups.length,1);
  assert.equal(ups[0][0],'user_attribution');
  assert.equal(ups[0][1].first_source,'instagram');
  assert.equal(ups[0][2].ignoreDuplicates,true);
  assert.equal(a.posts.filter(p=>p.event==='signup').length,1);
});
