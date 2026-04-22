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
          <button class="btn btn-primary btn-sm" id="autoChargeBtn" onclick="InvoicingPage.runAutoCharge()">⚡ Run Auto-Charge</button>
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
            <button class="est-tab" data-filter="scheduled">Scheduled <span class="est-tab-count">${invoices.filter(i => i.status === 'scheduled').length}</span></button>
            <button class="est-tab" data-filter="paid">Paid <span class="est-tab-count">${invoices.filter(i => i.status === 'paid').length}</span></button>
            <button class="est-tab" data-filter="failed">Failed <span class="est-tab-count">${invoices.filter(i => i.status === 'failed').length}</span></button>
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

      // Auto-filter if URL hash contains a filter hint (e.g., from dashboard failed alert)
      const hashFilter = window.location.hash.split('?filter=')[1];
      if (hashFilter) {
        const tab = main.querySelector(`.est-tab[data-filter="${hashFilter}"]`);
        if (tab) tab.click();
      }
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
