const InvoicingPage = {
  async render(action, id) {
    if (action === 'view' && id) return this.renderDetail(id);
    return this.renderList();
  },

  // ─── List View ───────────────────────────────────────────
  //
  // Customer-grouped layout: one card per customer showing aggregate state,
  // collapsible to show their individual invoices. Answers "Did X pay?"
  // and "Who owes me money?" at a glance without scrolling.
  async renderList() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const [invoices, stats] = await Promise.all([
        Api.get('/api/payments/invoices'),
        Api.get('/api/payments/dashboard')
      ]);

      const today = new Date().toISOString().split('T')[0];
      this._allInvoices = invoices;
      this._today = today;
      this._currentView = this._currentView || 'attention';

      main.innerHTML = `
        <div class="page-header">
          <h2>Invoicing</h2>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-outline btn-sm" onclick="InvoicingPage.exportCSV()" title="Export CSV for reporting">⬇ CSV</button>
            <button class="btn btn-primary btn-sm" id="autoChargeBtn" onclick="InvoicingPage.runAutoCharge()">⚡ Auto-Charge</button>
          </div>
        </div>

        <!-- Stats -->
        <div class="stat-grid" style="margin-bottom:12px;">
          <div class="stat-card" style="border-top:3px solid var(--green);">
            <div class="stat-value" style="color:var(--green);">$${(stats.total_collected_month_cents / 100).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</div>
            <div class="stat-label">Collected This Month</div>
          </div>
          <div class="stat-card" style="border-top:3px solid var(--navy);">
            <div class="stat-value" style="color:var(--navy);">$${(stats.total_outstanding_cents / 100).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</div>
            <div class="stat-label">Outstanding</div>
          </div>
          <div class="stat-card" style="border-top:3px solid ${stats.overdue_count > 0 ? 'var(--red)' : 'var(--gray-300)'};">
            <div class="stat-value" style="color:${stats.overdue_count > 0 ? 'var(--red)' : 'var(--gray-500)'};">${stats.overdue_count}</div>
            <div class="stat-label">Overdue</div>
          </div>
          <div class="stat-card" style="border-top:3px solid #6366f1;">
            <div class="stat-value" style="color:#6366f1;">$${(stats.total_collected_year_cents / 100).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</div>
            <div class="stat-label">Collected This Year</div>
          </div>
        </div>

        <!-- Search bar -->
        <div style="margin-bottom:10px;">
          <input type="text" id="invSearch" placeholder="Search customer, invoice #, or amount..."
                 style="width:100%;padding:10px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;">
        </div>

        <!-- View tabs -->
        <div class="est-status-tabs">
          <button class="est-tab ${this._currentView === 'attention' ? 'active' : ''}" data-view="attention">
            Needs Attention <span class="est-tab-count" id="countAttention">0</span>
          </button>
          <button class="est-tab ${this._currentView === 'upcoming' ? 'active' : ''}" data-view="upcoming">
            Upcoming <span class="est-tab-count" id="countUpcoming">0</span>
          </button>
          <button class="est-tab ${this._currentView === 'history' ? 'active' : ''}" data-view="history">
            History <span class="est-tab-count" id="countHistory">0</span>
          </button>
          <button class="est-tab ${this._currentView === 'all' ? 'active' : ''}" data-view="all">
            All <span class="est-tab-count" id="countAll">${invoices.length}</span>
          </button>
        </div>

        <div id="invoicesList">${this._renderCustomerGroups(invoices, '')}</div>
      `;

      // Wire tabs
      main.querySelectorAll('.est-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          this._currentView = tab.dataset.view;
          main.querySelectorAll('.est-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this._refreshInvoiceList();
        });
      });

      // Wire search
      let searchTimer;
      const searchEl = document.getElementById('invSearch');
      searchEl.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => this._refreshInvoiceList(), 120);
      });

      this._refreshInvoiceList();

      // Auto-filter hint from dashboard link
      const hashFilter = window.location.hash.split('?filter=')[1];
      if (hashFilter === 'failed') {
        this._currentView = 'attention';
        this._refreshInvoiceList();
      }
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  // Apply the current view + search, then re-render the customer groups
  // and update the tab counts.
  _refreshInvoiceList() {
    const query = (document.getElementById('invSearch')?.value || '').toLowerCase().trim();
    const invoices = this._allInvoices || [];
    const today = this._today;
    const in30 = new Date(); in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().slice(0, 10);

    // Count each view (so the tab numbers are always accurate)
    let cAttention = 0, cUpcoming = 0, cHistory = 0;
    for (const i of invoices) {
      const overdue = (i.status === 'pending' || i.status === 'failed') &&
                      i.due_date && i.due_date < today;
      if (i.status === 'failed' || overdue) cAttention++;
      else if (i.status === 'scheduled' || (i.status === 'pending' && i.due_date && i.due_date <= in30Str)) cUpcoming++;
      else if (i.status === 'paid' || i.status === 'void') cHistory++;
    }
    const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    setCount('countAttention', cAttention);
    setCount('countUpcoming', cUpcoming);
    setCount('countHistory', cHistory);
    setCount('countAll', invoices.length);

    // Filter to current view
    const view = this._currentView;
    let filtered = invoices.filter(i => {
      if (view === 'all') return true;
      const overdue = (i.status === 'pending' || i.status === 'failed') &&
                      i.due_date && i.due_date < today;
      if (view === 'attention') return i.status === 'failed' || overdue;
      if (view === 'upcoming') {
        return i.status === 'scheduled' ||
               (i.status === 'pending' && i.due_date && i.due_date <= in30Str);
      }
      if (view === 'history') return i.status === 'paid' || i.status === 'void';
      return true;
    });

    // Apply search
    if (query) {
      filtered = filtered.filter(i => {
        const amount = ((i.amount_cents || 0) / 100).toFixed(2);
        return (i.customer_name || '').toLowerCase().includes(query) ||
               (i.invoice_number || '').toLowerCase().includes(query) ||
               amount.includes(query) ||
               (i.payment_method || '').toLowerCase().includes(query);
      });
    }

    const list = document.getElementById('invoicesList');
    if (list) list.innerHTML = this._renderCustomerGroups(filtered, query);
  },

  // Group invoices by customer_name and render one collapsible card per group.
  // Sort: customers with outstanding balance first (highest $ first), then
  // all-paid customers alphabetical.
  _renderCustomerGroups(invoices, query) {
    const today = this._today;
    if (invoices.length === 0) {
      return `
        <div class="empty-state" style="padding:40px 16px;text-align:center;">
          <div style="font-size:40px;margin-bottom:10px;">\uD83D\uDCCB</div>
          <h3 style="margin-bottom:6px;">${query ? 'No matches' : 'Nothing here'}</h3>
          <p style="color:var(--gray-500);font-size:14px;">${query ? 'Try a different search.' : 'No invoices match this view.'}</p>
        </div>
      `;
    }

    // Group by customer name (fall back to invoice.estimate_id if no name)
    const groups = new Map();
    for (const inv of invoices) {
      const key = inv.customer_name || ('Estimate #' + inv.estimate_id);
      if (!groups.has(key)) {
        groups.set(key, { name: key, address: inv.address, invoices: [] });
      }
      groups.get(key).invoices.push(inv);
    }

    // Compute per-customer aggregates
    const rows = [];
    for (const g of groups.values()) {
      let outstandingCents = 0, paidCents = 0, overdueCount = 0;
      let unpaidCount = 0, totalCount = g.invoices.length;
      for (const i of g.invoices) {
        const amt = i.amount_cents || 0;
        if (i.status === 'paid') paidCents += amt;
        else if (i.status !== 'void') {
          outstandingCents += amt;
          unpaidCount++;
          if ((i.status === 'pending' || i.status === 'failed') &&
              i.due_date && i.due_date < today) overdueCount++;
        }
      }
      rows.push({ ...g, outstandingCents, paidCents, overdueCount, unpaidCount, totalCount });
    }

    // Sort: outstanding > 0 first (biggest first), then alphabetical
    rows.sort((a, b) => {
      if (a.outstandingCents !== b.outstandingCents) {
        return b.outstandingCents - a.outstandingCents;
      }
      return a.name.localeCompare(b.name);
    });

    // Auto-expand if there's only one group (i.e., search narrowed to one customer)
    const autoExpand = rows.length === 1 || query;

    return rows.map(r => this._renderCustomerGroup(r, autoExpand)).join('');
  },

  _renderCustomerGroup(group, expanded) {
    const today = this._today;
    const outstanding = (group.outstandingCents / 100).toFixed(2);
    const paid = (group.paidCents / 100).toFixed(2);
    const statusLine = group.outstandingCents > 0
      ? `<span style="color:${group.overdueCount > 0 ? 'var(--red)' : 'var(--orange)'};font-weight:600;">$${outstanding} unpaid</span>` +
        (group.overdueCount > 0 ? ` &middot; <span style="color:var(--red);">${group.overdueCount} overdue</span>` : '') +
        (group.paidCents > 0 ? ` &middot; <span style="color:var(--gray-500);">paid $${paid}</span>` : '')
      : `<span style="color:var(--green-dark,#2d6a1e);font-weight:600;">All paid</span>` +
        (group.paidCents > 0 ? ` &middot; $${paid} collected` : '');

    const borderColor = group.overdueCount > 0 ? 'var(--red)' :
                        group.outstandingCents > 0 ? 'var(--orange)' :
                        'var(--green)';

    const rowsHtml = group.invoices
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '') || (a.id - b.id))
      .map(inv => this._renderInvoiceRow(inv, today))
      .join('');

    const gid = 'grp-' + (group.name || 'x').replace(/[^a-z0-9]/gi, '_');

    return `
      <div class="inv-customer-group" style="border:1px solid var(--gray-200);border-left:4px solid ${borderColor};border-radius:10px;margin-bottom:10px;background:white;">
        <div class="inv-group-header" onclick="InvoicingPage._toggleGroup('${gid}')"
             style="padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="min-width:0;flex:1;">
            <div style="font-weight:700;font-size:15px;color:var(--navy, var(--blue));">${this._esc(group.name)}</div>
            <div style="font-size:12px;margin-top:2px;">${statusLine} &middot; <span style="color:var(--gray-500);">${group.totalCount} invoice${group.totalCount === 1 ? '' : 's'}</span></div>
          </div>
          <span class="inv-group-caret" id="${gid}-caret" style="font-size:14px;color:var(--gray-400);flex-shrink:0;">${expanded ? '▾' : '▸'}</span>
        </div>
        <div class="inv-group-body" id="${gid}-body" style="${expanded ? '' : 'display:none;'}border-top:1px solid var(--gray-100);">
          ${rowsHtml}
        </div>
      </div>
    `;
  },

  _toggleGroup(gid) {
    const body = document.getElementById(gid + '-body');
    const caret = document.getElementById(gid + '-caret');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (caret) caret.textContent = open ? '▸' : '▾';
  },

  // Export all currently-visible invoices to CSV — useful for franchise
  // controller reporting. Respects the active view + search filter.
  exportCSV() {
    const query = (document.getElementById('invSearch')?.value || '').toLowerCase().trim();
    const today = this._today;
    const in30 = new Date(); in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().slice(0, 10);
    const view = this._currentView || 'all';
    const invoices = (this._allInvoices || []).filter(i => {
      if (view === 'attention') {
        const overdue = (i.status === 'pending' || i.status === 'failed') && i.due_date && i.due_date < today;
        if (!(i.status === 'failed' || overdue)) return false;
      } else if (view === 'upcoming') {
        if (!(i.status === 'scheduled' || (i.status === 'pending' && i.due_date && i.due_date <= in30Str))) return false;
      } else if (view === 'history') {
        if (!(i.status === 'paid' || i.status === 'void')) return false;
      }
      if (query) {
        const amount = ((i.amount_cents || 0) / 100).toFixed(2);
        const hay = (i.customer_name + ' ' + i.invoice_number + ' ' + amount + ' ' + (i.payment_method || '')).toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const headers = [
      'Invoice Number', 'Customer', 'Address', 'Amount',
      'Status', 'Payment Plan', 'Installment',
      'Due Date', 'Paid Date', 'Payment Method', 'Check Number', 'Notes'
    ];
    const rows = invoices.map(i => [
      i.invoice_number || '',
      i.customer_name || '',
      (i.address || '') + (i.city ? ', ' + i.city : ''),
      ((i.amount_cents || 0) / 100).toFixed(2),
      i.status || '',
      i.payment_plan || '',
      i.total_installments ? `${i.installment_number}/${i.total_installments}` : '',
      i.due_date || '',
      i.paid_at ? i.paid_at.slice(0, 10) : '',
      i.payment_method || '',
      i.check_number || '',
      (i.notes || '').replace(/\r?\n/g, ' ')
    ]);

    const csvLine = arr => arr.map(v => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');

    const csv = [csvLine(headers)].concat(rows.map(csvLine)).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoices-${view}-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    App.toast(`Exported ${rows.length} invoice${rows.length === 1 ? '' : 's'}`, 'success');
  },

  _renderInvoiceRow(inv, today) {
    const isOverdue = inv.status === 'pending' && inv.due_date && inv.due_date < today;
    const statusConfig = {
      pending: { label: isOverdue ? 'Overdue' : 'Pending', class: isOverdue ? 'badge-red' : 'badge-orange' },
      paid: { label: 'Paid', class: 'badge-green' },
      failed: { label: 'Failed', class: 'badge-red' },
      void: { label: 'Void', class: 'badge-gray' },
      scheduled: { label: 'Scheduled', class: 'badge-muted' }
    };
    const s = statusConfig[inv.status] || statusConfig.pending;
    const amount = (inv.amount_cents / 100).toFixed(2);
    const dueStr = inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '';
    const paidStr = inv.paid_at ? new Date(inv.paid_at).toLocaleDateString() : '';
    const installment = inv.total_installments ? ` (${inv.installment_number}/${inv.total_installments})` : '';

    return `
      <div class="est-list-card inv-row" data-status="${inv.status}" data-due="${inv.due_date || ''}"
           onclick="App.navigate('invoicing', 'view', ${inv.id})" style="cursor:pointer;">
        <div class="est-list-card-top">
          <div class="est-list-card-customer">
            <h4 style="font-family:monospace;font-size:14px;letter-spacing:0.5px;">${this._esc(inv.invoice_number)}</h4>
            <p>${this._esc(inv.customer_name)}${installment}</p>
          </div>
          <span class="badge ${s.class}">${s.label}</span>
        </div>
        <div class="est-list-card-bottom">
          <div class="est-list-card-price">
            <span class="est-monthly">$${amount}</span>
          </div>
          <div class="est-list-card-meta">
            ${inv.payment_method ? `<span style="text-transform:capitalize;">${inv.payment_method}</span>` : ''}
            ${inv.status === 'paid' ? `<span>Paid ${paidStr}</span>` : inv.status === 'scheduled' ? `<span style="color:var(--gray-400);font-style:italic;">Activates when service begins</span>` : `<span>Due ${dueStr}</span>`}
          </div>
        </div>
      </div>
    `;
  },

  // ─── Detail View ─────────────────────────────────────────
  async renderDetail(id) {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const inv = await Api.get(`/api/payments/invoices/${id}`);
      const amount = (inv.amount_cents / 100).toFixed(2);
      const dueStr = inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A';
      const paidStr = inv.paid_at ? new Date(inv.paid_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';

      const statusConfig = {
        pending: { label: 'Pending', class: 'badge-orange' },
        paid: { label: 'Paid', class: 'badge-green' },
        failed: { label: 'Failed', class: 'badge-red' },
        void: { label: 'Void', class: 'badge-gray' },
        scheduled: { label: 'Scheduled', class: 'badge-muted' }
      };
      const s = statusConfig[inv.status] || statusConfig.pending;

      main.innerHTML = `
        <div class="page-header" style="margin-bottom:8px;">
          <button class="btn btn-sm btn-outline" onclick="App.navigate('invoicing')">← Back</button>
          <span class="badge ${s.class}" style="font-size:13px;padding:6px 14px;">${s.label}</span>
        </div>

        <div class="card" style="margin-bottom:12px;">
          <div class="card-body" style="text-align:center;padding:24px;">
            <div style="font-family:monospace;font-size:18px;font-weight:700;letter-spacing:1px;color:var(--navy);margin-bottom:4px;">${this._esc(inv.invoice_number)}</div>
            <div style="font-size:36px;font-weight:800;color:var(--green-dark);margin:8px 0;">$${amount}</div>
            <div style="font-size:14px;color:var(--gray-500);">
              ${inv.status === 'paid' ? `Paid on ${paidStr}${inv.payment_method ? ' via ' + inv.payment_method : ''}` : inv.status === 'scheduled' ? 'Activates when service begins' : `Due: ${dueStr}`}
            </div>
            ${inv.check_number ? `<div style="font-size:13px;color:var(--gray-400);margin-top:4px;">Check #${this._esc(inv.check_number)}</div>` : ''}
          </div>
        </div>

        <!-- Customer & Estimate Info -->
        <div class="card" style="margin-bottom:12px;">
          <div class="card-header"><h3>Details</h3></div>
          <div class="card-body">
            <div class="data-row">
              <div class="data-row-main">
                <h4>${this._esc(inv.customer_name)}</h4>
                <p>${this._esc(inv.address || '')}${inv.city ? ', ' + this._esc(inv.city) : ''}</p>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;font-size:13px;">
              <div><span style="color:var(--gray-400);">Plan</span><br><strong style="text-transform:capitalize;">${inv.payment_plan === 'per_service' ? 'Per Service' : inv.payment_plan}</strong></div>
              ${inv.total_installments ? `<div><span style="color:var(--gray-400);">Installment</span><br><strong>${inv.installment_number} of ${inv.total_installments}</strong></div>` : ''}
              ${inv.customer_email ? `<div><span style="color:var(--gray-400);">Email</span><br><strong>${this._esc(inv.customer_email)}</strong></div>` : ''}
              ${inv.stripe_payment_intent_id ? `<div><span style="color:var(--gray-400);">Stripe</span><br><strong style="font-family:monospace;font-size:11px;">${this._esc(inv.stripe_payment_intent_id.substring(0, 20))}...</strong></div>` : ''}
            </div>
          </div>
        </div>

        ${inv.related_invoices && inv.related_invoices.length > 1 ? `
          <div class="card" style="margin-bottom:12px;">
            <div class="card-header"><h3>Payment Schedule</h3></div>
            <div class="card-body" style="padding:0;">
              ${inv.related_invoices.map(ri => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--gray-100);${ri.id === inv.id ? 'background:#f0fdf4;' : ''}">
                  <div>
                    <span style="font-family:monospace;font-size:12px;">${this._esc(ri.invoice_number)}</span>
                    ${ri.installment_number ? `<span style="color:var(--gray-400);font-size:12px;"> #${ri.installment_number}</span>` : ''}
                  </div>
                  <div style="display:flex;align-items:center;gap:12px;">
                    <span style="font-size:13px;">$${(ri.amount_cents / 100).toFixed(2)}</span>
                    <span class="badge ${ri.status === 'paid' ? 'badge-green' : ri.status === 'scheduled' ? 'badge-muted' : ri.status === 'failed' ? 'badge-red' : 'badge-orange'}" style="font-size:11px;">${ri.status === 'paid' ? 'Paid' : ri.status === 'scheduled' ? 'Scheduled' : ri.due_date ? new Date(ri.due_date).toLocaleDateString() : 'Pending'}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Actions -->
        <div class="est-actions" style="margin-top:16px;">
          ${inv.status === 'pending' || inv.status === 'failed' ? `
            ${inv.stripe_customer_id ? `
              <button class="btn btn-primary btn-full" onclick="InvoicingPage.chargeInvoice(${inv.id})" id="chargeNowBtn">
                💳 Charge Card Now — $${amount}
              </button>
            ` : ''}
            <button class="btn btn-${inv.stripe_customer_id ? 'secondary' : 'primary'} btn-full" style="margin-top:8px;" onclick="InvoicingPage.showCheckForm(${inv.id})">
              Record Check Payment
            </button>
            <button class="btn btn-secondary btn-full" style="margin-top:8px;" onclick="InvoicingPage.sendPaymentRequest(${inv.id})" id="sendPayReqBtn">
              Send Payment Link
            </button>
            <button class="btn btn-outline btn-full" style="margin-top:8px;" onclick="InvoicingPage.voidInvoice(${inv.id})">
              Void Invoice
            </button>
          ` : ''}
          <button class="btn btn-outline btn-full" style="margin-top:8px;" onclick="InvoicingPage.editInvoice(${inv.id})">
            ✎ Edit Invoice
          </button>
          <a href="#estimates/view/${inv.estimate_id || ''}" class="btn btn-outline btn-full" style="margin-top:8px;display:block;text-align:center;text-decoration:none;">
            View Estimate
          </a>
        </div>

        <!-- Check Payment Form (hidden by default) -->
        <div id="checkForm" style="display:none;margin-top:12px;">
          <div class="card" style="border:2px solid var(--green);">
            <div class="card-header"><h3>Record Check Payment</h3></div>
            <div class="card-body">
              <div class="form-group">
                <label>Check Number</label>
                <input type="text" id="checkNumber" class="est-input" placeholder="e.g., 1847">
              </div>
              <div class="form-group">
                <label>Check Date</label>
                <input type="date" id="checkDate" class="est-input" value="${new Date().toISOString().split('T')[0]}">
              </div>
              <div class="form-group">
                <label>Notes (optional)</label>
                <input type="text" id="checkNotes" class="est-input" placeholder="e.g., deposited 3/18">
              </div>
              <button class="btn btn-primary btn-full" onclick="InvoicingPage.recordCheck(${inv.id})" id="recordCheckBtn">
                Record Payment of $${amount}
              </button>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  showCheckForm(id) {
    const form = document.getElementById('checkForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (form.style.display === 'block') {
      document.getElementById('checkNumber').focus();
    }
  },

  async recordCheck(id) {
    const btn = document.getElementById('recordCheckBtn');
    btn.disabled = true;
    btn.textContent = 'Recording...';

    try {
      await Api.post(`/api/payments/invoices/${id}/record-check`, {
        check_number: document.getElementById('checkNumber').value,
        check_date: document.getElementById('checkDate').value,
        notes: document.getElementById('checkNotes').value
      });
      App.toast('Check payment recorded!', 'success');
      this.renderDetail(id);
    } catch (err) {
      App.toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Record Payment';
    }
  },

  async sendPaymentRequest(id) {
    const btn = document.getElementById('sendPayReqBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
      const result = await Api.post(`/api/payments/invoices/${id}/send-payment-request`);
      App.toast(result.message || 'Payment request sent!', 'success');
    } catch (err) {
      App.toast(err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Send Payment Link';
  },

  async chargeInvoice(id) {
    if (!confirm('Charge this invoice to the card on file?')) return;
    const btn = document.getElementById('chargeNowBtn');
    btn.disabled = true;
    btn.textContent = 'Charging...';

    try {
      const result = await Api.post(`/api/payments/invoices/${id}/charge`);
      App.toast('Payment successful! ' + (result.invoice_number || ''), 'success');
      this.renderDetail(id);
    } catch (err) {
      App.toast(err.message || 'Charge failed', 'error');
      btn.disabled = false;
      btn.textContent = '💳 Retry Charge';
    }
  },

  async runAutoCharge() {
    if (!confirm('Run auto-charge on all due invoices now?')) return;
    const btn = document.getElementById('autoChargeBtn');
    btn.disabled = true;
    btn.textContent = 'Processing...';

    try {
      const result = await Api.post('/api/payments/process-due-invoices');
      const msg = `Charged: ${result.charged || 0}, Failed: ${result.failed || 0}, No card: ${result.no_method || 0}, Skipped: ${result.skipped || 0}`;
      App.toast(msg, result.failed > 0 ? 'error' : 'success');
      this.renderList();
    } catch (err) {
      App.toast(err.message || 'Auto-charge failed', 'error');
      btn.disabled = false;
      btn.textContent = '⚡ Run Auto-Charge';
    }
  },

  async voidInvoice(id) {
    if (!confirm('Void this invoice? This cannot be undone.')) return;
    try {
      await Api.post(`/api/payments/invoices/${id}/void`);
      App.toast('Invoice voided', 'success');
      this.renderDetail(id);
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  // Open an edit modal for any invoice field: amount, due date, status,
  // payment method, check #, notes. Used for one-off corrections
  // (e.g. customer paid a different amount than billed, or status needs
  // to be manually flipped without going through Stripe).
  async editInvoice(id) {
    let inv;
    try {
      inv = await Api.get(`/api/payments/invoices/${id}`);
    } catch (err) {
      return App.toast('Could not load invoice: ' + err.message, 'error');
    }

    document.querySelector('.modal-overlay.inv-edit-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay inv-edit-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Edit Invoice ${this._esc(inv.invoice_number)}</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Amount ($)</label>
            <input type="number" step="0.01" min="0" id="invEditAmount" value="${(inv.amount_cents / 100).toFixed(2)}">
          </div>
          <div class="form-group">
            <label>Status</label>
            <select id="invEditStatus">
              <option value="scheduled" ${inv.status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
              <option value="pending" ${inv.status === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="paid" ${inv.status === 'paid' ? 'selected' : ''}>Paid</option>
              <option value="failed" ${inv.status === 'failed' ? 'selected' : ''}>Failed</option>
              <option value="void" ${inv.status === 'void' ? 'selected' : ''}>Void</option>
            </select>
          </div>
          <div class="form-group">
            <label>Due date</label>
            <input type="date" id="invEditDueDate" value="${inv.due_date || ''}">
          </div>
          <div class="form-group">
            <label>Payment method</label>
            <select id="invEditMethod">
              <option value="">— not set —</option>
              <option value="card" ${inv.payment_method === 'card' ? 'selected' : ''}>Card</option>
              <option value="check" ${inv.payment_method === 'check' ? 'selected' : ''}>Check</option>
              <option value="ach" ${inv.payment_method === 'ach' ? 'selected' : ''}>ACH</option>
              <option value="cash" ${inv.payment_method === 'cash' ? 'selected' : ''}>Cash</option>
            </select>
          </div>
          <div class="form-group">
            <label>Check number (if applicable)</label>
            <input type="text" id="invEditCheckNumber" value="${this._esc(inv.check_number || '')}">
          </div>
          <div class="form-group">
            <label>Paid date (if marking paid)</label>
            <input type="date" id="invEditPaidAt" value="${inv.paid_at ? inv.paid_at.slice(0,10) : ''}">
          </div>
          <div class="form-group">
            <label>Notes</label>
            <textarea id="invEditNotes" rows="2">${this._esc(inv.notes || '')}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-danger btn-sm" onclick="InvoicingPage._deleteInvoice(${inv.id})">Delete</button>
          <button class="btn btn-outline" style="margin-left:auto;" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="InvoicingPage._saveInvoiceEdit(${inv.id})">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  },

  async _saveInvoiceEdit(id) {
    const body = {
      amount_cents: Math.round((parseFloat(document.getElementById('invEditAmount').value) || 0) * 100),
      status: document.getElementById('invEditStatus').value,
      due_date: document.getElementById('invEditDueDate').value || null,
      payment_method: document.getElementById('invEditMethod').value || null,
      check_number: document.getElementById('invEditCheckNumber').value.trim() || null,
      paid_at: document.getElementById('invEditPaidAt').value || null,
      notes: document.getElementById('invEditNotes').value.trim() || null
    };
    try {
      await Api.put('/api/payments/invoices/' + id, body);
      App.toast('Invoice updated', 'success');
      document.querySelector('.modal-overlay.inv-edit-modal')?.remove();
      this.renderDetail(id);
    } catch (err) {
      App.toast('Save failed: ' + err.message, 'error');
    }
  },

  async _deleteInvoice(id) {
    if (!confirm('Delete this invoice permanently? This cannot be undone. If the customer paid, use Void instead.')) return;
    try {
      await Api.delete('/api/payments/invoices/' + id);
      App.toast('Invoice deleted', 'success');
      document.querySelector('.modal-overlay.inv-edit-modal')?.remove();
      App.navigate('invoicing');
    } catch (err) {
      App.toast('Delete failed: ' + err.message, 'error');
    }
  },

  _esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
