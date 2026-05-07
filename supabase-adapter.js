// Supabase adapter for Ar-Rahnu Pro.
// Safe by default: if window.AR_RAHNU_SUPABASE is missing/disabled, app stays on localStorage.

const cfg = window.AR_RAHNU_SUPABASE || {};
const enabled = Boolean(cfg.enabled && cfg.url && cfg.anonKey && window.supabase?.createClient);
const client = enabled ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;

export const supabaseStore = {
  enabled,
  client,
  async getUser() {
    if (!client) return null;
    const { data } = await client.auth.getUser();
    return data?.user || null;
  },
  async loadTickets() {
    if (!client) return null;
    const user = await this.getUser();
    if (!user) return null;

    const { data: tickets, error } = await client
      .from('pawn_tickets')
      .select('*, customers(*), ticket_items(*), transactions(*)')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    return (tickets || []).map((row) => ({
      id: row.id,
      ticketNo: row.ticket_no,
      customer: {
        id: row.customers?.id || row.customer_id,
        name: row.customers?.name || '',
        ic: row.customers?.ic || '',
        phone: row.customers?.phone || ''
      },
      principal: Number(row.principal || 0),
      remainingPrincipal: Number(row.remaining_principal || 0),
      goldPrice: Number(row.gold_price || 0),
      rate: Number(row.rate || 0),
      rateMode: row.rate_mode || 'month',
      startDate: row.start_date,
      tenure: row.tenure,
      status: row.status,
      imagePath: row.image_path,
      ocrRaw: row.ocr_raw,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: (row.ticket_items || []).map((i) => ({
        id: i.id,
        description: i.description,
        weight: Number(i.weight_gram || 0),
        value: Number(i.value || 0),
        redeemed: Boolean(i.redeemed),
        redeemedAt: i.redeemed_at
      })),
      transactions: (row.transactions || []).map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount || 0),
        upahAmount: Number(tx.upah_amount || 0),
        totalPaid: Number(tx.total_paid || 0),
        cashOut: Number(tx.cash_out || 0),
        itemIds: tx.item_ids || [],
        meta: tx.meta,
        createdAt: tx.created_at
      }))
    }));
  },
  async saveTicket(ticket) {
    if (!client) return null;
    const user = await this.getUser();
    if (!user) return null;

    const customerId = ticket.customer?.id || crypto.randomUUID();
    const { error: customerError } = await client.from('customers').upsert({
      id: customerId,
      owner_id: user.id,
      name: ticket.customer?.name || '',
      ic: ticket.customer?.ic || '',
      phone: ticket.customer?.phone || '',
      updated_at: new Date().toISOString()
    });
    if (customerError) throw customerError;

    const { error: ticketError } = await client.from('pawn_tickets').upsert({
      id: ticket.id,
      owner_id: user.id,
      customer_id: customerId,
      ticket_no: ticket.ticketNo,
      principal: ticket.principal || 0,
      remaining_principal: ticket.remainingPrincipal || 0,
      gold_price: ticket.goldPrice || 0,
      rate: ticket.rate || 0,
      rate_mode: ticket.rateMode || 'month',
      start_date: ticket.startDate,
      tenure: ticket.tenure || 6,
      status: ticket.status || 'active',
      image_path: ticket.imagePath || null,
      ocr_raw: ticket.ocrRaw || null,
      updated_at: new Date().toISOString()
    });
    if (ticketError) throw ticketError;

    for (const item of ticket.items || []) {
      const { error } = await client.from('ticket_items').upsert({
        id: item.id,
        ticket_id: ticket.id,
        description: item.description || 'Item emas',
        weight_gram: item.weight || 0,
        value: item.value || 0,
        redeemed: Boolean(item.redeemed),
        redeemed_at: item.redeemedAt || null
      });
      if (error) throw error;
    }

    for (const tx of ticket.transactions || []) {
      const { error } = await client.from('transactions').upsert({
        id: tx.id || crypto.randomUUID(),
        ticket_id: ticket.id,
        type: tx.type || 'Transaction',
        amount: tx.amount || 0,
        upah_amount: tx.upahAmount || 0,
        total_paid: tx.totalPaid || 0,
        cash_out: tx.cashOut || 0,
        item_ids: tx.itemIds || [],
        meta: tx.meta || null,
        created_at: tx.createdAt || new Date().toISOString()
      });
      if (error) throw error;
    }

    return true;
  },
  async syncAll(tickets) {
    if (!client) return false;
    for (const ticket of tickets || []) await this.saveTicket(ticket);
    return true;
  }
};

window.arRahnuSupabaseStore = supabaseStore;
