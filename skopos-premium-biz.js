// SDTI 정밀검사: 업체 초대 검사(?i=코드)와 업체의 고객 리포트 열람(?bg=고객 항목 id)
// skopos_premium_quiz.html 의 _initPremiumGate 가 시작할 때 SkoposBiz.active 이면 이 파일이 화면을 맡는다.
(function(){
  'use strict';
  var P = new URLSearchParams(location.search);
  var code = (P.get('i') || '').toLowerCase(), bg = P.get('bg') || '';
  var isCode = /^[0-9a-f]{16}$/.test(code);
  var isBg = !isCode && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bg);
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // 초대로 검사한 고객은 결제 이력이 없어도 자기 결과를 다시 열 수 있다 (결과 열람 주소 ?r= 일 때만)
  try {
    if (P.get('r') && typeof checkEntitlement === 'function') {
      var origEntitlement = checkEntitlement;
      checkEntitlement = async function(user){
        if (await origEntitlement(user)) return true;
        try { var sb = await SkoposAuth.getClient(); var r = await sb.rpc('premium_invite_entitled'); return !!(r.data && r.data.entitled); } catch (e) { return false; }
      };
    }
  } catch (e) {}

  var box = null;
  function panel(html){
    if (!box) {
      box = document.createElement('div');
      box.id = 'bizPanel';
      box.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#F7F8FC;overflow:auto;padding:24px 16px;font-family:inherit;color:#0F0F1A';
      document.body.appendChild(box);
    }
    box.style.display = 'block';
    box.innerHTML = '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:24px 22px;box-shadow:0 6px 22px rgba(15,15,26,.08);line-height:1.7;word-break:keep-all">'
      + '<div style="font-size:1.05rem;font-weight:900;letter-spacing:.02em;margin-bottom:14px">SKO<span style="color:#E91E8C">POS</span></div>' + html + '</div>';
  }
  function hidePanel(){ if (box) box.style.display = 'none'; }
  function note(text, err){ var m = document.getElementById('bizMsg'); if (m) { m.textContent = text || ''; m.style.color = err ? '#C0264B' : '#5A5A6E'; } }
  function watchAuth(){
    if (!window.SkoposAuth) return;
    SkoposAuth.guard({ passive: true, onReady: function(user){ try { _authed = true; applyLoggedInUser(user); } catch (e) {} } });
  }

  // ── 초대 검사 ──
  var bizName = '업체';
  function consentHtml(){
    var b = esc(bizName);
    return '<h1 style="font-size:1.1rem;font-weight:800;margin:0 0 8px;line-height:1.5">' + b + '에서 요청한 SDTI 정밀검사예요</h1>'
      + '<p style="font-size:.9rem;color:#5A5A6E;margin:6px 0">8개 영역 144문항이에요. 고객님이 따로 결제하실 것은 없어요.</p>'
      + '<p style="font-size:.9rem;color:#5A5A6E;margin:6px 0">검사를 마치면 결과는 로그인한 내 계정에 저장되고, ' + b + '가 리포트를 구매하면 상담 준비를 위해 아래 내용이 공유돼요.</p>'
      + '<dl style="margin:12px 0 0;font-size:.85rem;color:#5A5A6E">'
      + '<dt style="font-weight:800;color:#0F0F1A;margin-top:10px">받는 곳</dt><dd style="margin:2px 0 0">' + b + '</dd>'
      + '<dt style="font-weight:800;color:#0F0F1A;margin-top:10px">쓰는 목적</dt><dd style="margin:2px 0 0">상담 준비와 상담 진행</dd>'
      + '<dt style="font-weight:800;color:#0F0F1A;margin-top:10px">공유하는 내용</dt><dd style="margin:2px 0 0">이름(별칭), 공간 욕구 유형, 8개 영역 점수와 그에 따른 리포트</dd>'
      + '<dt style="font-weight:800;color:#0F0F1A;margin-top:10px">공유하지 않는 내용</dt><dd style="margin:2px 0 0">연락처, 로그인 정보, 다른 검사 결과</dd>'
      + '<dt style="font-weight:800;color:#0F0F1A;margin-top:10px">공유 기간</dt><dd style="margin:2px 0 0">공유를 중지하거나 탈퇴할 때까지. 마이페이지에서 공유 중지를 요청할 수 있고, ' + b + '가 리포트를 구매한 뒤에는 요청 7일 뒤에 중지돼요.</dd></dl>'
      + '<p style="font-size:.85rem;color:#5A5A6E;margin:12px 0 0">동의하지 않으면 이 초대 검사는 진행할 수 없어요.</p>'
      + '<label style="display:flex;gap:10px;align-items:flex-start;margin-top:14px;padding:14px;border-radius:14px;background:#FDF0F6;color:#941050;font-size:.88rem;font-weight:700;cursor:pointer"><input type="checkbox" id="bizAgree" style="width:20px;height:20px;margin-top:2px;accent-color:#E91E8C;flex:none"><span>위 내용을 확인했고, 검사 결과를 ' + b + '에 공유하는 데 동의합니다.</span></label>'
      + '<button type="button" id="bizStart" disabled style="display:block;width:100%;margin-top:14px;padding:14px;border:0;border-radius:50px;background:#E91E8C;color:#fff;font:inherit;font-weight:800;font-size:.95rem;cursor:pointer;opacity:.45">동의하고 검사 시작</button>'
      + '<p id="bizMsg" style="font-size:.84rem;margin:10px 0 0;min-height:1em"></p>';
  }
  function fail(text){
    panel('<h1 style="font-size:1.05rem;font-weight:800;margin:0 0 8px">SDTI 정밀검사</h1><p style="font-size:.9rem;color:#5A5A6E;margin:0">' + esc(text) + '</p><p style="margin:16px 0 0"><a href="/mypage" style="color:#DC1478;font-weight:800;font-size:.88rem">마이페이지로 가기</a></p>');
  }
  var REASON = { taken: '이 초대 링크는 다른 계정에서 이미 사용했어요. 처음 시작한 계정으로 로그인하거나, 업체에 새 링크를 요청해 주세요.', completed: '이 초대 검사는 이미 마쳤어요. 결과는 마이페이지에서 다시 볼 수 있어요.', invalid: '사용할 수 없는 초대 링크예요. 링크를 보낸 업체에 다시 요청해 주세요.' };
  async function startInvite(){
    watchAuth();
    panel('<p style="font-size:.9rem;color:#5A5A6E;margin:0">초대 정보를 확인하고 있어요...</p>');
    var sb;
    try {
      sb = await SkoposAuth.getClient();
      var info = await sb.rpc('invite_info', { p_code: code });
      if (info.error) throw info.error;
      var d = info.data;
      if (!d || d.ok !== true) { fail(REASON.invalid); return; }
      if (d.test_type !== 'premium') { location.replace('/interior-beta?i=' + code); return; }
      bizName = String(d.business_name || '업체');
      if (d.status === 'completed' && !d.taken_by_other) { fail(REASON.completed); return; }
    } catch (e) { fail('초대 정보를 확인하지 못했어요. 잠시 후 새로고침해 주세요.'); return; }
    panel(consentHtml());
    var agree = document.getElementById('bizAgree'), btn = document.getElementById('bizStart');
    agree.addEventListener('change', function(){ btn.disabled = !agree.checked; btn.style.opacity = agree.checked ? '1' : '.45'; });
    btn.addEventListener('click', async function(){
      if (!agree.checked) return;
      btn.disabled = true; note('확인 중...');
      try {
        var s = await sb.auth.getSession();
        if (!s.data || !s.data.session) {
          btn.disabled = false; note('로그인한 뒤 다시 눌러 주세요.');
          SkoposAuth.showGate({ title: 'SDTI 정밀검사', subtitle: esc(bizName) + '에서 보낸 검사예요.<br>로그인하면 바로 시작할 수 있고, 결과는 로그인한 계정에 저장돼요.', cta: '로그인하고 시작하기' });
          return;
        }
        var a = await sb.rpc('invite_accept', { p_code: code });
        if (a.error) throw a.error;
        if (!a.data || a.data.ok !== true) { fail(REASON[a.data && a.data.reason] || REASON.invalid); return; }
        var b = await sb.rpc('invite_begin', { p_code: code, p_type: 'premium' });
        if (b.error) throw b.error;
        if (!b.data || b.data.ok !== true) { fail(REASON[b.data && b.data.reason] || REASON.invalid); return; }
        try { sessionStorage.setItem('skopos_paid', '1'); } catch (e) {}
        var pay = document.querySelector('#sp .btn-pay');
        if (pay) { pay.textContent = '✦ 검사 시작하기'; pay.onclick = function(){ startQuiz(true); }; }
        var g = document.querySelector('#sp .guarantee'); if (g) g.textContent = bizName + '에서 요청한 검사예요 · 따로 결제하실 것은 없어요';
        _authed = true;
        window.SkoposBiz.code = code; // 결과 저장 때 이 초대에 연결한다
        hidePanel();
        var saved = null; try { saved = loadProgress(); } catch (e) {}
        if (saved) showResumeModal(saved); else startQuiz(true);
      } catch (e) { btn.disabled = false; note('시작하지 못했어요. 잠시 후 다시 시도해 주세요.', true); }
    });
  }

  // ── 업체의 고객 리포트 열람 ──
  var GUIDE = { not_completed: '고객이 아직 검사를 마치지 않았어요.', not_purchased: '리포트를 구매하면 볼 수 있어요. 업체 화면의 고객 목록에서 구매해 주세요.', not_shared: '고객이 결과 공유를 중지해 리포트를 볼 수 있는 기간이 끝났어요.', result_deleted: '고객의 결과가 삭제되어 리포트를 볼 수 없어요.' };
  function failBg(text){
    panel('<h1 style="font-size:1.05rem;font-weight:800;margin:0 0 8px">고객 정밀검사 리포트</h1><p style="font-size:.9rem;color:#5A5A6E;margin:0">' + esc(text) + '</p><p style="margin:16px 0 0"><a href="/business" style="color:#DC1478;font-weight:800;font-size:.88rem">업체 화면으로 돌아가기</a></p>');
  }
  function startView(){
    if (!window.SkoposAuth) return;
    // 리포트가 준비될 때까지 '분석 중' 화면을 보여 준다 (로그인 창은 이 화면 위에 뜬다)
    panel('<div style="text-align:center;padding:28px 0"><div style="width:44px;height:44px;margin:0 auto 16px;border-radius:50%;border:4px solid #F3C6DE;border-top-color:#E91E8C;animation:bizspin .9s linear infinite"></div><b style="font-size:1.05rem">검사 데이터를 분석 중입니다</b><p style="font-size:.86rem;color:#8890A4;margin:8px 0 0">고객의 정밀검사 리포트를 준비하고 있어요. 잠시만 기다려 주세요.</p></div><style>@keyframes bizspin{to{transform:rotate(360deg)}}</style>');
    SkoposAuth.guard({
      title: '업체 화면',
      subtitle: '업체 계정으로 로그인하면 고객의 정밀검사 리포트를 볼 수 있어요.',
      onReady: async function(user){
        try { _authed = true; applyLoggedInUser(user); } catch (e) {}
        try {
          var sb = await SkoposAuth.getClient();
          var r = await sb.rpc('business_client_report', { p_id: bg });
          if (r.error) throw r.error;
          var d = r.data;
          if (!d || d.ok !== true) { failBg(GUIDE[d && d.reason] || '이 계정으로는 볼 수 없는 리포트예요. 업체 계정으로 로그인했는지 확인해 주세요.'); return; }
          var type = TYPE_MAP[d.result_type];
          if (!type) { failBg('리포트를 표시하지 못했어요. 카카오톡 채널로 문의해 주세요.'); return; }
          // 리포트와 PDF 에는 로그인한 업체 담당자가 아니라 고객 이름(별칭)을 쓴다
          try { currentUserName = String(d.name || '고객').replace(/[<>"'`&\\]/g, '').trim().slice(0, 30); } catch (e) {}
          resultType = type;
          renderResult(type, d.scores || {});
          show('sr');
          var bar = document.createElement('div');
          bar.style.cssText = 'position:sticky;top:0;z-index:500;background:#0F0F1A;color:#fff;font-size:.82rem;font-weight:700;padding:10px 16px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap';
          bar.innerHTML = '<span>' + esc(d.name || '고객') + '님의 SDTI 정밀검사 리포트 · 업체 열람용</span><a href="/business" style="color:#FFB3D9;font-weight:800;text-decoration:none">업체 화면으로</a>';
          var sr = document.getElementById('sr'); if (sr) sr.insertBefore(bar, sr.firstChild);
          setTimeout(hidePanel, 700);
          setTimeout(function(){
            document.querySelectorAll('.r-bar-fill').forEach(function(b){ b.style.width = b.dataset.val + '%'; });
            document.querySelectorAll('.budget-fill').forEach(function(b){ b.style.width = b.dataset.val + '%'; });
            try { renderSpaceRefs(type); } catch (e) {}
          }, 400);
        } catch (e) { failBg('리포트를 불러오지 못했어요. 잠시 후 새로고침해 주세요.'); }
      }
    });
  }

  window.SkoposBiz = { active: isCode || isBg, code: '', start: function(){ if (isCode) startInvite(); else if (isBg) startView(); } };
})();
