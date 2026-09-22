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
