// 정밀검사: 답을 빠르게 두 번 눌러도 다음 문항으로 한 번만 넘어가고 중간 문항이 비지 않는지 (2026-11-19)
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const page = fs.readFileSync(path.join(__dirname,'..','skopos_premium_quiz.html'),'utf8').replace(/\r\n/g,'\n');
const between=(a,b)=>{const i=page.indexOf(a),j=page.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,a);return page.slice(i,j);};
const constant=n=>{const a=page.indexOf('const '+n+'=[');return page.slice(a,page.indexOf('\n];',a)+3);};

function load(){
  const el={classList:{add(){},remove(){}}};
  const ctx=vm.createContext({setTimeout,clearTimeout,setInterval,clearInterval,
    document:{querySelectorAll:()=>[el,el,el,el,el,el,el,el],querySelector:()=>el}});
  vm.runInContext(constant('SECS')+constant('QS')+
    'let cur=0,ans={},qTimer=null,timerEl=null,elapsed=0;let _advanceT=null;let renders=0;'+
    'function saveProgress(){} function runResult(){}'+
    'function renderQ(){clearInterval(qTimer);clearTimeout(_advanceT);_advanceT=null;renders++;}'+
    between('function recordAns(','// ── COMPUTE')+
    'globalThis.api={selectOpt,get cur(){return cur},get ans(){return ans},set cur(v){cur=v}};',ctx);
  return ctx.api;
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));

for(const start of [0,5]){
  test('double click 40ms apart on Q'+(start+1)+' advances exactly one question', async()=>{
    const a=load(); a.cur=start;
    a.selectOpt(0); await wait(40); a.selectOpt(1);
    await wait(500);
    assert.equal(a.cur,start+1);
    assert.equal(a.ans[start].idx,1); // 마지막으로 누른 답이 기록됨
    assert.equal(a.ans[start+1],undefined);
  });
}
test('single click still advances once', async()=>{
  const a=load(); a.selectOpt(2); await wait(500); assert.equal(a.cur,1);
});
