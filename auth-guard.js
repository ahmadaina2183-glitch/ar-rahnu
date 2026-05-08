(() => {
  const page = document.body?.dataset?.role || window.AR_RAHNU_ROLE || 'customer';
  const raw = localStorage.getItem('arrahnu_auth');
  let auth = null;
  try { auth = raw ? JSON.parse(raw) : null; } catch {}
  const allowed = page === 'customer' ? ['customer', 'staff', 'admin'] : page === 'staff' ? ['staff', 'admin'] : ['admin'];
  if (!auth?.token || !allowed.includes(auth.role)) {
    location.replace('/ar-rahnu/login.html');
    return;
  }
  window.AR_RAHNU_AUTH = auth;
  window.arrahnuLogout = () => { localStorage.removeItem('arrahnu_auth'); location.replace('/ar-rahnu/login.html'); };
})();
