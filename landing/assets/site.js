// Swap "Log in / Get started" for an Account link when signed in to the app. The
// `quilla_signed_in` cookie is a flag only (no token), set/cleared by app.js on the
// app.quilla.co.za side and shared here via the .quilla.co.za cookie domain — a UX
// nicety, not a security check.
(function(){
  var cookies = "; " + document.cookie;
  var parts = cookies.split("; quilla_signed_in=");
  if (parts.length < 2 || parts.pop().split(";")[0] !== "1") return;
  document.querySelectorAll(".nav-right").forEach(function(el){
    el.innerHTML = '<a class="btn btn-primary btn-sm" href="https://app.quilla.co.za/">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6"/></svg>' +
      'Account</a>';
  });
})();

// Landing page interactions: the Transcript / AI insights / Possible risks tabs in the demo card.
(function(){
  var tabs = document.querySelectorAll('[data-ttab]');
  tabs.forEach(function(b){
    b.addEventListener('click', function(){
      tabs.forEach(function(x){ x.setAttribute('aria-selected', String(x === b)); });
      ['t','i','r'].forEach(function(k){
        var pane = document.getElementById('tpane-' + k);
        if (pane) pane.hidden = (k !== b.dataset.ttab);
      });
    });
  });
})();
