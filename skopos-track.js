/* SKOPOS 공통 추적 스크립트
 * 1) 유입 출처(UTM) 저장: 첫 방문 출처 + 마지막 출처 (30일 유지)
 * 2) 메타 픽셀: PageView + 퍼널 이벤트 (Lead / InitiateCheckout / Purchase)
 * 3) GA4: 페이지에 없으면 자동 로드, 퍼널 이벤트 전송
 * 4) Supabase funnel_events 테이블에 퍼널 이벤트 기록 (비로그인 포함)
 *
 * 사용: SkoposTrack.event('free_quiz_complete', { result_type: 'A1' })
 *   이벤트: free_quiz_complete, premium_quiz_complete, checkout_view, purchase, free_redeem
 */
(function (w, d) {
  'use strict';
  var CFG = {
    pixelId: '2679260049178159',
    gaId: 'G-M6RMFNZ7W3',
    sbUrl: 'https://rgbukqphcqptnfeqipfn.supabase.co',
    sbAnon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnYnVrcXBoY3FwdG5mZXFpcGZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTkzMDMsImV4cCI6MjA5NDI3NTMwM30.fWUHe2AoWr9fMLUNSQkbhosUO7FH9dvZOIZbz_XyzFM',
    attrDays: 30
  };

  function ls(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function cut(s, n) { return s == null ? null : String(s).slice(0, n); }

  // ── 익명 방문자 ID ──
  var anon = ls('skopos_anon_id');
  if (!anon) {
    anon = 'a_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    ls('skopos_anon_id', anon);
  }

  // ── 유입 출처 ──
  function refSource(ref) {
    try {
      var h = new URL(ref).hostname;
      if (h.indexOf('skopos') !== -1) return null;
      if (/daangn|karrot/.test(h)) return 'daangn';
      if (/instagram/.test(h)) return 'instagram';
      if (/facebook|fb\./.test(h)) return 'facebook';
      if (/naver/.test(h)) return 'naver';
      if (/google/.test(h)) return 'google';
      if (/kakao/.test(h)) return 'kakao';
      if (/frip/.test(h)) return 'frip';
      return h.replace(/^www\./, '');
    } catch (e) { return null; }
  }
  (function captureAttr() {
    var p = new URLSearchParams(w.location.search);
    var now = Date.now();
    var a = null;
    if (p.get('utm_source')) {
      a = {
        source: cut(p.get('utm_source'), 100), medium: cut(p.get('utm_medium'), 100),
        campaign: cut(p.get('utm_campaign'), 150), content: cut(p.get('utm_content'), 150), ts: now
      };
    } else if (p.get('fbclid')) {
      a = { source: 'meta', medium: 'paid_social', campaign: null, content: null, ts: now };
    } else if (d.referrer) {
      var rs = refSource(d.referrer);
      if (rs) a = { source: rs, medium: 'referral', campaign: null, content: null, ts: now };
    }
    if (a) {
      ls('skopos_attr_last', a);
      if (!ls('skopos_attr_first')) ls('skopos_attr_first', a);
    }
  })();
  function attr() {
    var last = ls('skopos_attr_last');
    if (last && Date.now() - (last.ts || 0) > CFG.attrDays * 864e5) last = null;
    var first = ls('skopos_attr_first');
    return { last: last, first: first };
  }

  // ── GA4 (페이지에 없을 때만 로드) ──
  if (typeof w.gtag !== 'function') {
    w.dataLayer = w.dataLayer || [];
    w.gtag = function () { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());
    w.gtag('config', CFG.gaId);
    var gs = d.createElement('script');
    gs.async = true; gs.src = 'https://www.googletagmanager.com/gtag/js?id=' + CFG.gaId;
    d.head.appendChild(gs);
  }

  // ── 메타 픽셀 ──
  if (CFG.pixelId && !w.fbq) {
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(w, d, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    w.fbq('init', CFG.pixelId);
    w.fbq('track', 'PageView');
  }

  // ── Supabase 기록 ──
  function logDb(row) {
    try {
      fetch(CFG.sbUrl + '/rest/v1/funnel_events', {
        method: 'POST', keepalive: true,
        headers: {
          'apikey': CFG.sbAnon, 'Authorization': 'Bearer ' + CFG.sbAnon,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal'
        },
        body: JSON.stringify(row)
      }).catch(function () {});
    } catch (e) {}
  }

  var FB_MAP = {
    free_quiz_complete: ['track', 'Lead'],
    premium_quiz_complete: ['trackCustom', 'PremiumQuizComplete'],
    checkout_view: ['track', 'InitiateCheckout'],
    purchase: ['track', 'Purchase'],
    free_redeem: ['trackCustom', 'FreeRedeem']
  };

  function event(name, params) {
    params = params || {};
    var a = attr();
    var value = params.value != null ? Number(params.value) : null;
    // 같은 결제·발급이 새로고침으로 두 번 잡히지 않도록
    if ((name === 'purchase' || name === 'free_redeem') && params.order_id) {
      var key = 'skopos_ev_' + name + '_' + params.order_id;
      try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) {}
    }
    try {
      var m = FB_MAP[name];
      if (m && w.fbq) {
        var fp = {};
        if (value != null) { fp.value = value; fp.currency = 'KRW'; }
        if (params.result_type) fp.content_name = params.result_type;
        var opt = params.order_id ? { eventID: name + '_' + params.order_id } : undefined;
        w.fbq(m[0], m[1], fp, opt);
      }
    } catch (e) {}
    try {
      if (typeof w.gtag === 'function') {
        var gp = { result_type: params.result_type || '', traffic_source: (a.last && a.last.source) || '' };
        if (value != null) { gp.value = value; gp.currency = 'KRW'; }
        if (name === 'purchase') { gp.transaction_id = params.order_id || ''; w.gtag('event', 'purchase', gp); }
        else w.gtag('event', 'funnel_' + name, gp);
      }
    } catch (e) {}
    var l = a.last || {}, f = a.first || {};
    logDb({
      event: name,
      anon_id: anon,
      user_id: params.user_id || null,
      result_type: cut(params.result_type, 64),
      value: value,
      coupon_code: cut(params.coupon_code, 40) || null,
      utm_source: l.source || null,
      utm_medium: l.medium || null,
      utm_campaign: l.campaign || null,
      utm_content: l.content || null,
      first_source: f.source || null,
      referrer: cut(d.referrer, 300) || null,
      page: cut(w.location.pathname, 200)
    });
  }

  w.SkoposTrack = { event: event, attr: attr, anonId: function () { return anon; } };

  // ── 카카오톡 채널 연동: 문의 버튼 + 결과 화면 채널 추가 카드 ──
  var KAKAO = { friend:'https://pf.kakao.com/_dtGjX/friend', chat:'https://pf.kakao.com/_dtGjX/chat' };
  function kakaoClick(kind, where){
    try{ if(typeof w.gtag==='function') w.gtag('event','kakao_'+kind,{placement:where, page:w.location.pathname}); }catch(e){}
    try{ if(w.fbq) w.fbq('trackCustom','KakaoChannel',{kind:kind, placement:where}); }catch(e){}
  }
  w.SkoposKakaoClick = kakaoClick;
  function injectKakao(){
    var path = w.location.pathname.replace(/\.html$/,'').replace(/\/$/,'') || '/index';
    if(/naver/.test(path)) return;
    var st = d.createElement('style');
    st.textContent = '.skk-fab{position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:900;display:flex;align-items:center;gap:7px;background:#FEE500;color:#191919;font:800 .82rem/1 "Noto Sans KR",sans-serif;padding:12px 16px 12px 13px;border-radius:50px;box-shadow:0 6px 20px rgba(0,0,0,.18);text-decoration:none}'
      + '.skk-fab svg{width:20px;height:20px;flex:none}.skk-fab:hover{transform:translateY(-2px)}'
      + '@media print{.skk-fab,.skk-card{display:none!important}}'
      + '.skk-card{width:100%;max-width:780px;margin:24px auto 0;border-radius:20px;background:#FFFBE0;border:1.5px solid #F5E27A;padding:20px 20px 18px;display:flex;gap:14px;align-items:flex-start;font-family:"Noto Sans KR",sans-serif;text-align:left;box-sizing:border-box}'
      + '.skk-card .ic{width:44px;height:44px;border-radius:12px;background:#FEE500;display:grid;place-items:center;flex:none}.skk-card .ic svg{width:26px;height:26px}'
      + '.skk-card b{display:block;font-size:1rem;font-weight:900;color:#191919;margin-bottom:4px}.skk-card p{margin:0;font-size:.84rem;color:#5A5440;line-height:1.6}'
      + '.skk-card .bt{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.skk-card .bt a{font-size:.82rem;font-weight:800;border-radius:50px;padding:10px 16px;text-decoration:none}'
      + '.skk-card .bt .y{background:#FEE500;color:#191919}.skk-card .bt .w{background:#fff;color:#191919;border:1px solid #E8DC9A}';
    d.head.appendChild(st);
    var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#191919" d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.86 5.32 4.66 6.74l-.95 3.49c-.08.3.26.54.52.37l4.15-2.75c.53.06 1.07.09 1.62.09 5.52 0 10-3.58 10-8S17.52 3 12 3z"/></svg>';
    // 1) 떠 있는 카톡 문의 버튼: 소개·마이페이지·결제·커플 화면에만 (검사 진행 화면은 제외)
    if(/^\/(index|mypage|payment|couple|skopos_sample_result)$/.test(path)){
      var a = d.createElement('a');
      a.className='skk-fab'; a.href=KAKAO.chat; a.target='_blank'; a.rel='noopener';
      a.setAttribute('aria-label','카카오톡으로 문의하기');
      a.innerHTML = ICON + '<span>카톡 문의</span>';
      a.addEventListener('click', function(){ kakaoClick('chat','fab'); });
      d.body.appendChild(a);
    }
    // 2) 검사 결과 화면 하단: 채널 추가 카드
    var sr = d.getElementById('sr'), rw = d.getElementById('rw');
    if(sr && rw){
      var place = function(){
        if(!sr.classList.contains('active') || !rw.children.length) return;
        var ex = rw.querySelector('.skk-card');
        if(ex){ if(rw.lastElementChild!==ex) rw.appendChild(ex); return; }
        var c = d.createElement('div');
        c.className='skk-card';
        c.innerHTML = '<div class="ic">'+ICON+'</div><div><b>카카오톡 채널 추가하고 결과 다시 보기</b>'
          + '<p>채널을 추가하면 결과를 다시 확인하는 방법, 공간 가이드와 혜택 소식을 카카오톡으로 받아보실 수 있어요. 궁금한 점도 채팅으로 편하게 물어보세요.</p>'
          + '<div class="bt"><a class="y" href="'+KAKAO.friend+'" target="_blank" rel="noopener" data-k="friend">채널 추가하기</a><a class="w" href="'+KAKAO.chat+'" target="_blank" rel="noopener" data-k="chat">카톡으로 문의하기</a></div></div>';
        c.addEventListener('click', function(e){ var t=e.target.closest('a[data-k]'); if(t) kakaoClick(t.getAttribute('data-k'),'result'); });
        rw.appendChild(c);
      };
      try{
        new MutationObserver(place).observe(sr,{attributes:true,attributeFilter:['class']});
        new MutationObserver(function(){ setTimeout(place,300); }).observe(rw,{childList:true});
      }catch(e){}
      place();
    }
  }
  if(d.readyState==='loading') d.addEventListener('DOMContentLoaded', injectKakao); else injectKakao();

})(window, document);
