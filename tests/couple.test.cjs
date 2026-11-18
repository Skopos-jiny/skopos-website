// 커플 진단 함수: 파트너 이용권 발급 실패를 성공으로 숨기지 않고, 다시 요청하거나 상태를 볼 때 복구되는지 (2026-11-19)
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname,'..','supabase/functions/couple/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,'');

function setup(opts={}){
  const db = {
    users:{A:{id:'owner',email:'a@x'},B:{id:'partner',email:'b@x'}},
    couples:[{id:1,code:'ABC123',owner_id:'owner',partner_id:null,imp_uid:'imp_1'}],
    payments:[{user_id:'owner',imp_uid:'imp_1',status:opts.ownerStatus||'paid',product:'couple'}],
    premium_results:[],
  };
  let failInsert = opts.failInsert||0;
  const sb = {
    auth:{getUser:async t=>({data:{user:db.users[t]},error:db.users[t]?null:{}}),
      admin:{getUserById:async id=>({data:{user:Object.values(db.users).find(u=>u.id===id)}})}},
    from(table){
      const q={f:[],op:'select'};
      const match=r=>q.f.every(([k,op,v])=>op==='eq'?r[k]===v:op==='in'?v.includes(r[k]):op==='neq'?(r[k]!=null&&r[k]!==v):op==='is'?r[k]===v:true);
      const run=async()=>{
        if(q.op==='insert'){ if(failInsert>0){failInsert--;return{error:{message:'mock'}};} db[table].push(...q.row); return{error:null}; }
        if(q.op==='update'){ const m=db[table].filter(match); m.forEach(r=>Object.assign(r,q.upd)); return{data:m.map(r=>({id:r.id})),error:null}; }
        if(table==='couples'&&q.or){ const m=db.couples.filter(c=>c.owner_id===q.or||c.partner_id===q.or); return{data:m,error:null}; }
        let m=db[table].filter(match); if(q.lim) m=m.slice(0,q.lim);
        return{data:q.single?(m[0]||null):m,error:null};
      };
      const b={select(){return b},eq(k,v){q.f.push([k,'eq',v]);return b},in(k,v){q.f.push([k,'in',v]);return b},
        neq(k,v){q.f.push([k,'neq',v]);return b},is(k,v){q.f.push([k,'is',v]);return b},
        or(s){q.or=(s.match(/owner_id\.eq\.([^,]+)/)||[])[1];return b},order(){return b},limit(n){q.lim=n;return b},
        maybeSingle(){q.single=true;return run()},insert(r){q.op='insert';q.row=r;return run()},
        update(u){q.op='update';q.upd=u;return b},then(res,rej){return run().then(res,rej)}};
      return b;
    }
  };
  const ctx = vm.createContext({createClient:()=>sb,process:{env:{}},console:{error(){}},serveNetlifyHandler:h=>{ctx.handler=h;}});
  vm.runInContext(src,ctx);
  const call = async(tok,body)=>{const r=await ctx.handler({httpMethod:'POST',headers:{authorization:'Bearer '+tok},body:JSON.stringify(body)});return {status:r.statusCode,body:JSON.parse(r.body)};};
  const ent = ()=>db.payments.filter(p=>p.user_id==='partner').length;
  return {db,call,ent};
}

test('join reports failure when the partner entitlement cannot be issued', async()=>{
  const t=setup({failInsert:2});
  const r=await t.call('B',{action:'join',code:'ABC123'});
  assert.equal(r.status,503); assert.equal(r.body.success,false); assert.equal(r.body.retry,true);
  assert.equal(t.db.couples[0].partner_id,'partner'); assert.equal(t.ent(),0);
});
test('retrying the same code or opening status restores exactly one entitlement', async()=>{
  const t=setup({failInsert:2});
  await t.call('B',{action:'join',code:'ABC123'});
  const s=await t.call('B',{action:'status'});
  assert.equal(s.status,200); assert.equal(s.body.couple.entitlement_pending,false); assert.equal(t.ent(),1);
  const j=await t.call('B',{action:'join',code:'ABC123'});
  assert.equal(j.status,200); assert.equal(j.body.success,true); assert.equal(t.ent(),1);
  assert.equal(t.db.payments.find(p=>p.user_id==='partner').product,'premium');
});
test('normal join succeeds and issues one entitlement', async()=>{
  const t=setup();
  const r=await t.call('B',{action:'join',code:'ABC123'});
  assert.equal(r.status,200); assert.equal(t.ent(),1);
});
test('refunded couple order neither pairs new partners nor re-issues entitlement', async()=>{
  const t=setup({ownerStatus:'cancelled'});
  const r=await t.call('B',{action:'join',code:'ABC123'});
  assert.equal(r.status,410); assert.equal(t.ent(),0);
  t.db.couples[0].partner_id='partner';
  await t.call('B',{action:'status'}); assert.equal(t.ent(),0);
});
