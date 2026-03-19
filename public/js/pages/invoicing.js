const InvoicingPage = {
  async render(action, id) {
    if (action === 'view' && id) return this.renderDetail(id);
    return this.renderList();
  },

  // ─── List View ───────────────────────────────────────────
  async renderList() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const [invoices, stats] = await Promise.all([
        Api.get('/api/payments/invoices'),
        Api.get('/api/payments/dashboard')
      ]);

      const today = new Date().toISOString().split('T')[0];

      main.innerHTML = `
        <div class="page-header">
          <h2>Invoicing</h2>
        </div>

        <!-- Dashboard Stats -->
        <div class="stat-grid" style="margin-bottom:16px;">
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

        ${invoices.length > 0 ? `
          <div class="est-status-tabs">
            <button class="est-tab active" data-filter="all">All <span class="est-tab-count">${invoices.length}</span></button>
            <button class="est-tab" data-filter="pending">Pending <span class="est-tab-count">${invoices.filter(i => i.status === 'pending').length}</span></button>
            <button class="est-tab" data-filter="paid">Paid <span class="est-tab-count">${invoices.filter(i => i.status === 'paid').length}</span></button>
            <button class="est-tab" data-filter="overdue">Overdue <span class="est-tab-count">${invoices.filter(i => i.status === 'pending' && i.due_date < today).length}</span></button>
          </div>
        ` : ''}

        <div id="invoicesList">
          ${invoices.length > 0 ? invoices.map(inv => this._renderInvoiceRow(inv, today)).join('') : `
            <div class="empty-state" style="padding:48px 16px;text-align:center;">
              <div style="font-size:48px;margin-bottom:12px;">\uD83D\uDCCB</div>
              <h3 style="margin-bottom:8px;">No invoices yet</h3>
              <p style="color:var(--gray-500);">Invoices are created when customers accept proposals.</p>
            </div>
          `}
        </div>
      `;

      // Filter tabs
      main.querySelectorAll('.est-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          main.querySelectorAll('.est-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const filter = tab.dataset.filter;
          main.querySelectorAll('.inv-row').forEach(row => {
            if (filter === 'all') { row.style.display = ''; return; }
            if (filter === 'overdue') {
              row.style.display = (row.dataset.status === 'pending' && row.dataset.due < today) ? '' : 'none';
            } else {
              row.style.display = row.dataset.status === filter ? '' : 'none';
            }
          });
        });
      });
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  _renderInvoiceRow(inv, today) {
    const isOverdue = inv.status === 'pending' && inv.due_date && inv.due_date < today;
    const statusConfig = {
      pending: { label: isOverdue ? 'Overdue' : 'Pending', class: isOverdue ? 'badge-red' : 'badge-orange' },
      paid: { label: 'Paid', class: 'badge-green' },
      failed: { label: 'Failed', class: 'badge-red' },
      void: { label: 'Void', class: 'badge-gray' }
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
            ${inv.status === 'paid' ? `<span>Paid ${paidStr}</span>` : `<span>Due ${dueStr}</span>`}
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
        void: { label: 'Void', class: 'badge-gray' }
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
              ${inv.status === 'paid' ? `Paid on ${paidStr}${inv.payment_method ? ' via ' + inv.payment_method : ''}` : `Due: ${dueStr}`}
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
                    <span class="badge ${ri.status === 'paid' ? 'badge-green' : 'badge-orange'}" style="font-size:11px;">${ri.status === 'paid' ? 'Paid' : ri.due_date ? new Date(ri.due_date).toLocaleDateString() : 'Pending'}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Actions -->
        <div class="est-actions" style="margin-top:16px;">
          ${inv.status === 'pending' || inv.status === 'failed' ? `
            <button class="btn btn-primary btn-full" onclick="InvoicingPage.showCheckForm(${inv.id})">
              Record Check Payment
            </button>
            <button class="btn btn-secondary btn-full" style="margin-top:8px;" onclick="InvoicingPage.sendPaymentRequest(${inv.id})" id="sendPayReqBtn">
              Send Payment Link
            </button>
            <button class="btn btn-outline btn-full" style="margin-top:8px;" onclick="InvoicingPage.voidInvoice(${inv.id})">
              Void Invoice
            </button>
          ` : ''}
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

  _esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
