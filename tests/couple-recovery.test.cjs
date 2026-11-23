// 커플 결제 복구 (2026-11-23): 초대 코드 발급 실패를 성공으로 숨기지 않고 재시도 응답,
// 웹훅은 기록 누락·코드 누락을 복구 대기열에 올린다
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const load = f => fs.readFileSync(path.join(__dirname,'..',f),'utf8').replace(/^import .*;\r?\n/gm,'');

function mockSb(db, opts={}){
  let failCouple = opts.failCouple||0;
  return {
    auth:{getUser:async t=>({data:{user:t==='T'?{id:'owner'}:null},error:t==='T'?null:{}})},
    from(table){
      const q={f:[],op:'select'};
      const match=r=>q.f.every(([k,v])=>r[k]===v);
      const run=async()=>{
        if(q.op==='insert'||q.op==='upsert'){
          if(table==='couples'&&failCouple>0){failCouple--;return{error:{message:'mock'}};}
          const rows=Array.isArray(q.row)?q.row:[q.row];
          if(q.op==='upsert'&&rows.every(r=>(db[table]||[]).some(x=>x.imp_uid===r.imp_uid))) return {error:null};
          (db[table]=db[table]||[]).push(...rows.map((r,i)=>({id:'id'+(db[table].length+i),...r})));
          return {data:q.sel?{id:'id'+(db[table].length-1)}:null,error:null};
        }
        const m=(db[table]||[]).filter(match);
        return {data:q.single?(m[0]||null):m,error:null};
      };
      const b={select(){q.sel=true;return b},eq(k,v){q.f.push([k,v]);return b},
        maybeSingle(){q.single=true;return run()},single(){q.single=true;return run()},
        insert(r){q.op='insert';q.row=r;return b},upsert(r){q.op='upsert';q.row=r;return run()},
        then(res,rej){return run().then(res,rej)}};
      return b;
    }
  };
}

function verifySetup(db,opts){
  const sb=mockSb(db,opts);
  const fetch=async(url)=>({json:async()=>url.includes('getToken')
    ?{code:0,response:{access_token:'x'}}
    :{code:0,response:{imp_uid:'imp_123456',merchant_uid:'m1',status:'paid',amount:49900,paid_at:1795000000}}});
  const ctx=vm.createContext({createClient:()=>sb,fetch,process:{env:{}},console:{error(){},warn(){}},serveNetlifyHandler:h=>{ctx.handler=h;},Date,JSON,Math,Number,String,setTimeout});
  vm.runInContext(load('supabase/functions/verify-payment/index.ts'),ctx);
  return async body=>{const r=await ctx.handler({httpMethod:'POST',headers:{authorization:'Bearer T'},body:JSON.stringify(body)});return {status:r.statusCode,body:JSON.parse(r.body)};};
}

const body={imp_uid:'imp_123456',merchant_uid:'m1',amount:49900,plan:'couple'};

test('커플 코드 발급이 모두 실패하면 503 재시도 응답, 결제 기록은 남음',async()=>{
  const db={payments:[],couples:[]};
  const call=verifySetup(db,{failCouple:5});
  const r=await call(body);
  assert.equal(r.status,503);
  assert.equal(r.body.success,false);
  assert.equal(r.body.retryable,true);
  assert.equal(db.payments.length,1);
});

test('재시도하면 추가 결제 없이 같은 결제로 코드 발급',async()=>{
  const db={payments:[],couples:[]};
  const call=verifySetup(db,{failCouple:5});
  await call(body);
  const r=await call(body);
  assert.equal(r.status,200);
  assert.equal(r.body.already,true);
  assert.match(r.body.couple_code,/^[A-Z0-9]{6}$/);
  assert.equal(db.payments.length,1);
});

test('정상 커플 결제는 바로 코드와 함께 성공',async()=>{
  const db={payments:[],couples:[]};
  const r=await verifySetup(db)(body);
  assert.equal(r.status,200);
  assert.match(r.body.couple_code,/^[A-Z0-9]{6}$/);
});

function hookSetup(db,payment){
  const sb=mockSb(db);
  const fetch=async(url)=>({json:async()=>url.includes('getToken')?{code:0,response:{access_token:'x'}}:{code:0,response:payment}});
  const ctx=vm.createContext({createClient:()=>sb,fetch,process:{env:{WEBHOOK_RECHECK_MS:'0'}},console:{error(){},warn(){}},serveNetlifyHandler:h=>{ctx.handler=h;},Date,JSON,Number,String,setTimeout,Promise});
  vm.runInContext(load('supabase/functions/portone-webhook/index.ts'),ctx);
  return async()=>{const r=await ctx.handler({httpMethod:'POST',headers:{},body:JSON.stringify({imp_uid:payment.imp_uid})});return JSON.parse(r.body);};
}

test('웹훅: 결제 기록이 없으면 복구 대기열에 1번만 적재',async()=>{
  const db={payments:[],couples:[],payment_recovery_queue:[]};
  const hook=hookSetup(db,{imp_uid:'imp_9',merchant_uid:'m9',status:'paid',amount:29900,name:'SKOPOS SDTI 정밀 검사',paid_at:1795000000});
  assert.equal((await hook()).recovery,'no_payment_record');
  await hook();
  assert.equal(db.payment_recovery_queue.length,1);
});

test('웹훅: 커플 결제인데 코드가 없으면 대기열, 있으면 적재 안 함',async()=>{
  const db={payments:[{imp_uid:'imp_8',order_name:'SKOPOS SDTI 커플 진단 (2인)',user_id:'owner'}],couples:[],payment_recovery_queue:[]};
  const hook=hookSetup(db,{imp_uid:'imp_8',merchant_uid:'m8',status:'paid',amount:49900,name:'SKOPOS SDTI 커플 진단 (2인)',paid_at:1795000000});
  assert.equal((await hook()).recovery,'couple_code_missing');
  db.couples.push({imp_uid:'imp_8',code:'ABC123'});db.payment_recovery_queue=[];
  assert.equal((await hook()).recovery,null);
  assert.equal(db.payment_recovery_queue.length,0);
});
