const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const page = read('skopos_premium_quiz.html');
function between(start, end) {
  const a = page.indexOf(start), b = page.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return page.slice(a, b);
}
function constant(name) {
  const a = page.indexOf('const ' + name + '=[');
  return page.slice(a, page.indexOf('\n];', a) + 3);
}
function scoring() {
  const context = vm.createContext({});
  vm.runInContext(constant('SECS') + constant('QS') + constant('TYPES') +
    'let ans={};' + between('function getSectionScore(', 'function show(') +
    between('function recordAns(', 'function selectOpt(') +
    between('let _TAG_STATS=null;', '// ── LOADING') +
    between('function buildRadarSVG(', 'function renderResult(') +
    'globalThis.api={SECS,QS,TYPES,getSectionScore,compute,recordAns,buildRadarSVG};', context);
  return context.api;
}
test('personal values override type examples, preserve zero, support stored keys', () => {
  const a = scoring(), s = a.SECS[0], type = a.TYPES[0];
  assert.equal(a.getSectionScore(type, {[s.label]: 0}, s), 0);
  assert.equal(a.getSectionScore(type, {[s.key]: 17}, s), 17);
  assert.equal(a.getSectionScore(type, {[s.legacyLabel]: 31}, s), 31);
  assert.ok(Number.isNaN(a.getSectionScore(type, {}, s, NaN)));
});
test('144 real question responses produce the same eight values for web and stored results', () => {
  const a = scoring();
  assert.equal(a.QS.length, 144);
  for(let variant = 0; variant < 12; variant++) {
    a.QS.forEach((q,i) => a.recordAns(i, (i + variant) % (q.type === 'scale' ? 5 : q.o.length)));
    const result = a.compute(), stored = {};
    a.SECS.forEach(s => { stored[s.key] = result.scores[s.label]; });
    for(const s of a.SECS) {
      const value = a.getSectionScore(result.type, result.scores, s);
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 100);
      assert.equal(value, a.getSectionScore(result.type, stored, s));
    }
    assert.equal(a.buildRadarSVG(result.type, result.scores), a.buildRadarSVG(result.type, stored));
  }
});
test('PDF and social cards consume the displayed result; restoration fetches the authenticated account', () => {
  const pdf = between('async function downloadPDF(){', 'function retryQuiz(){');
  assert.match(pdf, /const scores = resultScores/);
  assert.doesNotMatch(pdf, /getSectionScore\(t, \{\}/);
  const card = between('async function _generateInstaCard(', 'async function _renderInstaCardCanvas(');
  assert.match(card, /const scores = resultScores/);
  const restore = between('const renderSharedResult = async', 'if(window.SkoposAuth){');
  assert.match(restore, /eq\('user_id', user.id\)/);
  assert.match(restore, /eq\('id', resultId\)/);
  assert.match(restore, /SECS.every/);
  assert.doesNotMatch(restore, /getSectionScore\(type, \{\}/);
});
test('all site scripts and both deployed handlers parse', () => {
  for(const file of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
    const html = read(file);
    for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if(/src=|application\/ld\+json|type=["']module/.test(m[1]) || !m[2].trim()) continue;
      new vm.Script(m[2], {filename:file});
    }
  }
  for(const name of ['verify-payment','redeem-free-coupon']) loadHandler(name);
});
function loadHandler(name, options = {}) {
  const calls = [], tables = [], coupon = {code:'TEST-ONLY', is_active:true, discount_type:'percent', discount_value:options.couponPercent ?? 100, per_user_limit:1, used_count:0};
  let paymentReads = 0;
  const user = {id:'test-user'};
  const sb = {
    auth:{getUser:async()=>({data:{user},error:null})},
    from(table) {
      tables.push(table);
      let inserted = false;
      const query = {
        select(){return query;}, eq(){return query;}, in(){return query;},
        insert(){inserted=true; return query;},
        limit:async()=>({data:[],error:options.lookupError || null}),
        maybeSingle:async()=>({data:table==='coupons'?coupon:(++paymentReads > 1 ? options.recorded || null : null),error:null}),
        single:async()=>({data:options.insertError?null:{id:'test-payment'},error:options.insertError || null}),
        then(resolve,reject){return Promise.resolve({count:0,error:null}).then(resolve,reject);}
      };
      return query;
    }
  };
  const context = vm.createContext({
    createClient:()=>sb, process:{env:{}}, console:{error(){},warn(){}},
    fetch:async(url)=>{
      calls.push(url);
      return {json:async()=> url.endsWith('/getToken') ? {code:0,response:{access_token:'test-token'}} :
        url.endsWith('/cancel') ? {code:options.cancelRejected?1:0} :
        {code:0,response:{status:'paid',amount:options.paymentAmount ?? 29900,paid_at:1000}}};
    }, serveNetlifyHandler:handler=>{context.handler=handler;}
  });
  const source = read('supabase/functions/'+name+'/index.ts').replace(/^import .*;\n/gm,'');
  vm.runInContext(source,context);
  return {handler:context.handler,calls,tables};
}
test('free coupon refuses missing authentication',async()=>{
  const a = loadHandler('redeem-free-coupon');
  const r = await a.handler({httpMethod:'POST',headers:{},body:JSON.stringify({coupon_code:'TEST-ONLY'})});
  assert.equal(r.statusCode,401);
});
test('free coupon returns failure if entitlement lookup or payment persistence fails',async()=>{
  for(const options of [{lookupError:{code:'db-error'}},{insertError:{code:'db-error'}}]){
    const a = loadHandler('redeem-free-coupon',options);
    const r = await a.handler({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({coupon_code:'TEST-ONLY'})});
    assert.equal(r.statusCode,500);
    assert.equal(JSON.parse(r.body).success,false);
  }
});
test('free coupon relies on atomic database logging rather than independent writes',async()=>{
  const a = loadHandler('redeem-free-coupon');
  const r = await a.handler({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({coupon_code:'TEST-ONLY'})});
  assert.equal(r.statusCode,200);
  assert.equal(JSON.parse(r.body).payment_id,'test-payment');
  for(const name of ['redeem-free-coupon','verify-payment']){
    const source = read('supabase/functions/'+name+'/index.ts');
    assert.doesNotMatch(source,/from\('coupon_redemptions'\)\.insert/);
    assert.doesNotMatch(source,/update\(\{ used_count/);
  }
});
test('paid verification never reports success when its payment insert fails',async()=>{
  const a = loadHandler('verify-payment',{insertError:{code:'db-error'}});
  const r = await a.handler({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({imp_uid:'test-imp',merchant_uid:'test-order',amount:29900})});
  assert.equal(r.statusCode,500);
  assert.equal(JSON.parse(r.body).success,false);
  assert.equal(a.calls.filter(u=>u.includes('/cancel')).length,0);
});
test('site shows the current report page count and no incorrect reference discount',()=>{
  assert.match(read('index.html'),/>22<\/div><div class="hstat-l">페이지 PDF/);
  assert.doesNotMatch(read('skopos_sample_result.html'),/75% OFF|<span class="price-old">39,000원/);
});
test('concurrent paid replay returns the existing payment and rejects a different owner',async()=>{
  for(const userId of ['test-user','someone-else']){
    const a = loadHandler('verify-payment',{insertError:{code:'23505'},recorded:{id:'existing-id',user_id:userId,status:'paid'}});
    const r = await a.handler({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({imp_uid:'test-imp',merchant_uid:'test-order',amount:29900})});
    assert.equal(r.statusCode,userId==='test-user'?200:409);
    if(userId==='test-user') assert.equal(JSON.parse(r.body).payment_id,'existing-id');
    assert.equal(a.calls.filter(u=>u.includes('/cancel')).length,0);
  }
});
test('coupon limit race cancels the paid charge and reports cancellation failure accurately',async()=>{
  for(const cancelRejected of [false,true]){
    const a = loadHandler('verify-payment',{insertError:{code:'P0001'},couponPercent:50,paymentAmount:14950,cancelRejected});
    const r = await a.handler({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({imp_uid:'test-imp',merchant_uid:'test-order',amount:14950,coupon_code:'TEST-ONLY'})});
    assert.equal(r.statusCode,cancelRejected?500:400);
    assert.equal(JSON.parse(r.body).success,false);
    assert.equal(a.calls.filter(u=>u.includes('/cancel')).length,1);
    if(cancelRejected) assert.doesNotMatch(JSON.parse(r.body).message,/자동 취소했습니다/);
  }
});
