// Signed in: swap "Log in / Get started" for a dashboard link + account dropdown, and the
// page's call-to-action buttons for "Go to your records" / "New record".
// The `quilla_signed_in` cookie holds just the advisor's email (no token), set/cleared
// by app.js on the app.quilla.co.za side and shared here via the .quilla.co.za cookie
// domain — a UX nicety, not a security check. "Account settings" and "Sign out" don't
// act on any session here (this origin has none); they navigate to the app with a query
// param and app.js handles it there.
(function(){
  var cookies = "; " + document.cookie;
  var parts = cookies.split("; quilla_signed_in=");
  if (parts.length < 2) return;
  var email = decodeURIComponent(parts.pop().split(";")[0] || "");
  if (!email) return;
  var esc = function(s){ return String(s).replace(/[&<>"']/g, function(c){ return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]; }); };
  document.querySelectorAll(".nav-right").forEach(function(el){
    el.innerHTML = '<a class="btn btn-primary btn-sm" href="https://app.quilla.co.za/">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>' +
      'Dashboard</a>' +
      '<details class="acct">' +
        '<summary class="acct-trigger" aria-label="Account menu"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6"/></svg></summary>' +
        '<div class="acct-menu">' +
          '<div class="acct-email">Signed in as<br><b>' + esc(email) + '</b></div>' +
          '<a href="https://app.quilla.co.za/">Advice records</a>' +
          '<a href="https://app.quilla.co.za/?view=account">Account settings</a>' +
          '<a href="https://app.quilla.co.za/?signout=1">Sign out</a>' +
        '</div>' +
      '</details>';
  });
  // Hero and bottom call-to-action: "Get started / Try an example meeting" become
  // "Go to your records / New record". Each button keeps its own style classes.
  var ARROW = '<svg class="arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';
  var PLUS = '<span class="play plus" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg></span>';
  document.querySelectorAll(".hero-cta").forEach(function(el){
    var a = el.querySelectorAll("a");
    if (a[0]) { a[0].href = "https://app.quilla.co.za/"; a[0].innerHTML = "Go to your records " + ARROW; }
    if (a[1]) { a[1].href = "https://app.quilla.co.za/#/records/new"; a[1].innerHTML = PLUS + "New record"; }
  });
  document.addEventListener("click", function(e){
    document.querySelectorAll(".acct[open]").forEach(function(d){ if (!d.contains(e.target)) d.removeAttribute("open"); });
  });
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape") document.querySelectorAll(".acct[open]").forEach(function(d){ d.removeAttribute("open"); });
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

// Home hero: transparent nav over the scene, solid once scrolled.
(function(){
  if (!document.body.classList.contains("home")) return;
  var nav = document.querySelector(".nav");
  var on = function(){ nav.classList.toggle("scrolled", window.scrollY > 24); };
  on(); window.addEventListener("scroll", on, { passive: true });
})();
