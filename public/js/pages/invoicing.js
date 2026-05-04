const InvoicingPage = {
  // ─── SMS Helper ─────────────────────────────────────────
  // Reliably open the native SMS app on iOS and Android.
  // iOS uses sms:NUMBER&body=  Android uses sms:NUMBER?body=
  // Mirrors EstimatesPage._openSMS — keep them in sync.
  _openSMS(phone, message) {
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const sep = isIOS ? '&' : '?';
    const smsUrl = `sms:${phone}${sep}body=${encodeURIComponent(message)}`;
    const a = document.createElement('a');
    a.href = smsUrl;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 100);
  },

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
      this._currentView = this._currentView || 'first';

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
          <button class="est-tab ${this._currentView === 'first' ? 'active' : ''}" data-view="first" title="First invoice from every estimate — the migration kickoff queue">
            🚀 First Round <span class="est-tab-count" id="countFirst">0</span>
          </button>
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

        <!-- Method + cadence filter chips (stack on top of view + search) -->
        <div class="inv-chips" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;font-size:12px;">
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
            <span style="color:var(--gray-500);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-right:4px;">Method</span>
            ${['all','card','check','ach','cash'].map(m => `
              <button class="inv-chip inv-chip-method" data-method="${m}" style="padding:4px 10px;border-radius:14px;border:1px solid var(--gray-200);background:${(this._methodFilter || 'all') === m ? 'var(--green)' : 'white'};color:${(this._methodFilter || 'all') === m ? 'white' : 'var(--gray-700)'};font-weight:600;font-size:12px;cursor:pointer;">${m === 'all' ? 'All' : m.toUpperCase()}</button>
            `).join('')}
          </div>
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
            <span style="color:var(--gray-500);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-right:4px;">Cadence</span>
            ${[
              { key: 'all', label: 'All' },
              { key: 'monthly', label: 'Monthly' },
              { key: 'per_service', label: 'Per Service' },
              { key: 'full', label: 'Pay in Full' }
            ].map(c => `
              <button class="inv-chip inv-chip-cadence" data-cadence="${c.key}" style="padding:4px 10px;border-radius:14px;border:1px solid var(--gray-200);background:${(this._cadenceFilter || 'all') === c.key ? 'var(--blue,#1d428a)' : 'white'};color:${(this._cadenceFilter || 'all') === c.key ? 'white' : 'var(--gray-700)'};font-weight:600;font-size:12px;cursor:pointer;">${c.label}</button>
            `).join('')}
          </div>
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

      // Wire method + cadence filter chips (single-select per group)
      main.querySelectorAll('.inv-chip-method').forEach(chip => {
        chip.addEventListener('click', () => {
          this._methodFilter = chip.dataset.method;
          this.renderList(); // full re-render so chip colors update
        });
      });
      main.querySelectorAll('.inv-chip-cadence').forEach(chip => {
        chip.addEventListener('click', () => {
          this._cadenceFilter = chip.dataset.cadence;
          this.renderList();
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
    let cAttention = 0, cUpcoming = 0, cHistory = 0, cFirst = 0;
    for (const i of invoices) {
      const overdue = (i.status === 'pending' || i.status === 'failed') &&
                      i.due_date && i.due_date < today;
      if (i.status === 'failed' || overdue) cAttention++;
      else if (i.status === 'scheduled' || (i.status === 'pending' && i.due_date && i.due_date <= in30Str)) cUpcoming++;
      else if (i.status === 'paid' || i.status === 'void') cHistory++;
      // "First round": installment #1 of any monthly plan, OR a single-payment
      // (full / per-service) invoice — and not yet paid/void. These are the
      // actionable migration items.
      if (this._isFirstRound(i) && i.status !== 'paid' && i.status !== 'void') cFirst++;
    }
    const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    setCount('countAttention', cAttention);
    setCount('countUpcoming', cUpcoming);
    setCount('countHistory', cHistory);
    setCount('countFirst', cFirst);
    setCount('countAll', invoices.length);

    // Filter to current view
    const view = this._currentView;
    let filtered = invoices.filter(i => {
      if (view === 'all') return true;
      // First Round = the kickoff queue. Show ONLY unpaid first invoices —
      // paid ones don't need attention so they belong in History.
      if (view === 'first') {
        return this._isFirstRound(i) &&
               i.status !== 'paid' && i.status !== 'void';
      }
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

    // Apply method + cadence chip filters.
    // For method: use invoice.payment_method if paid, else fall back to the
    // estimate's preferred_method (the intended method at setup). Without
    // the fallback, every unpaid invoice would match nothing since
    // payment_method is NULL until a payment is recorded.
    const methodFilter = this._methodFilter || 'all';
    const cadenceFilter = this._cadenceFilter || 'all';
    if (methodFilter !== 'all') {
      filtered = filtered.filter(i => {
        const m = i.payment_method || i.preferred_method || '';
        return m === methodFilter;
      });
    }
    if (cadenceFilter !== 'all') {
      filtered = filtered.filter(i => (i.payment_plan || '') === cadenceFilter);
    }

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
    if (list) {
      list.innerHTML = view === 'first'
        ? this._renderFirstRound(filtered, query)
        : this._renderCustomerGroups(filtered, query);
    }
  },

  // True for invoice #1 of a monthly plan, OR any single-installment invoice
  // (pay-in-full, per-service one-shot). These are the "kick off the migration"
  // items the user wants to see all in one place.
  _isFirstRound(i) {
    const inst = i.installment_number;
    const total = i.total_installments;
    if (inst === 1) return true;
    if ((inst == null || inst === 0) && (total == null || total <= 1)) return true;
    return false;
  },

  // Flat actionable list: one row per first-round invoice, sorted by what
  // needs your attention first (unsent/unpaid up top, paid at the bottom).
  // Each row has inline action buttons so you can rip through the queue
  // without bouncing into detail pages.
  _renderFirstRound(invoices, query) {
    if (invoices.length === 0) {
      return `
        <div class="empty-state" style="padding:40px 16px;text-align:center;">
          <div style="font-size:40px;margin-bottom:10px;">🎉</div>
          <h3 style="margin-bottom:6px;">${query ? 'No matches' : 'Queue is clear'}</h3>
          <p style="color:var(--gray-500);font-size:14px;">${query ? 'No unpaid first invoices match your search.' : 'Every customer\'s first invoice has been paid. Switch to All to see history.'}</p>
        </div>
      `;
    }

    const today = this._today;

    // Bucket by action priority. Paid/void are filtered out upstream.
    //   1. unsent  — never had an SMS sent AND no checkout session created
    //   2. sent    — SMS has been sent OR Stripe checkout session created
    //                (link's gone out, waiting on the customer to act)
    //   3. failed  — charge failed
    // Within each bucket: amount desc so the biggest moves rise.
    const bucket = (i) => {
      if (i.status === 'failed') return 3;
      if (i.sms_sent_at || i.stripe_checkout_session_id) return 2;
      return 1;
    };
    const sorted = [...invoices].sort((a, b) => {
      const ba = bucket(a), bb = bucket(b);
      if (ba !== bb) return ba - bb;
      return (b.amount_cents || 0) - (a.amount_cents || 0);
    });

    // Summary strip — only unpaid buckets, since the list is unpaid-only
    const counts = { unsent: 0, sent: 0, failed: 0 };
    let outstandingCents = 0;
    for (const i of invoices) {
      const b = bucket(i);
      if (b === 1) counts.unsent++;
      else if (b === 2) counts.sent++;
      else if (b === 3) counts.failed++;
      outstandingCents += i.amount_cents || 0;
    }

    const summaryHtml = `
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;font-size:13px;">
        <span style="background:#fff3cd;color:#856404;padding:6px 12px;border-radius:14px;font-weight:600;">${counts.unsent} unsent</span>
        <span style="background:#cfe2ff;color:#084298;padding:6px 12px;border-radius:14px;font-weight:600;">${counts.sent} link sent</span>
        ${counts.failed > 0 ? `<span style="background:#f8d7da;color:#842029;padding:6px 12px;border-radius:14px;font-weight:600;">${counts.failed} failed</span>` : ''}
        <span style="margin-left:auto;color:var(--gray-700);align-self:center;font-weight:600;">$${(outstandingCents/100).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})} to collect</span>
      </div>
    `;

    const rowsHtml = sorted.map(i => this._renderFirstRoundRow(i, today)).join('');

    return summaryHtml + `<div class="first-round-list">${rowsHtml}</div>`;
  },

  _renderFirstRoundRow(inv, today) {
    const amount = (inv.amount_cents / 100).toFixed(2);
    const dueStr = inv.due_date ? new Date(inv.due_date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    const method = (inv.payment_method || inv.preferred_method || '').toLowerCase();
    const isCheck = method === 'check';
    const isOverdue = (inv.status === 'pending' || inv.status === 'failed') && inv.due_date && inv.due_date < today;

    // Action button — what's the ONE thing they should do for this row right now?
    // After an SMS has been sent, the button changes to "Resend" so it's
    // visually clear (and lower-priority) without removing the option.
    const alreadySent = !!(inv.sms_sent_at || inv.stripe_checkout_session_id);
    let actionBtn = '';
    if (inv.status === 'paid') {
      actionBtn = `<span style="color:var(--green-dark,#0f5132);font-weight:600;font-size:12px;">✓ Paid</span>`;
    } else if (inv.status === 'void') {
      actionBtn = `<span style="color:var(--gray-400);font-size:12px;">Void</span>`;
    } else if (isCheck) {
      // Check client → SMS the invoice link
      const label = alreadySent ? '↻ Resend' : '📱 Send';
      const cls = alreadySent ? 'btn-outline' : 'btn-primary';
      actionBtn = `<button class="btn ${cls} btn-sm" onclick="event.stopPropagation();InvoicingPage.sendInvoice(${inv.id})" style="white-space:nowrap;">${label}</button>`;
    } else if (inv.stripe_customer_id) {
      // Card on file → charge directly (no SMS needed)
      actionBtn = `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();InvoicingPage.chargeInvoice(${inv.id})" style="white-space:nowrap;">💳 Charge</button>`;
    } else {
      // Stripe-preferred but no card yet → send checkout link
      const label = alreadySent ? '↻ Resend Link' : '📱 Send Link';
      const cls = alreadySent ? 'btn-outline' : 'btn-primary';
      actionBtn = `<button class="btn ${cls} btn-sm" onclick="event.stopPropagation();InvoicingPage.sendInvoice(${inv.id})" style="white-space:nowrap;">${label}</button>`;
    }

    // Quick "mark paid" button — for cases where the customer paid through
    // a different channel (e.g. user's other CRM, in-person cash, etc.) and
    // the row just needs to drop off the queue. One tap → confirm → done.
    // Hidden on already-paid/void rows since there's nothing to do.
    const markPaidBtn = (inv.status !== 'paid' && inv.status !== 'void')
      ? `<button class="btn btn-sm" onclick="event.stopPropagation();InvoicingPage.quickMarkPaid(${inv.id})"
              title="Already paid? Mark as paid"
              style="background:#f0fdf4;color:#0f5132;border:1px solid #86efac;white-space:nowrap;padding:6px 10px;font-size:13px;">✓</button>`
      : '';

    // Status pill — show the user's most recent ACTION, not the worst state.
    // Sending the SMS is the freshest meaningful event, so Sent takes
    // precedence over Overdue. Overdue gets surfaced as a secondary signal
    // (red date label + small ⚠ marker on the pill) so the row still looks
    // urgent if it needs to.
    const sentish = !!(inv.sms_sent_at || inv.stripe_checkout_session_id);
    let statusPill;
    if (inv.status === 'paid') {
      statusPill = `<span class="badge badge-green">Paid</span>`;
    } else if (inv.status === 'void') {
      statusPill = `<span class="badge badge-gray">Void</span>`;
    } else if (inv.status === 'failed') {
      statusPill = `<span class="badge badge-red">Failed</span>`;
    } else if (sentish) {
      // Sent — but flag if overdue too, so user knows to follow up
      const overdueMarker = isOverdue ? ' ⚠' : '';
      statusPill = `<span class="badge" style="background:#cfe2ff;color:#084298;" title="${isOverdue ? 'Sent — but past due, may need a nudge' : 'SMS sent, awaiting customer'}">Sent${overdueMarker}</span>`;
    } else if (isOverdue) {
      statusPill = `<span class="badge badge-red">Overdue</span>`;
    } else {
      statusPill = `<span class="badge" style="background:#fff3cd;color:#856404;">Unsent</span>`;
    }

    // "Sent X days ago" line — only shown when we have an SMS timestamp,
    // so the user can see at a glance how long they've been waiting on a
    // given check customer to mail their payment.
    let sentLine = '';
    if (inv.sms_sent_at) {
      const sentDate = new Date(inv.sms_sent_at);
      const daysAgo = Math.floor((Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24));
      const label = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`;
      sentLine = `<span style="color:#084298;font-weight:600;">📤 Sent ${label}</span>`;
    }

    // Card-on-file indicator: a Stripe customer ID exists. Note this does
    // NOT guarantee a payment method is saved — only that the customer
    // record exists. The "Charge" path will surface that nuance if it fails.
    const hasStripeCustomer = !!inv.stripe_customer_id;
    const cardOnFileBadge = hasStripeCustomer && !isCheck
      ? `<span title="Stripe customer linked" style="color:#0f5132;font-weight:600;">💳 linked</span>`
      : '';

    const methodLabel = isCheck ? '✉ Check' : (method === 'card' ? '💳 Card' : (method ? method.toUpperCase() : '—'));
    const dateLabel = dueStr
      ? `<span style="color:${isOverdue ? 'var(--red)' : 'var(--gray-500)'};">${isOverdue ? '⚠ ' : ''}${dueStr}</span>`
      : `<span style="color:var(--red);">⚠ no date</span>`;

    return `
      <div class="first-round-row" style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px 14px;border:1px solid var(--gray-200);border-radius:10px;background:white;margin-bottom:8px;">
        <div onclick="App.navigate('invoicing', 'view', ${inv.id})" style="cursor:pointer;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            ${statusPill}
            <strong style="font-size:14px;color:var(--navy);">${this._esc(inv.customer_name || '—')}</strong>
            <span style="font-family:monospace;font-size:11px;color:var(--gray-400);">${this._esc(inv.invoice_number || '')}</span>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--gray-600);align-items:center;">
            <span style="font-weight:700;color:var(--green-dark);font-size:14px;">$${amount}</span>
            <span style="color:var(--gray-500);">${methodLabel}</span>
            ${cardOnFileBadge}
            ${dateLabel}
            ${sentLine}
            ${inv.address ? `<span style="color:var(--gray-400);">${this._esc(inv.address)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">${markPaidBtn}${actionBtn}</div>
      </div>
    `;
  },

  // Group invoices by customer_name and render one collapsible card per group.
  // Sort: customers with outstanding balance first (highest $ first), then
  // all-paid customers alphabetical.
  _renderCustomerGroups(invoices, query) {
    const today = this._today;
    if (invoices.length === 0) {
      // Build a list of active filters so the user knows WHY they're seeing nothing —
      // common cause: stacked filters (e.g. Card + Pay in Full = 0) without realizing.
      const active = [];
      const viewLabels = { attention: 'Needs Attention', upcoming: 'Upcoming', history: 'History' };
      if (this._currentView && this._currentView !== 'all' && viewLabels[this._currentView]) {
        active.push({ type: 'view', label: viewLabels[this._currentView] });
      }
      if (this._methodFilter && this._methodFilter !== 'all') {
        active.push({ type: 'method', label: 'Method: ' + this._methodFilter.toUpperCase() });
      }
      if (this._cadenceFilter && this._cadenceFilter !== 'all') {
        const cadenceLabels = { monthly: 'Monthly', per_service: 'Per Service', full: 'Pay in Full' };
        active.push({ type: 'cadence', label: 'Cadence: ' + (cadenceLabels[this._cadenceFilter] || this._cadenceFilter) });
      }
      if (query) {
        active.push({ type: 'search', label: 'Search: "' + query + '"' });
      }

      const filtersHtml = active.length > 0 ? `
        <div style="margin-top:12px;padding:10px 14px;background:var(--gray-50);border-radius:8px;display:inline-block;max-width:100%;">
          <div style="font-size:12px;color:var(--gray-500);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Active filters</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-bottom:10px;">
            ${active.map(a => `<span style="background:white;border:1px solid var(--gray-200);border-radius:12px;padding:3px 10px;font-size:12px;color:var(--gray-700);">${a.label}</span>`).join('')}
          </div>
          <button class="btn btn-primary btn-sm" onclick="InvoicingPage.clearAllFilters()">Clear all filters</button>
        </div>
      ` : '';

      return `
        <div class="empty-state" style="padding:40px 16px;text-align:center;">
          <div style="font-size:40px;margin-bottom:10px;">\uD83D\uDCCB</div>
          <h3 style="margin-bottom:6px;">Nothing here</h3>
          <p style="color:var(--gray-500);font-size:14px;">${active.length > 0 ? 'No invoices match the current filter combination.' : 'No invoices to show.'}</p>
          ${filtersHtml}
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

  // Reset every filter (view, method, cadence, search) back to defaults.
  // Called from the empty-state "Clear all filters" button when the user
  // has accidentally stacked filters that produce zero results.
  clearAllFilters() {
    this._currentView = 'all';
    this._methodFilter = 'all';
    this._cadenceFilter = 'all';
    const searchEl = document.getElementById('invSearch');
    if (searchEl) searchEl.value = '';
    this.renderList();
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
    const methodFilter = this._methodFilter || 'all';
    const cadenceFilter = this._cadenceFilter || 'all';
    const invoices = (this._allInvoices || []).filter(i => {
      if (view === 'attention') {
        const overdue = (i.status === 'pending' || i.status === 'failed') && i.due_date && i.due_date < today;
        if (!(i.status === 'failed' || overdue)) return false;
      } else if (view === 'upcoming') {
        if (!(i.status === 'scheduled' || (i.status === 'pending' && i.due_date && i.due_date <= in30Str))) return false;
      } else if (view === 'history') {
        if (!(i.status === 'paid' || i.status === 'void')) return false;
      }
      if (methodFilter !== 'all') {
        const m = i.payment_method || i.preferred_method || '';
        if (m !== methodFilter) return false;
      }
      if (cadenceFilter !== 'all' && (i.payment_plan || '') !== cadenceFilter) return false;
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
      'Due Date', 'Paid Date', 'Payment Method', 'Preferred Method',
      'Check Number', 'Notes'
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
      i.preferred_method || '',
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
    // Use 'T12:00:00' to anchor at local-noon — prevents the YYYY-MM-DD-as-UTC
    // bug where stored "2026-06-01" renders as "5/31" in negative-UTC timezones
    const dueStr = inv.due_date ? new Date(inv.due_date + 'T12:00:00').toLocaleDateString() : '';
    const paidStr = inv.paid_at ? new Date(inv.paid_at).toLocaleDateString() : '';
    const installment = inv.total_installments ? ` (${inv.installment_number}/${inv.total_installments})` : '';

    // Always show the due date when we have one, regardless of status.
    // Hiding it for "scheduled" was confusing for monthly installments where
    // the due_date IS the billing trigger.
    const dateLine = inv.status === 'paid'
      ? `<span>Paid ${paidStr}</span>`
      : dueStr
        ? `<span>Due ${dueStr}</span>`
        : `<span style="color:var(--red);font-style:italic;">⚠ No due date</span>`;

    return `
      <div class="est-list-card inv-row" data-status="${inv.status}" data-due="${inv.due_date || ''}" style="position:relative;">
        <div onclick="App.navigate('invoicing', 'view', ${inv.id})" style="cursor:pointer;padding-right:36px;">
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
              ${dateLine}
            </div>
          </div>
        </div>
        <button class="inv-row-edit" onclick="event.stopPropagation();InvoicingPage.editInvoice(${inv.id})"
                title="Quick edit"
                style="position:absolute;top:10px;right:10px;background:none;border:1px solid var(--gray-200);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:13px;color:var(--gray-500);">
          ✎
        </button>
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
      const dueStr = inv.due_date ? new Date(inv.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A';
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
              ${inv.status === 'paid'
                ? `Paid on ${paidStr}${inv.payment_method ? ' via ' + inv.payment_method : ''}`
                : inv.due_date
                  ? `Due: ${dueStr}${inv.status === 'scheduled' ? ' (scheduled)' : ''}`
                  : '<span style="color:var(--red);">⚠ No due date set</span>'}
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
                    <span class="badge ${ri.status === 'paid' ? 'badge-green' : ri.status === 'scheduled' ? 'badge-muted' : ri.status === 'failed' ? 'badge-red' : 'badge-orange'}" style="font-size:11px;">${ri.status === 'paid' ? 'Paid' : ri.due_date ? new Date(ri.due_date + 'T12:00:00').toLocaleDateString() + (ri.status === 'scheduled' ? ' (sched)' : '') : (ri.status === 'scheduled' ? 'Scheduled — no date' : 'Pending — no date')}</span>
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
          ${inv.token ? `
            <a href="/receipt/${inv.token}" target="_blank" class="btn btn-outline btn-full" style="margin-top:8px;display:block;text-align:center;text-decoration:none;">
              👁 View ${inv.status === 'paid' ? 'Receipt' : 'Invoice'} (public link)
            </a>
            <button class="btn btn-outline btn-full" style="margin-top:8px;" onclick="InvoicingPage.copyInvoiceLink('${inv.token}')">
              🔗 Copy Link
            </button>
            ${inv.status === 'paid' ? `
              <button class="btn btn-primary btn-full" style="margin-top:8px;" onclick="InvoicingPage.sendReceipt(${inv.id})">
                📱 Send Receipt via SMS
              </button>
            ` : `
              <button class="btn btn-primary btn-full" style="margin-top:8px;" onclick="InvoicingPage.sendInvoice(${inv.id})">
                📱 Send Invoice via SMS
              </button>
            `}
            <p style="font-size:12px;color:var(--gray-400);text-align:center;margin-top:4px;">Creates a draft in Messaging you can review before sending</p>
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

  async chargeInvoice(id) {
    if (!confirm('Charge this invoice to the card on file?')) return;
    // btn only exists on detail view — list/First Round view calls this too
    const btn = document.getElementById('chargeNowBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Charging...'; }

    try {
      const result = await Api.post(`/api/payments/invoices/${id}/charge`);
      App.toast('Payment successful! ' + (result.invoice_number || ''), 'success');
      // If we're on the detail view, refresh detail. Otherwise refresh list.
      if (btn) this.renderDetail(id);
      else this.renderList();
    } catch (err) {
      const msg = err.message || 'Charge failed';
      // If the charge failed because no card is saved (common when the
      // Stripe customer ID was entered manually but the customer never
      // completed checkout), offer to text them the invoice link instead.
      // Paying the invoice via Stripe Checkout will save their card
      // automatically for future auto-charges (monthly + per-service plans
      // both set savePaymentMethod=true), so this kills two birds with
      // one stone — no separate save-card flow needed.
      const noCard = /no.*payment.*method|no.*card/i.test(msg);
      if (noCard) {
        if (confirm(msg + '\n\nText them their invoice link instead? When they pay, their card gets saved on file for future auto-charges.')) {
          this.sendInvoice(id);
        }
      } else {
        App.toast(msg, 'error');
      }
      if (btn) { btn.disabled = false; btn.textContent = '💳 Retry Charge'; }
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

  async sendReceipt(invoiceId) {
    try {
      const inv = await Api.get(`/api/payments/invoices/${invoiceId}`);
      if (!inv.customer_phone) {
        return App.toast('No phone number on this customer', 'error');
      }
      const cleanPhone = inv.customer_phone.replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        return App.toast('Invalid phone number on file', 'error');
      }
      if (!inv.token) {
        return App.toast('Invoice has no public link', 'error');
      }
      const firstName = (inv.customer_name || 'there').split(' ')[0];
      const amount = (inv.amount_cents / 100).toFixed(2);
      const url = `${window.location.origin}/receipt/${inv.token}`;
      const message = `Hi ${firstName}, here's your receipt for $${amount} — thanks for the payment! ${url}`;
      this._openSMS(cleanPhone, message);
      App.toast('Receipt SMS ready — review and send', 'success');
    } catch (err) {
      App.toast(err.message || 'Failed to prepare receipt SMS', 'error');
    }
  },

  // Open the native SMS app with a prefilled invoice text — same UX as
  // sending an estimate. The receipt URL works for both check (shows mailing
  // address) and Stripe (shows pay-online button) clients, so one URL covers
  // both scenarios.
  async sendInvoice(invoiceId) {
    try {
      const inv = await Api.get(`/api/payments/invoices/${invoiceId}`);
      if (!inv.customer_phone || inv.customer_phone.replace(/\D/g, '').length < 10) {
        // No phone on file — copy the receipt link so it can be pasted into email
        if (!inv.token) return App.toast('Invoice has no public link', 'error');
        const url = `${window.location.origin}/receipt/${inv.token}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
          App.toast('No phone on file — receipt link copied! Paste it into an email.', 'success');
        } else {
          window.prompt('Copy this receipt link and paste it into an email:', url);
        }
        return;
      }
      const cleanPhone = inv.customer_phone.replace(/\D/g, '');
      if (!inv.token) {
        return App.toast('Invoice has no public link — try opening the invoice detail to regenerate', 'error');
      }

      const firstName = (inv.customer_name || 'there').split(' ')[0];
      const amount = (inv.amount_cents / 100).toFixed(2);
      const url = `${window.location.origin}/receipt/${inv.token}`;
      const isCheck = (inv.payment_method_preference || '').toLowerCase() === 'check';

      const message = isCheck
        ? `Hi ${firstName}, this is Dave from Clean Air Lawn Care. Your invoice for $${amount} is ready. Tap to view it — the mailing address for checks is on the page:\n\n${url}`
        : `Hi ${firstName}, this is Dave from Clean Air Lawn Care. Your invoice for $${amount} is ready. Tap to pay online:\n\n${url}`;

      this._openSMS(cleanPhone, message);

      // Stamp the invoice as "SMS sent" so the First Round queue can show
      // it in the Sent bucket instead of Unsent. Fire-and-forget — if the
      // network call fails the toast still shows success since the SMS
      // app already opened with the message.
      Api.post(`/api/payments/invoices/${invoiceId}/mark-sent`, {})
        .then(() => {
          // Refresh the list so Sandy moves into the Sent bucket
          if (this._currentView) this.renderList();
        })
        .catch(() => { /* non-fatal */ });

      App.toast('SMS ready — review and send', 'success');
    } catch (err) {
      App.toast(err.message || 'Failed to prepare SMS', 'error');
    }
  },

  // Quick mark-paid for invoices the customer paid through some channel
  // outside this app — e.g. user's other CRM, in-person cash, Venmo, etc.
  // Just stamps status=paid + paid_at=now using the customer's preferred
  // payment method. For more detail (check #, paid date, notes) the user
  // can click into the detail view and use the full record-check form.
  async quickMarkPaid(invoiceId) {
    if (!confirm('Mark this invoice as paid?\n\nUse this when the customer paid through another channel (check, your other CRM, cash, etc.). For detailed entry with check number, use the invoice detail page instead.')) {
      return;
    }
    try {
      const inv = await Api.get(`/api/payments/invoices/${invoiceId}`);
      const method = (inv.payment_method_preference || 'check').toLowerCase();
      await Api.put(`/api/payments/invoices/${invoiceId}`, {
        status: 'paid',
        payment_method: method,
        paid_at: new Date().toISOString(),
        notes: (inv.notes ? inv.notes + ' · ' : '') + 'Marked paid manually'
      });
      App.toast('Marked as paid', 'success');
      this.renderList();
    } catch (err) {
      App.toast(err.message || 'Could not mark paid', 'error');
    }
  },

  // Send a card-save link to a customer who has a Stripe customer record but
  // no payment method on file yet. Used as a fallback when "Charge" fails
  // with "no card on file" — the user (Dave) probably entered the Stripe ID
  // manually but the customer never completed checkout to save their card.
  async sendCardSaveLink(invoiceId) {
    try {
      const inv = await Api.get(`/api/payments/invoices/${invoiceId}`);
      if (!inv.customer_phone) {
        return App.toast('No phone number on this customer', 'error');
      }
      const cleanPhone = inv.customer_phone.replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        return App.toast('Invalid phone number on file', 'error');
      }

      // Reuse the existing card-save endpoint on the estimate
      const linkResp = await Api.post(`/api/estimates/${inv.estimate_id}/card-save-link`);
      const url = linkResp.url;
      const firstName = (inv.customer_name || 'there').split(' ')[0];
      const message = `Hi ${firstName}! Quick step before billing — tap this link to securely save your card on file. No charge today, just gets you set up for hassle-free monthly payments:\n\n${url}`;

      this._openSMS(cleanPhone, message);
      App.toast('Card-save SMS ready', 'success');
    } catch (err) {
      App.toast(err.message || 'Failed to prepare card-save link', 'error');
    }
  },

  copyInvoiceLink(token) {
    const url = window.location.origin + '/receipt/' + token;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        () => App.toast('Link copied to clipboard', 'success'),
        () => App.toast('Could not copy — link: ' + url, 'error')
      );
    } else {
      // Fallback: show a prompt the user can manually copy
      window.prompt('Copy this link:', url);
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
