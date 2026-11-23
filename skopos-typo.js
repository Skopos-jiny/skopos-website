/* SKOPOS 공통 정렬 규칙 (2026-11)
   가운데: 머리말·짧은 안내처럼 원래 가운데 정렬된 글은 그대로 둔다
   양쪽 맞춤: 원래 왼쪽 정렬이면서 폭 300px 이상, 60자 이상인 문단
   왼쪽: 좁은 칸, 직접 줄바꿈한 문단, 큰 글씨, 표·버튼·입력·메뉴·출처 */
(function(){
  var SEL='p,li,[class*="desc"],[class*="-body"],[class*="-text"],[class*="-sub"]';
  var SKIP='nav,header,footer,button,a,table,form,label,select,textarea,input,code,pre,#pdfContainer,.mk-sec,.upgrade-cta,.no-typo,.sk-gate';
  var MIN_W=300, MIN_LEN=60;
  function hasBlockChild(el){
    for(var i=0;i<el.children.length;i++){
      var d=getComputedStyle(el.children[i]).display;
      if(d==='block'||d==='flex'||d==='grid'||d==='list-item'||d==='table') return true;
    }
    return false;
  }
  function apply(root){
    try{
      var list=(root||document).querySelectorAll(SEL);
      for(var i=0;i<list.length;i++){
        var el=list[i];
        if(el.closest(SKIP)) { el.classList.remove('sk-justify'); continue; }
        var txt=(el.textContent||'').replace(/\s+/g,' ').trim();
        if(txt.length<MIN_LEN || hasBlockChild(el)) { el.classList.remove('sk-justify'); continue; }
        var cs=getComputedStyle(el);
        var align=el.classList.contains('sk-justify') ? 'start' : cs.textAlign;   // 원래 정렬 기준
        var w=el.clientWidth, fs=parseFloat(cs.fontSize)||15;
        // 줄바꿈(<br>)을 직접 넣은 문단·큰 글씨(히어로)·한 줄에 24자 안팎도 안 들어가는 좁은 칸은 제외
        var ok=(align==='left'||align==='start') && w>=MIN_W && fs<16.5 && (w/fs)>=23.5 && !el.querySelector('br');
        if(ok) el.classList.add('sk-justify');
        else el.classList.remove('sk-justify');
      }
    }catch(e){}
  }
  var t=null;
  function schedule(){ clearTimeout(t); t=setTimeout(function(){ apply(document); }, 180); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', schedule); else schedule();
  window.addEventListener('load', schedule);
  window.addEventListener('resize', schedule);
  try{ new MutationObserver(function(ms){ for(var i=0;i<ms.length;i++){ if(ms[i].addedNodes&&ms[i].addedNodes.length){ schedule(); return; } } }).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
})();
