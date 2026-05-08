const $ = (id) => document.getElementById(id);
const API_BASE = 'https://arrahnu.116.203.111.60.sslip.io';
const rm = (n) => `RM ${Number(n || 0).toLocaleString('ms-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let state = { metrics: {}, settings: {}, staff: [], customers: [], tickets: [] };

async function apiJson(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const json = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON response' }));
  if (!res.ok || json.ok === false) throw new Error(json.error || `API error ${res.status}`);
  return json;
}
function statusLabel(s) { return { active: 'Aktif', warning: 'Amaran', overdue: 'Lewat', redeemed: 'Selesai' }[s] || s || '-'; }
function barRows(rows, fmt = (v) => v) { const max = Math.max(1, ...rows.map((r) => Number(r.value || 0))); return rows.map((r) => `<div class="bar-row"><div class="bar-meta"><span>${r.label}</span><b>${fmt(r.value)}</b></div><div class="bar-track"><i style="width:${Math.max(4, (Number(r.value || 0) / max) * 100)}%"></i></div></div>`).join(''); }
function customerBalance(id) { return state.tickets.filter((t) => t.customer?.id === id && t.status !== 'redeemed').reduce((a, t) => a + Number(t.remainingPrincipal || t.principal || 0), 0); }
function customerTicketCount(id) { return state.tickets.filter((t) => t.customer?.id === id).length; }

async function loadAdmin() {
  $('adminRefreshBtn').disabled = true; $('adminRefreshBtn').textContent = 'Loading...';
  try {
    const json = await apiJson('/api/admin/summary');
    state = { metrics: json.metrics || {}, settings: json.settings || {}, staff: json.staff || [], customers: json.customers || [], tickets: json.tickets || [] };
    hydrateSettings(); renderAll();
  } catch (err) { alert(`Gagal load Admin Panel: ${err.message}`); }
  finally { $('adminRefreshBtn').disabled = false; $('adminRefreshBtn').textContent = 'Refresh'; }
}

function renderMetrics() {
  const m = state.metrics;
  $('adminMetrics').innerHTML = [
    ['Staff', m.staff || 0, 'Admin + staff'],
    ['Customer', m.customers || 0, 'Semua customer'],
    ['Surat Aktif', m.activeTickets || 0, `Total ${m.tickets || 0}`],
    ['Baki Pembiayaan', rm(m.totalPrincipal), 'Aktif sahaja']
  ].map(([label, value, sub]) => `<article class="staff-metric"><span>${label}</span><b>${value}</b><small>${sub}</small></article>`).join('');
}
function renderOverview() {
  renderMetrics();
  $('adminValueChart').innerHTML = barRows([
    { label: 'Baki Pembiayaan', value: state.metrics.totalPrincipal || 0 },
    { label: 'Nilai Marhun', value: state.metrics.totalMarhun || 0 },
    { label: 'Surat', value: state.metrics.tickets || 0 },
    { label: 'Customer', value: state.metrics.customers || 0 }
  ], (v) => Number(v) > 100 ? rm(v) : v);
  const admins = state.staff.filter((s) => s.role === 'admin').length;
  $('adminRoleChart').innerHTML = barRows([{ label: 'Admin', value: admins }, { label: 'Staff', value: Math.max(0, state.staff.length - admins) }, { label: 'Customer', value: state.customers.length }]);
}
function staffRow(s) { return `<article class="staff-row compact-ticket"><div><b>${s.full_name || s.email || '-'}</b><p>${s.email || '-'}</p><small>${s.role || 'staff'} • ${s.status || 'active'}</small></div><div class="staff-row-side"><span class="badge active">${s.role || 'staff'}</span><button class="secondary-btn mini-action" data-edit-staff="${s.id}">View</button></div></article>`; }
function customerRow(c) { return `<article class="staff-row compact-ticket"><div><b>${c.name || '-'}</b><p>${c.ic || c.phone || '-'}</p><small>${customerTicketCount(c.id)} surat • Baki ${rm(customerBalance(c.id))}</small></div><div class="staff-row-side"><span class="badge active">Customer</span></div></article>`; }
function renderStaff() { $('adminStaffList').innerHTML = state.staff.map(staffRow).join('') || '<p class="muted">Belum ada staff MVP. Tekan + Staff.</p>'; }
function renderCustomers() { const q = $('adminCustomerSearch').value.toLowerCase(); const rows = state.customers.filter((c) => `${c.name || ''} ${c.ic || ''} ${c.phone || ''}`.toLowerCase().includes(q)); $('adminCustomerList').innerHTML = rows.map(customerRow).join('') || '<p class="muted">Tiada customer.</p>'; }
function renderReports() { $('adminReport').innerHTML = `<div>Total Staff<br><b>${state.metrics.staff || 0}</b></div><div>Total Customer<br><b>${state.metrics.customers || 0}</b></div><div>Total Surat<br><b>${state.metrics.tickets || 0}</b></div><div>Baki Pembiayaan<br><b>${rm(state.metrics.totalPrincipal)}</b></div>`; $('adminTicketChart').innerHTML = barRows(['active','warning','overdue','redeemed'].map((s) => ({ label: statusLabel(s), value: state.tickets.filter((t) => t.status === s).length }))); }
function renderAll() { renderOverview(); renderStaff(); renderCustomers(); renderReports(); }

function hydrateSettings() { const s = state.settings || {}; $('setDefaultRate').value = s.defaultRate ?? 0.75; $('setRateMode').value = s.rateMode || 'month'; $('setDefaultLtv').value = String(s.defaultLtv ?? 0.8); $('setGoldPrice').value = s.goldPrice ?? 700; $('setAutoApprove').checked = Boolean(s.autoApproveCustomers); }
function openTab(tab) { document.querySelectorAll('.admin-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab)); document.querySelectorAll('.admin-panel').forEach((p) => p.classList.toggle('active', p.id === `admin-${tab}`)); $('adminTitle').textContent = { overview: 'Admin Panel', staff: 'Manage Staff', customers: 'Manage Customer', settings: 'Settings', reports: 'Report' }[tab] || 'Admin Panel'; }
function openStaff(staff = null) { $('editStaffId').value = staff?.id || ''; $('editStaffName').value = staff?.full_name || ''; $('editStaffEmail').value = staff?.email || ''; $('editStaffRole').value = staff?.role || 'staff'; $('editStaffStatus').value = staff?.status || 'active'; $('deleteStaffBtn').hidden = !staff?.id; $('staffDialogTitle').textContent = staff?.id ? 'Detail Staff' : 'Tambah Staff'; $('staffDialog').showModal(); }

document.addEventListener('click', (e) => { const tab = e.target.closest('[data-tab]'); if (tab) openTab(tab.dataset.tab); const edit = e.target.closest('[data-edit-staff]'); if (edit) openStaff(state.staff.find((s) => s.id === edit.dataset.editStaff)); });
$('addStaffBtn').addEventListener('click', () => openStaff());
$('adminRefreshBtn').addEventListener('click', loadAdmin);
$('adminCustomerSearch').addEventListener('input', renderCustomers);
$('saveSettingsBtn').addEventListener('click', async () => { try { await apiJson('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ defaultRate: $('setDefaultRate').value, rateMode: $('setRateMode').value, defaultLtv: $('setDefaultLtv').value, goldPrice: $('setGoldPrice').value, autoApproveCustomers: $('setAutoApprove').checked }) }); await loadAdmin(); alert('Settings berjaya save.'); } catch (err) { alert(`Gagal save settings: ${err.message}`); } });
$('staffForm').addEventListener('submit', async (e) => { e.preventDefault(); const id = $('editStaffId').value; try { await apiJson(id ? `/api/admin/staff/${id}` : '/api/admin/staff', { method: id ? 'PATCH' : 'POST', body: JSON.stringify({ full_name: $('editStaffName').value, email: $('editStaffEmail').value, role: $('editStaffRole').value, status: $('editStaffStatus').value }) }); $('staffDialog').close(); await loadAdmin(); } catch (err) { alert(`Gagal save staff: ${err.message}`); } });
$('deleteStaffBtn').addEventListener('click', async (e) => { e.preventDefault(); const id = $('editStaffId').value; if (!id || !confirm('Delete staff ini?')) return; try { await apiJson(`/api/admin/staff/${id}`, { method: 'DELETE' }); $('staffDialog').close(); await loadAdmin(); } catch (err) { alert(`Gagal delete staff: ${err.message}`); } });

loadAdmin();
