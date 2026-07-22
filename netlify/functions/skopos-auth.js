/* ============================================================
 * SKOPOS 공유 인증 모듈  (skopos-auth.js)
 * ------------------------------------------------------------
 * 목적
 *   - Supabase 클라이언트를 페이지당 1개만 생성(싱글턴)
 *   - "로그인이 된 상태에서만 검사 진행" 알고리즘 제공
 *   - 비로그인 시 페이지를 벗어나지 않는 인페이지 로그인 게이트 노출
 *   - login.html 과 동일한 이메일/카카오/네이버 로그인 로직 재사용
 *
 * 사용법 (검사 페이지)
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 *   <script src="skopos-auth.js"></script>
 *   <script>
 *     SkoposAuth.guard({
 *       onReady(user){ ...로그인 확인됨, 검사 시작 허용... },
 *     });
 *   </script>
 * ============================================================ */
(function (global) {
  'use strict';

  // ── 설정 (login.html 과 동일 값) ─────────────────────────
  var CONFIG = {
    url:  'https://rgbukqphcqptnfeqipfn.supabase.co',
    anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnYnVrcXBoY3FwdG5mZXFpcGZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTkzMDMsImV4cCI6MjA5NDI3NTMwM30.fWUHe2AoWr9fMLUNSQkbhosUO7FH9dvZOIZbz_XyzFM',
    naverClientId: 'MUwb6Wq_YGvDSIbbkRB1',
    kakaoAppKey:   'd0c68901a08c4272cce34084fca1372d',
  };

  var _client = null;      // Supabase 클라이언트 싱글턴
  var _gateEl = null;      // 로그인 게이트 DOM 참조

  // ── Supabase 라이브러리 로드 대기 (defer/CDN 지연 대응) ──
  function libReady() {
    return typeof global.supabase !== 'undefined' &&
           typeof global.supabase.createClient === 'function';
  }
  function waitForLib(timeout) {
    timeout = timeout || 8000;
    return new Promise(function (resolve, reject) {
      if (libReady()) return resolve();
      var t0 = Date.now();
      var iv = setInterval(function () {
        if (libReady()) { clearInterval(iv); resolve(); }
        else if (Date.now() - t0 > timeout) {
          clearInterval(iv);
          reject(new Error('SUPABASE_LIB_TIMEOUT'));
        }
      }, 50);
    });
  }

  // ── 클라이언트 / 세션 헬퍼 ───────────────────────────────
  async function getClient() {
    if (_client) return _client;
    await waitForLib();
    _client = global.supabase.createClient(CONFIG.url, CONFIG.anon);
    return _client;
  }
  async function getSession() {
    var sb = await getClient();
    var res = await sb.auth.getSession();
    return res.data ? res.data.session : null;
  }
  async function getUser() {
    var s = await getSession();
    return s ? s.user : null;
  }
  function displayName(user) {
    if (!user) return '';
    var m = user.user_metadata || {};
    return m.full_name || m.name || (user.email ? user.email.split('@')[0] : '') || '';
  }
  async function signOut() {
    var sb = await getClient();
    await sb.auth.signOut();
  }

  // 현재 페이지 URL(쿼리 포함) — 로그인 후 복귀 지점
  function currentUrl() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  /* ==========================================================
   * 핵심 알고리즘: guard()
   *   1) Supabase 준비 대기
   *   2) 현재 세션 조회
   *   3) 세션 있음  → onReady(user) 호출 (검사 진행 허용)
   *      세션 없음  → 인페이지 로그인 게이트 표시
   *        (opts.passive=true 면 게이트를 띄우지 않고 구독만 유지
   *         — 공유 결과 열람 등 공개 화면에서 사용. 이후 페이지가
   *         showGate() 로 게이트를 띄워 로그인하면 onReady 가 발화)
   *   4) 이후 로그인 성공(onAuthStateChange: SIGNED_IN)이나
   *      OAuth 복귀 시 게이트를 닫고 onReady(user) 를 1회 호출
   * ========================================================== */
  async function guard(opts) {
    opts = opts || {};
    var readyFired = false;
    function fire(user) {
      if (readyFired) return;
      readyFired = true;
      unmountGate();
      try { if (opts.onReady) opts.onReady(user); }
      catch (e) { console.error('[SkoposAuth] onReady 오류:', e); }
    }

    var sb;
    try {
      sb = await getClient();
    } catch (e) {
      console.error('[SkoposAuth] Supabase 로드 실패:', e);
      if (!opts.passive) {
        mountGate({ error: '인증 서비스를 불러오지 못했습니다.\n네트워크 확인 후 새로고침 해주세요.' });
      }
      return;
    }

    // 로그인 상태 변화 구독 (OAuth 복귀 · 토큰 갱신 · 늦은 showGate 로그인 대응)
    sb.auth.onAuthStateChange(function (event, session) {
      if (session && session.user) fire(session.user);
    });

    var session = await getSession();
    if (session && session.user) {
      fire(session.user);
    } else if (!opts.passive) {
      if (opts.onGate) { try { opts.onGate(); } catch (e) {} }
      mountGate({ title: opts.title, subtitle: opts.subtitle });
    }
  }

  /* ==========================================================
   * 인페이지 로그인 게이트 (오버레이)
   *   login.html 과 동일한 이메일/카카오/네이버 로직을 담아
   *   페이지를 벗어나지 않고 로그인 → 검사로 이어지게 함
   * ========================================================== */
  function injectStyles() {
    if (document.getElementById('sk-gate-style')) return;
    var css = ''
      + '.sk-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;'
      + 'background:rgba(15,15,26,.72);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);'
      + 'font-family:"Apple SD Gothic Neo","Noto Sans KR",sans-serif;overflow-y:auto}'
      + '.sk-gate *{box-sizing:border-box}'
      + '.sk-card{width:100%;max-width:400px;background:#fff;border-radius:20px;padding:30px 28px;box-shadow:0 12px 48px rgba(0,0,0,.35);animation:skIn .3s ease}'
      + '@keyframes skIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}'
      + '.sk-logo{text-align:center;font-size:1.35rem;font-weight:900;color:#0F0F1A;letter-spacing:-.02em;margin-bottom:4px}'
      + '.sk-logo b{color:#E91E8C}'
      + '.sk-lead{text-align:center;font-size:.8rem;color:#8890A4;margin-bottom:22px;line-height:1.5}'
      + '.sk-lead strong{color:#E91E8C}'
      + '.sk-tabs{display:flex;background:#F7F8FC;border-radius:10px;padding:4px;margin-bottom:18px}'
      + '.sk-tab{flex:1;padding:9px;text-align:center;font-size:.82rem;font-weight:700;color:#8890A4;border-radius:8px;cursor:pointer;border:none;background:none;font-family:inherit;transition:all .2s}'
      + '.sk-tab.on{background:#fff;color:#0F0F1A;box-shadow:0 2px 8px rgba(0,0,0,.08)}'
      + '.sk-social{display:flex;flex-direction:column;gap:9px;margin-bottom:16px}'
      + '.sk-sbtn{display:flex;align-items:center;justify-content:center;gap:9px;padding:13px;border-radius:12px;border:none;font-size:.88rem;font-weight:700;cursor:pointer;font-family:inherit;width:100%;transition:transform .15s,box-shadow .15s}'
      + '.sk-sbtn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.12)}'
      + '.sk-kakao{background:#FEE500;color:#191919}.sk-naver{background:#03C75A;color:#fff}'
      + '.sk-or{display:flex;align-items:center;gap:12px;margin-bottom:16px}'
      + '.sk-or::before,.sk-or::after{content:"";flex:1;height:1px;background:rgba(0,0,0,.08)}'
      + '.sk-or span{font-size:.7rem;color:#8890A4;white-space:nowrap}'
      + '.sk-field{margin-bottom:12px}'
      + '.sk-field label{display:block;font-size:.74rem;font-weight:700;color:#3D3D5C;margin-bottom:6px}'
      + '.sk-field input{width:100%;padding:12px 14px;border:1.5px solid rgba(0,0,0,.1);border-radius:10px;font-size:.88rem;font-family:inherit;outline:none;transition:border-color .2s}'
      + '.sk-field input:focus{border-color:#E91E8C}'
      + '.sk-submit{width:100%;padding:14px;background:linear-gradient(135deg,#E91E8C,#FF6B9D);color:#fff;border:none;border-radius:50px;font-size:.92rem;font-weight:800;cursor:pointer;font-family:inherit;margin-top:4px;transition:transform .15s,box-shadow .15s}'
      + '.sk-submit:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(233,30,140,.35)}'
      + '.sk-submit:disabled{opacity:.6;cursor:not-allowed;transform:none}'
      + '.sk-terms{display:flex;align-items:flex-start;gap:8px;margin-bottom:12px;cursor:pointer}'
      + '.sk-terms input{margin-top:2px;accent-color:#E91E8C;flex-shrink:0}'
      + '.sk-terms span{font-size:.72rem;color:#8890A4;line-height:1.5}'
      + '.sk-msg{padding:11px 13px;border-radius:10px;font-size:.78rem;margin-bottom:12px;display:none;line-height:1.5;white-space:pre-line}'
      + '.sk-msg.err{display:block;background:rgba(229,57,53,.07);border:1px solid rgba(229,57,53,.2);color:#c62828}'
      + '.sk-msg.ok{display:block;background:rgba(3,199,90,.07);border:1px solid rgba(3,199,90,.25);color:#027a35}'
      + '.sk-panel{display:none}.sk-panel.on{display:block}'
      + '.sk-icon{width:19px;height:19px;flex-shrink:0}';
    var st = document.createElement('style');
    st.id = 'sk-gate-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function mountGate(o) {
    o = o || {};
    if (_gateEl) return;           // 이미 떠 있으면 재생성 방지
    injectStyles();

    var title = o.title || '';
    var subtitle = o.subtitle || 'SKOPOS 검사는 <strong>로그인 후</strong> 진행할 수 있어요.<br>결과는 안전하게 계정에 저장됩니다.';

    var wrap = document.createElement('div');
    wrap.className = 'sk-gate';
    wrap.innerHTML =
      '<div class="sk-card" role="dialog" aria-modal="true" aria-label="로그인">'
      + '<div class="sk-logo">SKO<b>POS</b></div>'
      + (title ? '<div style="text-align:center;font-size:.95rem;font-weight:800;color:#0F0F1A;margin:4px 0 6px">' + escapeHtml(title) + '</div>' : '')
      + '<div class="sk-lead">' + subtitle + '</div>'
      + (o.error
          ? '<div class="sk-msg err" style="display:block">' + escapeHtml(o.error) + '</div>'
          : '')
      + '<div class="sk-tabs">'
      +   '<button type="button" class="sk-tab on" data-tab="login">로그인</button>'
      +   '<button type="button" class="sk-tab" data-tab="signup">회원가입</button>'
      + '</div>'
      + '<div class="sk-msg" id="skMsg"></div>'
      + '<div class="sk-social">'
      +   '<button type="button" class="sk-sbtn sk-kakao" id="skKakao">'
      +     '<svg class="sk-icon" viewBox="0 0 24 24" fill="#191919"><path d="M12 3C6.477 3 2 6.477 2 10.805c0 2.756 1.633 5.187 4.116 6.64-.18.676-.655 2.454-.75 2.835-.117.468.171.463.36.337.148-.098 2.35-1.575 3.3-2.214.319.044.645.067.974.067 5.523 0 10-3.477 10-7.805S17.523 3 12 3z"/></svg>'
      +     '카카오톡으로 계속</button>'
      +   '<button type="button" class="sk-sbtn sk-naver" id="skNaver">'
      +     '<svg class="sk-icon" viewBox="0 0 24 24" fill="white"><path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/></svg>'
      +     '네이버로 계속</button>'
      + '</div>'
      + '<div class="sk-or"><span>또는 이메일로 계속</span></div>'
      // 로그인 패널
      + '<div class="sk-panel on" data-panel="login">'
      +   '<div class="sk-field"><label>이메일</label><input type="email" id="skLoginEmail" placeholder="이메일을 입력해주세요" autocomplete="email"></div>'
      +   '<div class="sk-field"><label>비밀번호</label><input type="password" id="skLoginPw" placeholder="비밀번호를 입력해주세요" autocomplete="current-password"></div>'
      +   '<button type="button" class="sk-submit" id="skLoginBtn">로그인하고 검사 시작</button>'
      + '</div>'
      // 회원가입 패널
      + '<div class="sk-panel" data-panel="signup">'
      +   '<div class="sk-field"><label>이름</label><input type="text" id="skSignName" placeholder="이름을 입력해주세요"></div>'
      +   '<div class="sk-field"><label>이메일</label><input type="email" id="skSignEmail" placeholder="이메일을 입력해주세요" autocomplete="email"></div>'
      +   '<div class="sk-field"><label>비밀번호</label><input type="password" id="skSignPw" placeholder="8자 이상 입력해주세요" autocomplete="new-password"></div>'
      +   '<label class="sk-terms"><input type="checkbox" id="skTerms"><span>이용약관 및 개인정보처리방침에 동의합니다</span></label>'
      +   '<button type="button" class="sk-submit" id="skSignBtn">회원가입</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    _gateEl = wrap;
    wireGate(wrap);
  }

  function unmountGate() {
    if (!_gateEl) return;
    _gateEl.remove();
    _gateEl = null;
    document.body.style.overflow = '';
  }

  // ── 게이트 이벤트 배선 ───────────────────────────────────
  function wireGate(root) {
    var msg = root.querySelector('#skMsg');
    function show(type, text) {
      msg.className = 'sk-msg ' + type;
      msg.textContent = text;
    }
    function clear() { msg.className = 'sk-msg'; msg.textContent = ''; }

    // 로그인 성공 후 폴백: 정상 경로에선 guard() 의 onAuthStateChange
    // 구독이 게이트를 닫지만, 구독이 없는 엣지(라이브러리 로드 타임아웃
    // 후 오류 게이트 등)에서는 아무도 게이트를 닫지 못한다.
    // → 잠시 기다렸다 게이트가 여전히 떠 있으면 새로고침으로 복구
    //   (세션은 저장돼 있으므로 리로드 후 guard 가 정상 통과시킴)
    function ensureGateResolves() {
      setTimeout(function () {
        if (_gateEl) {
          unmountGate();
          window.location.reload();
        }
      }, 600);
    }

    // 탭 전환
    root.querySelectorAll('.sk-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        var tab = t.getAttribute('data-tab');
        root.querySelectorAll('.sk-tab').forEach(function (x) { x.classList.toggle('on', x === t); });
        root.querySelectorAll('.sk-panel').forEach(function (p) {
          p.classList.toggle('on', p.getAttribute('data-panel') === tab);
        });
        clear();
      });
    });

    // 이메일 로그인
    var loginBtn = root.querySelector('#skLoginBtn');
    loginBtn.addEventListener('click', async function () {
      clear();
      var email = root.querySelector('#skLoginEmail').value.trim();
      var pw = root.querySelector('#skLoginPw').value;
      if (!email || email.indexOf('@') < 0) { show('err', '이메일을 올바르게 입력해주세요'); return; }
      if (!pw) { show('err', '비밀번호를 입력해주세요'); return; }
      loginBtn.disabled = true; loginBtn.textContent = '로그인 중...';
      try {
        var sb = await getClient();
        var r = await sb.auth.signInWithPassword({ email: email, password: pw });
        if (r.error) {
          var m = r.error.message || '';
          show('err', m.indexOf('Invalid') >= 0 ? '이메일 또는 비밀번호가 올바르지 않습니다'
             : m.indexOf('Email not confirmed') >= 0 ? '이메일 인증이 필요합니다. 받은 편지함을 확인해주세요.'
             : '로그인 오류: ' + m);
          loginBtn.disabled = false; loginBtn.textContent = '로그인하고 검사 시작';
        } else {
          // 성공: 정상 경로는 onAuthStateChange(SIGNED_IN) 가 게이트를
          // 닫고 검사 진행. 구독이 없는 엣지는 폴백이 새로고침으로 복구.
          ensureGateResolves();
        }
      } catch (e) {
        show('err', '로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        loginBtn.disabled = false; loginBtn.textContent = '로그인하고 검사 시작';
      }
    });

    // 이메일 회원가입
    var signBtn = root.querySelector('#skSignBtn');
    signBtn.addEventListener('click', async function () {
      clear();
      var name = root.querySelector('#skSignName').value.trim();
      var email = root.querySelector('#skSignEmail').value.trim();
      var pw = root.querySelector('#skSignPw').value;
      var agree = root.querySelector('#skTerms').checked;
      if (!name) { show('err', '이름을 입력해주세요'); return; }
      if (!email || email.indexOf('@') < 0) { show('err', '올바른 이메일을 입력해주세요'); return; }
      if (pw.length < 8) { show('err', '비밀번호는 8자 이상이어야 합니다'); return; }
      if (!agree) { show('err', '이용약관에 동의해주세요'); return; }
      signBtn.disabled = true; signBtn.textContent = '가입 중...';
      try {
        var sb = await getClient();
        var r = await sb.auth.signUp({ email: email, password: pw, options: { data: { full_name: name } } });
        if (r.error) {
          show('err', '가입 오류: ' + r.error.message);
          signBtn.disabled = false; signBtn.textContent = '회원가입';
        } else if (r.data && r.data.session) {
          // 이메일 인증 불필요 설정 → 즉시 로그인됨 (onAuthStateChange 가 처리)
          show('ok', '가입 완료! 검사를 시작합니다.');
          ensureGateResolves();
        } else {
          show('ok', '가입 완료! 이메일 인증 후 로그인해주세요.');
          signBtn.disabled = false; signBtn.textContent = '회원가입 완료';
        }
      } catch (e) {
        show('err', '가입 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        signBtn.disabled = false; signBtn.textContent = '회원가입';
      }
    });

    // Enter 키
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var loginOn = root.querySelector('.sk-panel[data-panel="login"]').classList.contains('on');
      if (loginOn) loginBtn.click(); else signBtn.click();
    });

    // 카카오
    root.querySelector('#skKakao').addEventListener('click', async function () {
      clear();
      try {
        var sb = await getClient();
        var r = await sb.auth.signInWithOAuth({
          provider: 'kakao',
          options: { redirectTo: window.location.origin + currentUrl() }
        });
        if (r.error) show('err', '카카오 로그인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      } catch (e) { show('err', '카카오 로그인 오류가 발생했습니다.'); }
    });

    // 네이버 (login.html 과 동일: 커스텀 인증 → naver-callback.html 복귀)
    root.querySelector('#skNaver').addEventListener('click', function () {
      clear();
      try {
        var state = Math.random().toString(36).slice(2);
        sessionStorage.setItem('naver_state', state);
        sessionStorage.setItem('naver_redirect', currentUrl());
        var params = new URLSearchParams({
          response_type: 'code',
          client_id: CONFIG.naverClientId,
          redirect_uri: window.location.origin + '/naver-callback.html',
          state: state
        });
        window.location.href = 'https://nid.naver.com/oauth2.0/authorize?' + params;
      } catch (e) { show('err', '네이버 로그인 오류가 발생했습니다.'); }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── 공개 API ─────────────────────────────────────────────
  global.SkoposAuth = {
    CONFIG: CONFIG,
    getClient: getClient,
    getSession: getSession,
    getUser: getUser,
    displayName: displayName,
    signOut: signOut,
    guard: guard,
    showGate: mountGate,
    hideGate: unmountGate,
  };

})(window);
