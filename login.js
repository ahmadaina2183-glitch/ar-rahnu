const $ = (id) => document.getElementById(id);
const API_BASE = 'https://arrahnu.116.203.111.60.sslip.io';
const APP_BASE = '/ar-rahnu/';
let role = 'customer';
let registerMode = false;

function renderMode() {
  const isCustomer = role === 'customer';
  $('customerLoginFields').hidden = !isCustomer;
  $('pinLoginFields').hidden = isCustomer;
  $('toggleRegisterBtn').hidden = !isCustomer;
  $('registerFields').hidden = !(isCustomer && registerMode);
  $('formTitle').textContent = isCustomer ? (registerMode ? 'Register Customer' : 'Login Customer') : `Login ${role === 'staff' ? 'Staff' : 'Admin'}`;
  $('loginModeTitle').textContent = $('formTitle').textContent;
  $('loginBtn').textContent = registerMode ? 'Register & Login' : 'Login';
  $('toggleRegisterBtn').textContent = registerMode ? 'Sudah ada akaun? Login' : 'Register Customer';
  $('loginHint').textContent = isCustomer ? (registerMode ? 'Daftar customer baru guna email dan password.' : 'Customer login guna email dan password.') : `${role === 'staff' ? 'Staff' : 'Admin'} login guna PIN akses.`;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-role]');
  if (!btn) return;
  role = btn.dataset.role;
  registerMode = false;
  document.querySelectorAll('.role-btn').forEach((b) => b.classList.toggle('active', b.dataset.role === role));
  renderMode();
});

$('toggleRegisterBtn').addEventListener('click', () => { registerMode = !registerMode; renderMode(); });

async function submitAuth() {
  $('loginBtn').disabled = true;
  $('loginBtn').textContent = registerMode ? 'Registering...' : 'Checking...';
  try {
    const url = API_BASE + (registerMode ? '/api/auth/register' : '/api/auth/login');
    const payload = role === 'customer'
      ? { role, name: $('regName').value, username: $('regUsername')?.value, phone: $('regPhone').value, email: $('loginEmail').value, password: $('loginPassword').value }
      : { role, pin: $('loginPin').value };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || 'Login gagal');
    localStorage.setItem('arrahnu_auth', JSON.stringify({ token: json.token, role: json.role, loginAt: Date.now() }));
    location.href = APP_BASE + String(json.redirect || '/index.html').replace(/^\//, '');
  } catch (err) {
    alert(err.message);
  } finally {
    $('loginBtn').disabled = false;
    renderMode();
  }
}

$('loginBtn').addEventListener('click', submitAuth);
document.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth(); });
renderMode();

$('loginBackBtn')?.addEventListener('click', () => { if (history.length > 1) history.back(); else location.href = APP_BASE; });
