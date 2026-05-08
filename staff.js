const $ = (id) => document.getElementById(id);
const API_BASE = 'https://arrahnu.116.203.111.60.sslip.io';
const rm = (n) => `RM ${Number(n || 0).toLocaleString('ms-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateMs = (v) => v ? new Date(v).toLocaleDateString('ms-MY') : '-';

let state = { metrics: {}, tickets: [], customers: [] };

async function apiJson(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const json = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON response' }));
  if (!res.ok || json.ok === false) throw new Error(json.error || `API error ${res.status}`);
  return json;
}

function statusLabel(s) { return { active: 'Aktif', warning: 'Amaran', overdue: 'Lewat', redeemed: 'Selesai' }[s] || s || '-'; }
function statusClass(s) { return ['active', 'warning', 'overdue', 'redeemed'].includes(s) ? s : 'active'; }
function customerTicketCount(customerId) { return state.tickets.filter((t) => t.customer?.id === customerId).length; }
function customerBalance(customerId) { return state.tickets.filter((t) => t.customer?.id === customerId && t.status !== 'redeemed').reduce((a, t) => a + Number(t.remainingPrincipal || t.principal || 0), 0); }

async function loadStaff() {
  $('staffRefreshBtn').disabled = true;
  $('staffRefreshBtn').textContent = 'Loading...';
  try {
    const json = await apiJson('/api/staff/summary');
    state = { metrics: json.metrics || {}, tickets: json.tickets || [], customers: json.customers || [] };
    renderAll();
  } catch (err) {
    alert(`Gagal load Staff Panel: ${err.message}`);
  } finally {
    $('staffRefreshBtn').disabled = false;
    $('staffRefreshBtn').textContent = 'Refresh Data';
  }
}

function renderMetrics() {
  const m = state.metrics;
  $('staffMetrics').innerHTML = [
    ['Customer', m.customers || 0, `Hari ini: ${m.registrationsToday || 0}`],
    ['Surat Aktif', m.activeTickets || 0, `Total surat: ${m.tickets || 0}`],
    ['Baki Pembiayaan', rm(m.totalPrincipal), 'Semua surat aktif'],
    ['Nilai Marhun', rm(m.totalMarhun), 'Item aktif sahaja']
  ].map(([label, value, sub]) => `<article class="staff-metric"><span>${label}</span><b>${value}</b><small>${sub}</small></article>`).join('');
}

function ticketRow(t) {
  return `<article class="staff-row compact-ticket">
    <div>
      <b>${t.ticketNo || '-'}</b>
      <p>${t.customer?.name || '-'}</p>
      <small>Baki ${rm(t.remainingPrincipal || t.principal)} • ${statusLabel(t.status)}</small>
    </div>
    <div class="staff-row-side">
      <span class="badge ${statusClass(t.status)}">${statusLabel(t.status)}</span>
      <button class="secondary-btn mini-action" data-view-ticket="${t.id}">View</button>
    </div>
  </article>`;
}

function openTicketDialog(ticketId) {
  const t = state.tickets.find((x) => x.id === ticketId);
  if (!t) return;
  const marhun = (t.items || []).filter((i) => !i.redeemed).reduce((a, i) => a + Number(i.value || 0), 0);
  $('ticketDialogBody').innerHTML = `<div class="detail-hero staff-mini-hero"><h2>${t.ticketNo || '-'}</h2><p>${t.customer?.name || '-'} • ${t.customer?.ic || '-'}</p><p><b>${rm(t.remainingPrincipal || t.principal)}</b> baki pembiayaan</p></div>
    <div class="meta-grid">
      <div>Status<br><b>${statusLabel(t.status)}</b></div>
      <div>Marhun<br><b>${rm(marhun)}</b></div>
      <div>Created<br><b>${dateMs(t.createdAt)}</b></div>
      <div>Harga Emas<br><b>${rm(t.goldPrice)}/g</b></div>
    </div>
    <label style="margin-top:12px">Update Status
      <select id="ticketDialogStatus" data-ticket-status="${t.id}">
        <option value="active" ${t.status === 'active' ? 'selected' : ''}>Aktif</option>
        <option value="warning" ${t.status === 'warning' ? 'selected' : ''}>Amaran</option>
        <option value="overdue" ${t.status === 'overdue' ? 'selected' : ''}>Lewat</option>
        <option value="redeemed" ${t.status === 'redeemed' ? 'selected' : ''}>Selesai</option>
      </select>
    </label>
    <section class="staff-mini-list"><b>Item</b>${(t.items || []).map((i) => `<p>${i.redeemed ? '✅' : '💎'} ${i.description} — ${Number(i.weight || 0).toFixed(2)}g — ${rm(i.value)}</p>`).join('') || '<p>Tiada item.</p>'}</section>`;
  $('deleteTicketDialogBtn').dataset.deleteTicket = t.id;
  $('ticketDialog').showModal();
}

function customerRow(c) {
  return `<article class="staff-row compact-ticket">
    <div>
      <b>${c.name || '-'}</b>
      <p>${c.ic || c.phone || '-'}</p>
      <small>${customerTicketCount(c.id)} surat • Baki ${rm(customerBalance(c.id))}</small>
    </div>
    <div class="staff-row-side">
      <span class="badge active">Approved</span>
      <button class="secondary-btn mini-action" data-view-customer="${c.id}">View</button>
    </div>
  </article>`;
}

function openCustomerDialog(customerId) {
  const c = state.customers.find((x) => x.id === customerId);
  if (!c) return;
  const related = state.tickets.filter((t) => t.customer?.id === c.id);
  $('editCustomerId').value = c.id;
  $('editCustomerName').value = c.name || '';
  $('editCustomerIc').value = c.ic || '';
  $('editCustomerPhone').value = c.phone || '';
  $('editCustomerAddress').value = c.address || '';
  $('customerDialogSummary').innerHTML = `<div class="detail-hero staff-mini-hero"><h2>${c.name || '-'}</h2><p>${c.ic || '-'} • ${c.phone || '-'}</p><p><b>${rm(customerBalance(c.id))}</b> baki pembiayaan</p></div>
    <div class="meta-grid"><div>Total Surat<br><b>${related.length}</b></div><div>Status<br><b>Approved</b></div><div>Daftar<br><b>${dateMs(c.created_at)}</b></div><div>Kemaskini<br><b>${dateMs(c.updated_at)}</b></div></div>
    <section class="staff-mini-list"><b>Surat Customer</b>${related.map((t) => `<p>${t.ticketNo} — ${rm(t.remainingPrincipal || t.principal)} — ${statusLabel(t.status)}</p>`).join('') || '<p>Tiada surat.</p>'}</section>`;
  $('deleteCustomerDialogBtn').dataset.deleteCustomer = c.id;
  $('customerDialog').showModal();
}

function barRows(rows, valueFormatter = (v) => v) {
  const max = Math.max(1, ...rows.map((r) => Number(r.value || 0)));
  return rows.map((r) => {
    const pct = Math.max(4, (Number(r.value || 0) / max) * 100);
    return `<div class="bar-row"><div class="bar-meta"><span>${r.label}</span><b>${valueFormatter(r.value)}</b></div><div class="bar-track"><i style="width:${pct}%"></i></div></div>`;
  }).join('');
}

function renderOverview() {
  renderMetrics();
  const statusCounts = ['active', 'warning', 'overdue', 'redeemed'].map((s) => ({ label: statusLabel(s), value: state.tickets.filter((t) => t.status === s).length }));
  $('ticketStatusChart').innerHTML = barRows(statusCounts);

  $('valueChart').innerHTML = barRows([
    { label: 'Baki Pembiayaan', value: state.metrics.totalPrincipal || 0 },
    { label: 'Nilai Marhun', value: state.metrics.totalMarhun || 0 },
    { label: 'Customer', value: state.metrics.customers || 0 },
    { label: 'Surat Aktif', value: state.metrics.activeTickets || 0 }
  ], (v) => Number(v) > 100 ? rm(v) : v);

  const dayMap = new Map();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayMap.set(d.toISOString().slice(0, 10), { customers: 0, tickets: 0 });
  }
  state.customers.forEach((c) => { const k = String(c.created_at || '').slice(0, 10); if (dayMap.has(k)) dayMap.get(k).customers++; });
  state.tickets.forEach((t) => { const k = String(t.createdAt || '').slice(0, 10); if (dayMap.has(k)) dayMap.get(k).tickets++; });
  $('dailyChart').innerHTML = [...dayMap.entries()].map(([day, v]) => `<div class="day-bar"><span>${day.slice(5)}</span><div><b style="height:${Math.max(6, v.tickets * 18)}px" title="Surat ${v.tickets}"></b><i style="height:${Math.max(6, v.customers * 18)}px" title="Customer ${v.customers}"></i></div><small>S:${v.tickets} C:${v.customers}</small></div>`).join('');
}

function renderTickets() {
  const q = $('staffTicketSearch').value.toLowerCase();
  const f = $('staffStatusFilter').value;
  const rows = state.tickets.filter((t) => {
    const hay = `${t.ticketNo || ''} ${t.customer?.name || ''} ${t.customer?.ic || ''}`.toLowerCase();
    return hay.includes(q) && (f === 'all' || t.status === f);
  });
  $('staffTicketList').innerHTML = rows.map(ticketRow).join('') || '<p class="muted">Tiada surat jumpa.</p>';
}

function renderCustomers() {
  const q = $('staffCustomerSearch').value.toLowerCase();
  const rows = state.customers.filter((c) => `${c.name || ''} ${c.ic || ''} ${c.phone || ''}`.toLowerCase().includes(q));
  $('staffCustomerList').innerHTML = rows.map(customerRow).join('') || '<p class="muted">Tiada customer jumpa.</p>';
}

function groupByDay(rows, field) {
  const map = new Map();
  rows.forEach((r) => {
    const key = String(r[field] || '').slice(0, 10) || 'unknown';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
}

function renderReports() {
  $('customerReport').innerHTML = groupByDay(state.customers, 'created_at').map(([day, count]) => `<div class="report-line"><span>${day}</span><b>${count} customer</b></div>`).join('') || '<p class="muted">Belum ada data.</p>';
  $('ticketReport').innerHTML = groupByDay(state.tickets, 'createdAt').map(([day, count]) => `<div class="report-line"><span>${day}</span><b>${count} surat</b></div>`).join('') || '<p class="muted">Belum ada data.</p>';
  $('opsReport').innerHTML = `<div>Customer Hari Ini<br><b>${state.metrics.registrationsToday || 0}</b></div><div>Surat Hari Ini<br><b>${state.metrics.ticketsToday || 0}</b></div><div>Surat Selesai<br><b>${state.metrics.redeemedTickets || 0}</b></div><div>Baki Pembiayaan<br><b>${rm(state.metrics.totalPrincipal)}</b></div>`;
}

function renderAll() { renderOverview(); renderTickets(); renderCustomers(); renderReports(); }

let currentStaffTab = 'overview';
function openTab(tab) {
  currentStaffTab = tab;
  document.querySelectorAll('.staff-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.staff-panel').forEach((p) => p.classList.toggle('active', p.id === `staff-${tab}`));
  $('staffBackBtn').hidden = tab === 'overview';
  $('staffTitle').textContent = { overview: 'Overview', surat: 'Manage Surat', customers: 'Manage Customer', reports: 'Report' }[tab] || 'Staff Panel';
}

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) openTab(tabBtn.dataset.tab);
  const viewTicketBtn = e.target.closest('[data-view-ticket]');
  if (viewTicketBtn) openTicketDialog(viewTicketBtn.dataset.viewTicket);
  const viewCustomerBtn = e.target.closest('[data-view-customer]');
  if (viewCustomerBtn) openCustomerDialog(viewCustomerBtn.dataset.viewCustomer);
  const delTicketBtn = e.target.closest('[data-delete-ticket]');
  if (delTicketBtn) deleteTicket(delTicketBtn.dataset.deleteTicket);
  const delCustomerBtn = e.target.closest('[data-delete-customer]');
  if (delCustomerBtn) deleteCustomer(delCustomerBtn.dataset.deleteCustomer);
});

document.addEventListener('change', async (e) => {
  const ticketId = e.target.dataset.ticketStatus;
  if (!ticketId) return;
  try {
    await apiJson(`/api/tickets/${ticketId}/status`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) });
    await loadStaff();
    if ($('ticketDialog')?.open) $('ticketDialog').close();
  } catch (err) {
    alert(`Gagal update status: ${err.message}`);
  }
});

async function deleteTicket(ticketId) {
  const t = state.tickets.find((x) => x.id === ticketId);
  if (!t) return;
  const ok = confirm(`Delete surat ${t.ticketNo} — ${t.customer?.name || ''}?\n\nSemua transaksi dan item surat ini akan dibuang.`);
  if (!ok) return;
  try {
    await apiJson(`/api/tickets/${ticketId}`, { method: 'DELETE' });
    await loadStaff();
    if ($('ticketDialog')?.open) $('ticketDialog').close();
    alert('Surat berjaya delete.');
  } catch (err) {
    alert(`Gagal delete surat: ${err.message}`);
  }
}

async function deleteCustomer(customerId) {
  const c = state.customers.find((x) => x.id === customerId);
  if (!c) return;
  const count = customerTicketCount(customerId);
  const ok = confirm(`Delete customer ${c.name}?\n\n${count} surat berkaitan customer ini juga akan dibuang.`);
  if (!ok) return;
  try {
    await apiJson(`/api/customers/${customerId}`, { method: 'DELETE' });
    await loadStaff();
    if ($('customerDialog')?.open) $('customerDialog').close();
    alert('Customer berjaya delete.');
  } catch (err) {
    alert(`Gagal delete customer: ${err.message}`);
  }
}

$('customerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('editCustomerId').value;
  try {
    await apiJson(`/api/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: $('editCustomerName').value, ic: $('editCustomerIc').value, phone: $('editCustomerPhone').value, address: $('editCustomerAddress').value })
    });
    $('customerDialog').close();
    await loadStaff();
  } catch (err) {
    alert(`Gagal save customer: ${err.message}`);
  }
});

$('staffRefreshBtn').addEventListener('click', loadStaff);
$('staffBackBtn')?.addEventListener('click', () => currentStaffTab === 'overview' ? history.back() : openTab('overview'));
$('staffTicketSearch').addEventListener('input', renderTickets);
$('staffStatusFilter').addEventListener('change', renderTickets);
$('staffCustomerSearch').addEventListener('input', renderCustomers);
$('autoApproveBtn').addEventListener('click', () => alert('Auto Approve ON untuk MVP. Bila customer registration siap, staff boleh approve/reject dari panel ni.'));

loadStaff();
