(function () {
 const status=document.getElementById('status');
 import('./migrate.js?v=4').catch(function () {
  status.textContent='The connection module failed to load. Reopen this page in the SafePal DApp browser. If the problem persists, share a screenshot of this message.';
  document.getElementById('connect').disabled=true;
 });
})();
