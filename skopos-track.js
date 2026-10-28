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
})(window, document);
