(function () {
 const status=document.getElementById('status');
 import('./migrate.js?v=3').catch(function () {
  status.textContent='فایل اتصال بارگیری نشد. صفحه را داخل مرورگر DApp سیف‌پل دوباره باز کنید؛ اگر ادامه داشت، عکس همین پیام را بفرستید.';
  document.getElementById('connect').disabled=true;
 });
})();
