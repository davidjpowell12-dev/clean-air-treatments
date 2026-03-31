const EstimatesPage = {
  async render(action, id) {
    if (action === 'new') return this.renderBuilder(id || null, true);
    if (action === 'edit' && id) return this.renderBuilder(id, false);
    if (action === 'view' && id) return this.renderDetail(id);
    if (action === 'preview' && id) return this.renderPreview(id);
    return this.renderList();
  },

  // ─── List View ───────────────────────────────────────────
  async renderList() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const estimates = await Api.get('/api/estimates');

      main.innerHTML = `
        <div class="page-header">
          <h2>Estimates</h2>
          <button class="btn btn-primary btn-sm" onclick="EstimatesPage.startNewEstimate()">+ New Estimate</button>
        </div>

        ${estimates.length > 0 ? `
          <div class="est-status-tabs">
            <button class="est-tab active" data-filter="all">All <span class="est-tab-count">${estimates.length}</span></button>
            <button class="est-tab" data-filter="draft">Drafts <span class="est-tab-count">${estimates.filter(e => e.status === 'draft').length}</span></button>
            <button class="est-tab" data-filter="sent">Sent <span class="est-tab-count">${estimates.filter(e => e.status === 'sent').length}</span></button>
            <button class="est-tab" data-filter="accepted">Won <span class="est-tab-count">${estimates.filter(e => e.status === 'accepted').length}</span></button>
          </div>
        ` : ''}

        <div id="estimatesList">
          ${estimates.length > 0 ? estimates.map(e => this._renderEstimateRow(e)).join('') : `
            <div class="empty-state" style="padding:48px 16px;text-align:center;">
              <div style="font-size:48px;margin-bottom:12px;">📋</div>
              <h3 style="margin-bottom:8px;">No estimates yet</h3>
              <p style="color:var(--gray-500);margin-bottom:20px;">Create your first estimate to start winning new business.</p>
              <button class="btn btn-primary" onclick="EstimatesPage.startNewEstimate()">Create First Estimate</button>
            </div>
          `}
        </div>
      `;

      // Status filter tabs
      main.querySelectorAll('.est-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          main.querySelectorAll('.est-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const filter = tab.dataset.filter;
          const rows = main.querySelectorAll('.est-list-card');
          rows.forEach(row => {
            row.style.display = (filter === 'all' || row.dataset.status === filter) ? '' : 'none';
          });
        });
      });
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  _renderEstimateRow(e) {
    const statusConfig = {
      draft: { label: 'Draft', class: 'badge-gray', icon: '📝' },
      sent: { label: 'Sent', class: 'badge-blue', icon: '📤' },
      viewed: { label: 'Viewed', class: 'badge-orange', icon: '👁' },
      accepted: { label: 'Accepted', class: 'badge-green', icon: '✅' },
      declined: { label: 'Declined', class: 'badge-red', icon: '❌' },
      expired: { label: 'Expired', class: 'badge-gray', icon: '⏰' }
    };
    const s = statusConfig[e.status] || statusConfig.draft;
    const date = new Date(e.created_at).toLocaleDateString();

    return `
      <div class="est-list-card" data-status="${e.status}" onclick="App.navigate('estimates', 'view', ${e.id})">
        <div class="est-list-card-top">
          <div class="est-list-card-customer">
            <h4>${this._esc(e.customer_name)}</h4>
            <p>${this._esc(e.address || '')}${e.city ? ', ' + this._esc(e.city) : ''}</p>
          </div>
          <span class="badge ${s.class}">${s.icon} ${s.label}</span>
        </div>
        <div class="est-list-card-bottom">
          <div class="est-list-card-price">
            <span class="est-monthly">$${e.monthly_price.toFixed(0)}<small>/mo</small></span>
            <span class="est-total">$${e.total_price.toFixed(0)} total</span>
          </div>
          <div class="est-list-card-meta">
            <span>${e.item_count || 0} service${(e.item_count || 0) !== 1 ? 's' : ''}</span>
            <span>${date}</span>
          </div>
        </div>
      </div>
    `;
  },

  // ─── Start New Estimate (property picker) ────────────────
  async startNewEstimate() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const properties = await Api.get('/api/properties');

      main.innerHTML = `
        <div class="page-header">
          <button class="btn btn-sm btn-outline" onclick="App.navigate('estimates')">← Back</button>
          <h2>Select Property</h2>
        </div>

        <div class="form-group" style="margin-bottom:16px;">
          <input type="text" id="propSearch" placeholder="Search customers..." style="padding:14px 16px;border:2px solid var(--gray-200);border-radius:var(--radius);font-size:16px;width:100%;box-sizing:border-box;">
        </div>

        <div id="propList">
          ${properties.map(p => `
            <div class="data-row prop-search-row" onclick="App.navigate('estimates', 'new', ${p.id})" data-search="${this._esc((p.customer_name + ' ' + p.address + ' ' + (p.city||'')).toLowerCase())}">
              <div class="data-row-main">
                <h4>${this._esc(p.customer_name)}</h4>
                <p>${this._esc(p.address)}${p.city ? ', ' + this._esc(p.city) : ''}</p>
              </div>
              <div class="data-row-right">
                ${p.sqft ? `<span class="badge badge-green">${Number(p.sqft).toLocaleString()} sqft</span>` : '<span class="badge badge-orange">No sqft</span>'}
              </div>
            </div>
          `).join('')}
        </div>
      `;

      document.getElementById('propSearch').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.prop-search-row').forEach(row => {
          row.style.display = row.dataset.search.includes(q) ? '' : 'none';
        });
      });
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  // ─── Builder (the main UI) ───────────────────────────────
  async renderBuilder(editId, isNew) {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      let estimate = null;
      let property = null;
      let items = [];

      if (isNew && editId) {
        // Building new estimate for a property
        const buildData = await Api.get(`/api/estimates/build/${editId}`);
        property = buildData.property;
        items = buildData.items;
      } else if (editId) {
        // Editing existing estimate
        estimate = await Api.get(`/api/estimates/${editId}`);
        items = estimate.items || [];
        if (estimate.property_id) {
          property = await Api.get(`/api/properties/${estimate.property_id}`).catch(() => null);
        }
      }

      this._currentEstimate = estimate;
      this._currentProperty = property;
      this._currentItems = items;

      const cust = estimate || property || {};
      const validDate = estimate?.valid_until || this._defaultValidDate();

      main.innerHTML = `
        <div class="page-header" style="margin-bottom:8px;">
          <button class="btn btn-sm btn-outline" onclick="App.navigate('estimates')">← Back</button>
          <h2>${estimate ? 'Edit Estimate' : 'New Estimate'}</h2>
        </div>

        <!-- Live Price Summary (sticky) -->
        <div class="est-price-summary" id="priceSummary">
          <div class="est-price-monthly">
            <span class="est-price-amount" id="monthlyAmount">$0</span>
            <span class="est-price-label">/month</span>
          </div>
          <div class="est-price-details">
            <span id="totalAmount">$0</span> total over <span id="monthsDisplay">8</span> months
          </div>
        </div>

        <!-- Customer Info (collapsible) -->
        <div class="card est-section" style="margin-top:12px;">
          <div class="card-header est-section-toggle" onclick="this.parentElement.classList.toggle('collapsed')">
            <h3>Customer Info</h3>
            <span class="est-toggle-icon">▾</span>
          </div>
          <div class="card-body est-section-body">
            <div class="form-row">
              <div class="form-group" style="flex:1;">
                <label>Customer Name</label>
                <input type="text" id="estCustomerName" value="${this._esc(cust.customer_name || '')}" class="est-input">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex:1;">
                <label>Address</label>
                <input type="text" id="estAddress" value="${this._esc(cust.address || '')}" class="est-input">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex:2;">
                <label>City</label>
                <input type="text" id="estCity" value="${this._esc(cust.city || '')}" class="est-input">
              </div>
              <div class="form-group" style="flex:1;">
                <label>Zip</label>
                <input type="text" id="estZip" value="${this._esc(cust.zip || '')}" class="est-input">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex:1;">
                <label>Email</label>
                <input type="email" id="estEmail" value="${this._esc(cust.email || '')}" class="est-input">
              </div>
              <div class="form-group" style="flex:1;">
                <label>Phone</label>
                <input type="tel" id="estPhone" value="${this._esc(cust.phone || '')}" class="est-input">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex:1;">
                <label>Lawn Size (sqft)</label>
                <input type="number" id="estSqft" value="${cust.property_sqft || cust.sqft || ''}" class="est-input" onchange="EstimatesPage.onSqftChange()">
              </div>
              <div class="form-group" style="flex:1;">
                <label>Valid Until</label>
                <input type="date" id="estValidUntil" value="${validDate}" class="est-input">
              </div>
            </div>
          </div>
        </div>

        <!-- Services (the dynamic toggle section) -->
        <div class="card est-section" style="margin-top:12px;">
          <div class="card-header">
            <h3>Services</h3>
            <button class="btn btn-sm btn-outline" onclick="EstimatesPage.addCustomItem()">+ Custom</button>
          </div>
          <div class="card-body" id="servicesList" style="padding:0;">
            ${items.map((item, i) => this._renderServiceToggle(item, i)).join('')}
          </div>
        </div>

        <!-- Payment Options -->
        <div class="card est-section" style="margin-top:12px;">
          <div class="card-header est-section-toggle" onclick="this.parentElement.classList.toggle('collapsed')">
            <h3>Payment Terms</h3>
            <span class="est-toggle-icon">▾</span>
          </div>
          <div class="card-body est-section-body">
            <div class="form-group">
              <label>Monthly Payments Over</label>
              <div class="est-months-picker">
                ${[6, 8, 10, 12].map(m => `
                  <button class="est-month-btn ${(estimate?.payment_months || 8) === m ? 'active' : ''}" data-months="${m}" onclick="EstimatesPage.setMonths(${m})">${m} mo</button>
                `).join('')}
              </div>
            </div>
            <div class="form-group">
              <label>Customer Message (shown on proposal)</label>
              <textarea id="estMessage" rows="3" class="est-input" placeholder="Thank you for choosing Clean Air Lawn Care...">${this._esc(estimate?.customer_message || '')}</textarea>
            </div>
            <div class="form-group">
              <label>Internal Notes</label>
              <textarea id="estNotes" rows="2" class="est-input" placeholder="Notes for your team...">${this._esc(estimate?.notes || '')}</textarea>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="est-actions">
          <button class="btn btn-primary btn-full" onclick="EstimatesPage.saveEstimate()" id="saveEstBtn">
            ${estimate ? 'Update Estimate' : 'Save Estimate'}
          </button>
          ${estimate ? `
            <button class="btn btn-secondary btn-full" style="margin-top:8px;" onclick="App.navigate('estimates', 'preview', ${estimate.id})">
              Preview Proposal
            </button>
          ` : ''}
        </div>
      `;

      this._paymentMonths = estimate?.payment_months || 8;
      this._recalcTotals();
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  _renderServiceToggle(item, index) {
    const isOn = item.is_included;
    const seasonTotal = item.is_recurring ? item.price * item.rounds : item.price;
    const typeLabel = item.is_recurring ? `${item.rounds} treatments` : 'One-time';

    return `
      <div class="est-service-item ${isOn ? 'included' : 'excluded'}" data-index="${index}" id="svcItem${index}">
        <div class="est-service-toggle" onclick="EstimatesPage.toggleService(${index})">
          <div class="est-toggle-switch ${isOn ? 'on' : ''}">
            <div class="est-toggle-knob"></div>
          </div>
        </div>
        <div class="est-service-info" onclick="EstimatesPage.toggleService(${index})">
          <div class="est-service-name">${this._esc(item.service_name)}</div>
          <div class="est-service-type">${typeLabel}</div>
        </div>
        <div class="est-service-price">
          <input type="number" class="est-price-input" value="${item.price.toFixed(2)}" step="0.01" min="0"
            data-index="${index}"
            onclick="event.stopPropagation()"
            onchange="EstimatesPage.updatePrice(${index}, this.value)"
            ${!isOn ? 'tabindex="-1"' : ''}>
          ${item.is_recurring ? `<div class="est-service-season">$${seasonTotal.toFixed(0)}/season</div>` : ''}
        </div>
      </div>
    `;
  },

  toggleService(index) {
    const item = this._currentItems[index];
    item.is_included = item.is_included ? 0 : 1;

    const el = document.getElementById(`svcItem${index}`);
    el.classList.toggle('included', !!item.is_included);
    el.classList.toggle('excluded', !item.is_included);
    el.querySelector('.est-toggle-switch').classList.toggle('on', !!item.is_included);

    this._recalcTotals();
  },

  updatePrice(index, value) {
    const price = parseFloat(value) || 0;
    this._currentItems[index].price = price;

    // Update season display if recurring
    const item = this._currentItems[index];
    if (item.is_recurring) {
      const seasonEl = document.querySelector(`#svcItem${index} .est-service-season`);
      if (seasonEl) seasonEl.textContent = `$${(price * item.rounds).toFixed(0)}/season`;
    }

    this._recalcTotals();
  },

  setMonths(months) {
    this._paymentMonths = months;
    document.querySelectorAll('.est-month-btn').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.months) === months);
    });
    document.getElementById('monthsDisplay').textContent = months;
    this._recalcTotals();
  },

  _recalcTotals() {
    const items = this._currentItems || [];
    const included = items.filter(i => i.is_included);
    const total = included.reduce((sum, i) => {
      return sum + (i.is_recurring ? i.price * (i.rounds || 1) : i.price);
    }, 0);
    const monthly = total / (this._paymentMonths || 8);

    const monthlyEl = document.getElementById('monthlyAmount');
    const totalEl = document.getElementById('totalAmount');
    if (monthlyEl) {
      monthlyEl.textContent = '$' + monthly.toFixed(0);
      monthlyEl.classList.add('est-price-pop');
      setTimeout(() => monthlyEl.classList.remove('est-price-pop'), 300);
    }
    if (totalEl) totalEl.textContent = '$' + total.toFixed(0);
  },

  async onSqftChange() {
    const sqft = parseFloat(document.getElementById('estSqft').value);
    if (!sqft || sqft <= 0) return;

    try {
      const pricing = await Api.get(`/api/services/pricing/lookup?sqft=${sqft}`);

      for (const item of this._currentItems) {
        if (!item.service_id) continue; // skip custom items
        const match = pricing.find(p => p.service_id === item.service_id);
        if (match && match.price_per_treatment) {
          item.price = match.price_per_treatment;
        }
      }

      // Re-render service items
      const container = document.getElementById('servicesList');
      if (container) {
        container.innerHTML = this._currentItems.map((item, i) => this._renderServiceToggle(item, i)).join('');
      }
      this._recalcTotals();
      App.toast('Prices updated for ' + sqft.toLocaleString() + ' sqft', 'success');
    } catch (err) {
      console.error('Pricing lookup failed:', err);
    }
  },

  addCustomItem() {
    const name = prompt('Service name:');
    if (!name) return;
    const price = parseFloat(prompt('Price:', '0') || '0');

    this._currentItems.push({
      service_id: null,
      service_name: name,
      description: null,
      is_recurring: 0,
      rounds: 1,
      price: price,
      is_included: 1,
      sort_order: this._currentItems.length
    });

    const container = document.getElementById('servicesList');
    if (container) {
      container.innerHTML = this._currentItems.map((item, i) => this._renderServiceToggle(item, i)).join('');
    }
    this._recalcTotals();
  },

  async saveEstimate() {
    const btn = document.getElementById('saveEstBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const data = {
        property_id: this._currentProperty?.id || this._currentEstimate?.property_id || null,
        customer_name: document.getElementById('estCustomerName').value,
        address: document.getElementById('estAddress').value,
        city: document.getElementById('estCity').value,
        state: 'MI',
        zip: document.getElementById('estZip').value,
        email: document.getElementById('estEmail').value,
        phone: document.getElementById('estPhone').value,
        property_sqft: parseFloat(document.getElementById('estSqft').value) || null,
        payment_months: this._paymentMonths || 8,
        valid_until: document.getElementById('estValidUntil').value || null,
        customer_message: document.getElementById('estMessage').value || null,
        notes: document.getElementById('estNotes').value || null,
        items: this._currentItems.map((item, i) => ({
          ...item,
          sort_order: i,
          is_included: item.is_included ? 1 : 0
        }))
      };

      if (!data.customer_name) {
        App.toast('Customer name is required', 'error');
        btn.disabled = false;
        btn.textContent = this._currentEstimate ? 'Update Estimate' : 'Save Estimate';
        return;
      }

      let est;
      if (this._currentEstimate) {
        est = await Api.put(`/api/estimates/${this._currentEstimate.id}`, data);
        App.toast('Estimate updated', 'success');
      } else {
        est = await Api.post('/api/estimates', data);
        App.toast('Estimate created', 'success');
      }

      App.navigate('estimates', 'view', est.id);
    } catch (err) {
      App.toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = this._currentEstimate ? 'Update Estimate' : 'Save Estimate';
    }
  },

  // ─── Detail View ─────────────────────────────────────────
  async renderDetail(id) {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const est = await Api.get(`/api/estimates/${id}`);
      const statusConfig = {
        draft: { label: 'Draft', class: 'badge-gray' },
        sent: { label: 'Sent', class: 'badge-blue' },
        viewed: { label: 'Viewed', class: 'badge-orange' },
        accepted: { label: 'Accepted', class: 'badge-green' },
        declined: { label: 'Declined', class: 'badge-red' },
        expired: { label: 'Expired', class: 'badge-gray' }
      };
      const s = statusConfig[est.status] || statusConfig.draft;
      const included = (est.items || []).filter(i => i.is_included);
      const excluded = (est.items || []).filter(i => !i.is_included);

      main.innerHTML = `
        <div class="page-header" style="margin-bottom:8px;">
          <button class="btn btn-sm btn-outline" onclick="App.navigate('estimates')">← Back</button>
          <span class="badge ${s.class}" style="font-size:13px;padding:6px 14px;">${s.label}</span>
        </div>

        <!-- Proposal Card -->
        <div class="est-proposal-card">
          <div class="est-proposal-customer">
            <h3>${this._esc(est.customer_name)}</h3>
            <p>${this._esc(est.address || '')}${est.city ? ', ' + this._esc(est.city) : ''} ${this._esc(est.state || '')} ${this._esc(est.zip || '')}</p>
            ${est.property_sqft ? `<p style="color:var(--gray-500);font-size:13px;">${Number(est.property_sqft).toLocaleString()} sq ft</p>` : ''}
          </div>

          <div class="est-proposal-price-hero">
            <div class="est-hero-monthly">$${est.monthly_price.toFixed(0)}</div>
            <div class="est-hero-label">/month over ${est.payment_months} months</div>
            <div class="est-hero-total">$${est.total_price.toFixed(0)} season total</div>
          </div>

          <div class="est-proposal-services">
            <h4>Included Services</h4>
            ${included.map(i => `
              <div class="est-proposal-line">
                <div>
                  <span class="est-proposal-check">✓</span>
                  <span>${this._esc(i.service_name)}</span>
                  ${i.is_recurring ? `<span class="est-proposal-rounds">${i.rounds}x</span>` : ''}
                </div>
                <span class="est-proposal-line-price">$${(i.is_recurring ? i.price * i.rounds : i.price).toFixed(0)}</span>
              </div>
            `).join('')}
            ${excluded.length > 0 ? `
              <h4 style="margin-top:16px;color:var(--gray-400);">Not Included</h4>
              ${excluded.map(i => `
                <div class="est-proposal-line excluded">
                  <div>
                    <span class="est-proposal-check" style="color:var(--gray-300);">–</span>
                    <span>${this._esc(i.service_name)}</span>
                  </div>
                  <span class="est-proposal-line-price">$${(i.is_recurring ? i.price * i.rounds : i.price).toFixed(0)}</span>
                </div>
              `).join('')}
            ` : ''}
          </div>

          ${est.customer_message ? `
            <div class="est-proposal-message">
              <p>${this._esc(est.customer_message)}</p>
            </div>
          ` : ''}

          ${est.valid_until ? `
            <div style="text-align:center;padding:8px;font-size:12px;color:var(--gray-400);">
              Valid until ${new Date(est.valid_until).toLocaleDateString()}
            </div>
          ` : ''}
        </div>

        ${est.reminder_count > 0 ? `
          <div style="padding:8px 0;font-size:12px;color:var(--gray-400);text-align:center;">
            ${est.reminder_count} reminder${est.reminder_count > 1 ? 's' : ''} sent
            ${est.last_reminder_at ? ' &middot; Last: ' + new Date(est.last_reminder_at).toLocaleDateString() : ''}
          </div>
        ` : ''}

        ${est.notes ? `
          <div class="card" style="margin-top:12px;">
            <div class="card-header"><h3>Internal Notes</h3></div>
            <div class="card-body"><p style="font-size:14px;color:var(--gray-700);">${this._esc(est.notes)}</p></div>
          </div>
        ` : ''}

        <!-- Actions -->
        <div class="est-actions" style="margin-top:16px;">
          <button class="btn btn-primary btn-full" onclick="App.navigate('estimates', 'edit', ${est.id})">
            Edit Estimate
          </button>
          ${est.token && est.status !== 'draft' ? `
            <button class="btn btn-secondary btn-full" style="margin-top:8px;" onclick="EstimatesPage.copyProposalLink('${est.token}')">
              📋 Copy Proposal Link
            </button>
            <a href="/proposal/${est.token}" target="_blank" class="btn btn-outline btn-full" style="margin-top:8px;display:block;text-align:center;text-decoration:none;">
              👁 View as Customer
            </a>
          ` : ''}
          ${est.status === 'draft' ? `
            <div class="card" style="margin-top:12px;border:2px solid var(--green);">
              <div class="card-body" style="padding:16px;">
                <label style="font-weight:600;font-size:14px;color:var(--green-dark);display:block;margin-bottom:8px;">Send Proposal via Text</label>
                <div style="display:flex;gap:8px;">
                  <input type="tel" id="sendPhoneInput" value="${this._esc(est.phone || '')}" placeholder="(555) 555-5555" style="flex:1;padding:12px;border:2px solid var(--gray-200);border-radius:8px;font-size:15px;">
                  <button class="btn btn-primary" style="padding:12px 20px;white-space:nowrap;" onclick="EstimatesPage.sendViaSMS(${est.id})" id="sendEstBtn">
                    Text
                  </button>
                </div>
                <p style="font-size:12px;color:var(--gray-400);margin-top:6px;">Opens your Messages app with a pre-written text &middot; <a href="#" onclick="EstimatesPage.markSent(${est.id});return false;" style="color:var(--green);">mark as sent</a> if sharing another way</p>
              </div>
            </div>
          ` : ''}
          ${est.status === 'accepted' ? `
            <button class="btn btn-primary btn-full" style="margin-top:8px;background:var(--green);" onclick="EstimatesPage.showScheduleModal(${est.id})" id="scheduleJobBtn">
              📅 Schedule This Job
            </button>
          ` : ''}
          ${est.status === 'sent' || est.status === 'viewed' ? `
            <button class="btn btn-primary btn-full" style="margin-top:8px;background:var(--green);" onclick="EstimatesPage.sendReminderSMS(${est.id})" id="reminderBtn">
              Send Reminder Text
            </button>
            ${est.reminder_count > 0 ? `<p style="font-size:12px;color:var(--gray-400);text-align:center;margin-top:4px;">${est.reminder_count} reminder${est.reminder_count > 1 ? 's' : ''} sent${est.last_reminder_at ? ' \u00B7 Last: ' + new Date(est.last_reminder_at).toLocaleDateString() : ''}</p>` : ''}
            <button class="btn btn-secondary btn-full" style="margin-top:8px;" onclick="EstimatesPage.markAccepted(${est.id})">
              Mark as Accepted
            </button>
            <button class="btn btn-outline btn-full" style="margin-top:8px;" onclick="EstimatesPage.markDeclined(${est.id})">
              Mark as Declined
            </button>
          ` : ''}
          <button class="btn btn-outline btn-full" style="margin-top:8px;color:var(--red);border-color:var(--red);" onclick="EstimatesPage.deleteEstimate(${est.id})">
            Delete Estimate
          </button>
        </div>
      `;
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  // ─── Copy Proposal Link ────────────────────────────────────
  async copyProposalLink(token) {
    const url = `${window.location.origin}/proposal/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      App.toast('Proposal link copied!', 'success');
    } catch (e) {
      prompt('Copy this link:', url);
    }
  },

  // ─── Send Actions ─────────────────────────────────────────
  async sendViaSMS(id) {
    const phoneInput = document.getElementById('sendPhoneInput');
    const phone = phoneInput ? phoneInput.value.trim() : '';
    if (!phone) {
      App.toast('Enter the customer phone number', 'error');
      if (phoneInput) phoneInput.focus();
      return;
    }

    // Clean phone number — digits only
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      App.toast('Enter a valid phone number', 'error');
      if (phoneInput) phoneInput.focus();
      return;
    }

    try {
      // Get the proposal link from the server (ensures token exists)
      const result = await Api.post(`/api/estimates/${id}/send-sms`, { phone });
      const proposalUrl = result.proposal_url;
      const customerName = result.customer_name || 'there';
      const monthlyPrice = result.monthly_price || 0;

      // Compose the SMS message
      const message = `Hi ${customerName}, this is Dave from Clean Air Lawn Care. Here's your lawn care proposal — $${Math.round(monthlyPrice)}/month:\n\n${proposalUrl}`;

      // Open native SMS app
      const smsUrl = `sms:${cleanPhone}${/iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(message)}`;
      window.location.href = smsUrl;

      App.toast('Estimate marked as sent!', 'success');
      // Re-render after a short delay (user may have left the app to send the text)
      setTimeout(() => this.renderDetail(id), 1000);
    } catch (err) {
      App.toast(err.message || 'Failed to prepare SMS', 'error');
    }
  },

  async sendReminderSMS(id) {
    try {
      const est = await Api.get(`/api/estimates/${id}`);
      const phone = est.phone;
      if (!phone) {
        App.toast('No phone number on this estimate', 'error');
        return;
      }

      const cleanPhone = phone.replace(/\D/g, '');
      const proposalUrl = `${window.location.origin}/proposal/${est.token}`;
      const message = `Hi ${est.customer_name}, just following up on your Clean Air Lawn Care proposal — $${Math.round(est.monthly_price)}/month. Take a look when you get a chance:\n\n${proposalUrl}`;

      // Open native SMS app
      const smsUrl = `sms:${cleanPhone}${/iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(message)}`;
      window.location.href = smsUrl;

      // Track the reminder
      await Api.post(`/api/estimates/${id}/send-reminder-sms`);
      App.toast('Reminder text ready!', 'success');
      setTimeout(() => this.renderDetail(id), 1000);
    } catch (err) {
      App.toast(err.message || 'Failed to prepare reminder', 'error');
    }
  },

  // ─── Status Actions ──────────────────────────────────────
  async markSent(id) {
    try {
      await Api.put(`/api/estimates/${id}/status`, { status: 'sent' });
      App.toast('Estimate marked as sent', 'success');
      this.renderDetail(id);
    } catch (err) { App.toast(err.message, 'error'); }
  },

  async markAccepted(id) {
    try {
      await Api.put(`/api/estimates/${id}/status`, { status: 'accepted' });
      App.toast('Estimate accepted! 🎉', 'success');
      this.renderDetail(id);
    } catch (err) { App.toast(err.message, 'error'); }
  },

  async markDeclined(id) {
    if (!confirm('Mark this estimate as declined?')) return;
    try {
      await Api.put(`/api/estimates/${id}/status`, { status: 'declined' });
      App.toast('Estimate declined', 'success');
      this.renderDetail(id);
    } catch (err) { App.toast(err.message, 'error'); }
  },

  async deleteEstimate(id) {
    if (!confirm('Delete this estimate? This cannot be undone.')) return;
    try {
      await Api.delete(`/api/estimates/${id}`);
      App.toast('Estimate deleted', 'success');
      App.navigate('estimates');
    } catch (err) { App.toast(err.message, 'error'); }
  },

  // ─── Preview ─────────────────────────────────────────────
  async renderPreview(id) {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const est = await Api.get(`/api/estimates/${id}`);
      const included = (est.items || []).filter(i => i.is_included);

      main.innerHTML = `
        <div class="page-header" style="margin-bottom:12px;">
          <button class="btn btn-sm btn-outline" onclick="App.navigate('estimates', 'view', ${id})">← Back</button>
          <h2>Proposal Preview</h2>
        </div>
        <p style="font-size:12px;color:var(--gray-400);text-align:center;margin-bottom:12px;">This is how the proposal will appear to the customer</p>

        <div class="est-preview-container">
          <div class="est-preview-header">
            <img src="/logo.png" alt="Clean Air" style="height:48px;margin-bottom:8px;">
            <h2>Your Lawn Care Program</h2>
            <p>${this._esc(est.customer_name)}</p>
            <p style="font-size:13px;color:var(--gray-500);">${this._esc(est.address || '')}${est.city ? ', ' + this._esc(est.city) : ''}</p>
          </div>

          <div class="est-preview-price">
            <div class="est-preview-monthly">
              <span class="est-preview-dollar">$</span>
              <span class="est-preview-amount">${est.monthly_price.toFixed(0)}</span>
            </div>
            <div class="est-preview-period">/month over ${est.payment_months} months</div>
            <div class="est-preview-total">Season Total: $${est.total_price.toFixed(0)}</div>
          </div>

          <div class="est-preview-divider"></div>

          <div class="est-preview-services">
            <h4>Services Included</h4>
            ${included.map(i => `
              <div class="est-preview-service-row">
                <div>
                  <span style="color:var(--green);font-weight:700;margin-right:8px;">✓</span>
                  ${this._esc(i.service_name)}
                  ${i.is_recurring ? `<span style="color:var(--gray-400);font-size:12px;"> · ${i.rounds} treatments</span>` : ''}
                </div>
                <span>$${(i.is_recurring ? i.price * i.rounds : i.price).toFixed(0)}</span>
              </div>
            `).join('')}
          </div>

          ${est.customer_message ? `
            <div class="est-preview-message">
              ${this._esc(est.customer_message)}
            </div>
          ` : ''}

          ${est.valid_until ? `
            <div class="est-preview-valid">
              This proposal is valid until ${new Date(est.valid_until).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          ` : ''}

          <div class="est-preview-cta">
            <div class="est-preview-btn">Accept Proposal</div>
          </div>
        </div>
      `;
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  // ─── Schedule Job Modal ─────────────────────────────────
  _schedServiceConfig: [],

  // Default intervals per service type (weeks)
  _defaultIntervals: {
    'mosquito': 3, 'tick': 3, 'mosquito & tick': 3, 'mosquito/tick': 3,
    'fert': 6, 'fertiliz': 6, 'weed': 6, 'fert & weed': 6,
  },

  _getDefaultInterval(serviceName) {
    const lower = (serviceName || '').toLowerCase();
    for (const [key, val] of Object.entries(this._defaultIntervals)) {
      if (lower.includes(key)) return val;
    }
    return 5; // fallback
  },

  async showScheduleModal(estimateId) {
    const est = await Api.get(`/api/estimates/${estimateId}`);
    const items = (est.items || []).filter(i => i.is_included);
    const recurringItems = items.filter(i => i.is_recurring && (i.rounds || 1) > 1);
    const oneTimeItems = items.filter(i => !i.is_recurring || (i.rounds || 1) <= 1);

    // Default start date: next Monday
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + daysUntilMonday);
    const defaultStart = nextMonday.toISOString().split('T')[0];

    // Default one-time date: October 1 of current year (fall)
    const fallDate = new Date(today.getFullYear(), 9, 1); // Oct 1
    if (fallDate < today) fallDate.setFullYear(fallDate.getFullYear() + 1);
    const defaultFallDate = fallDate.toISOString().split('T')[0];

    // Build service config for each recurring service
    this._schedServiceConfig = recurringItems.map(item => ({
      item_id: item.id,
      service_name: item.service_name,
      rounds: item.rounds || 6,
      interval: this._getDefaultInterval(item.service_name),
      start_date: defaultStart
    }));

    this._schedOneTimeItems = oneTimeItems;
    this._schedBundleOneTime = true;
    this._schedOneTimeDate = defaultFallDate;

    // Build modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'scheduleModal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:white;border-radius:16px;max-width:420px;width:100%;max-height:90vh;overflow-y:auto;padding:24px;" id="schedModalContent">
        <h3 style="margin:0 0 4px;font-size:18px;">Schedule Job</h3>
        <p style="color:var(--gray-500);font-size:13px;margin:0 0 20px;">${this._esc(est.customer_name)}</p>

        ${recurringItems.length > 0 ? `
          <div style="margin-bottom:20px;">
            <div style="font-weight:700;font-size:13px;text-transform:uppercase;color:var(--gray-500);letter-spacing:0.5px;margin-bottom:12px;">Recurring Services</div>
            ${recurringItems.map((item, idx) => `
              <div style="background:var(--gray-50, #f8f9fa);border-radius:12px;padding:14px;margin-bottom:10px;" data-svc-idx="${idx}">
                <div style="font-weight:600;font-size:14px;margin-bottom:8px;">${this._esc(item.service_name)} <span style="color:var(--gray-400);font-weight:400;font-size:12px;">${item.rounds || 6} rounds</span></div>
                <div style="display:flex;gap:8px;align-items:center;">
                  <div style="flex:1;">
                    <label style="font-size:11px;color:var(--gray-500);display:block;margin-bottom:2px;">Start</label>
                    <input type="date" class="sched-svc-start" data-idx="${idx}" value="${defaultStart}" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;box-sizing:border-box;">
                  </div>
                  <div style="flex:0 0 auto;">
                    <label style="font-size:11px;color:var(--gray-500);display:block;margin-bottom:2px;">Every</label>
                    <div style="display:flex;gap:4px;">
                      ${[3,4,5,6,7,8].map(w => `
                        <button class="sched-int-btn" data-idx="${idx}" data-weeks="${w}" style="padding:6px 8px;border:1px solid ${w === this._getDefaultInterval(item.service_name) ? 'var(--green)' : 'var(--gray-200)'};border-radius:6px;background:${w === this._getDefaultInterval(item.service_name) ? 'var(--green-light, #f0f9e8)' : 'white'};font-weight:${w === this._getDefaultInterval(item.service_name) ? '700' : '400'};font-size:12px;cursor:pointer;min-width:30px;">${w}w</button>
                      `).join('')}
                    </div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${oneTimeItems.length > 0 ? `
          <div style="margin-bottom:20px;">
            <div style="font-weight:700;font-size:13px;text-transform:uppercase;color:var(--gray-500);letter-spacing:0.5px;margin-bottom:12px;">One-Time Services</div>
            <div style="background:var(--gray-50, #f8f9fa);border-radius:12px;padding:14px;">
              <div style="margin-bottom:10px;">
                ${oneTimeItems.map(i => `<span style="display:inline-block;background:white;border:1px solid var(--gray-200);border-radius:6px;padding:4px 10px;font-size:13px;margin:2px 4px 2px 0;">${this._esc(i.service_name)}</span>`).join('')}
              </div>
              ${oneTimeItems.length > 1 ? `
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:10px;cursor:pointer;">
                  <input type="checkbox" id="schedBundleCheck" checked style="width:18px;height:18px;accent-color:var(--green);">
                  <span>Bundle on same visit</span>
                </label>
              ` : ''}
              <div id="schedOneTimeDates">
                <div style="display:flex;align-items:center;gap:8px;">
                  <label style="font-size:11px;color:var(--gray-500);white-space:nowrap;">Date</label>
                  <input type="date" id="schedOneTimeDate" value="${defaultFallDate}" style="flex:1;padding:8px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;box-sizing:border-box;">
                </div>
              </div>
            </div>
          </div>
        ` : ''}

        <div id="schedPreview" style="background:var(--gray-50, #f8f9fa);border-radius:12px;padding:16px;margin-bottom:20px;">
        </div>

        <div style="display:flex;gap:8px;">
          <button class="btn btn-outline" style="flex:1;" onclick="document.getElementById('scheduleModal').remove()">Cancel</button>
          <button class="btn btn-primary" style="flex:1;background:var(--green);" id="confirmScheduleBtn" onclick="EstimatesPage.scheduleFromEstimate(${estimateId})">Create Schedule</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Interval button clicks for each service
    overlay.querySelectorAll('.sched-int-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const weeks = parseInt(btn.dataset.weeks);
        this._schedServiceConfig[idx].interval = weeks;
        // Update button styles for this service
        overlay.querySelectorAll(`.sched-int-btn[data-idx="${idx}"]`).forEach(b => {
          const active = parseInt(b.dataset.weeks) === weeks;
          b.style.borderColor = active ? 'var(--green)' : 'var(--gray-200)';
          b.style.background = active ? 'var(--green-light, #f0f9e8)' : 'white';
          b.style.fontWeight = active ? '700' : '400';
        });
        this._updateSchedulePreview();
      });
    });

    // Start date changes for each service
    overlay.querySelectorAll('.sched-svc-start').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        this._schedServiceConfig[idx].start_date = input.value;
        this._updateSchedulePreview();
      });
    });

    // One-time date change
    const oneTimeDate = document.getElementById('schedOneTimeDate');
    if (oneTimeDate) {
      oneTimeDate.addEventListener('change', () => {
        this._schedOneTimeDate = oneTimeDate.value;
        this._updateSchedulePreview();
      });
    }

    // Bundle checkbox
    const bundleCheck = document.getElementById('schedBundleCheck');
    if (bundleCheck) {
      bundleCheck.addEventListener('change', () => {
        this._schedBundleOneTime = bundleCheck.checked;
        const datesDiv = document.getElementById('schedOneTimeDates');
        if (bundleCheck.checked) {
          datesDiv.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="font-size:11px;color:var(--gray-500);white-space:nowrap;">Date</label>
              <input type="date" id="schedOneTimeDate" value="${this._schedOneTimeDate}" style="flex:1;padding:8px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;box-sizing:border-box;">
            </div>
          `;
          datesDiv.querySelector('#schedOneTimeDate').addEventListener('change', (e) => {
            this._schedOneTimeDate = e.target.value;
            this._updateSchedulePreview();
          });
        } else {
          datesDiv.innerHTML = this._schedOneTimeItems.map((item, i) => `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <label style="font-size:11px;color:var(--gray-500);white-space:nowrap;min-width:60px;">${this._esc(item.service_name.split(' ')[0])}</label>
              <input type="date" class="sched-onetime-date" data-idx="${i}" value="${this._schedOneTimeDate}" style="flex:1;padding:8px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;box-sizing:border-box;">
            </div>
          `).join('');
          datesDiv.querySelectorAll('.sched-onetime-date').forEach(inp => {
            inp.addEventListener('change', () => this._updateSchedulePreview());
          });
        }
        this._updateSchedulePreview();
      });
    }

    // Initial preview
    this._updateSchedulePreview();
  },

  _updateSchedulePreview() {
    const preview = document.getElementById('schedPreview');
    if (!preview) return;

    // Collect all scheduled visits: { date, services[] }
    const allVisits = [];

    // Recurring services
    this._schedServiceConfig.forEach(svc => {
      for (let r = 0; r < svc.rounds; r++) {
        const d = new Date(svc.start_date + 'T12:00:00');
        d.setDate(d.getDate() + (r * svc.interval * 7));
        allVisits.push({
          date: d,
          dateStr: d.toISOString().split('T')[0],
          label: `${svc.service_name} R${r + 1}`,
          service_name: svc.service_name,
          type: 'recurring'
        });
      }
    });

    // One-time services
    if (this._schedOneTimeItems && this._schedOneTimeItems.length > 0) {
      if (this._schedBundleOneTime) {
        const d = new Date(this._schedOneTimeDate + 'T12:00:00');
        const labels = this._schedOneTimeItems.map(i => i.service_name);
        allVisits.push({
          date: d,
          dateStr: d.toISOString().split('T')[0],
          label: labels.join(', '),
          service_name: labels.join(', '),
          type: 'onetime'
        });
      } else {
        const dateInputs = document.querySelectorAll('.sched-onetime-date');
        this._schedOneTimeItems.forEach((item, i) => {
          const dateVal = dateInputs[i] ? dateInputs[i].value : this._schedOneTimeDate;
          const d = new Date(dateVal + 'T12:00:00');
          allVisits.push({
            date: d,
            dateStr: d.toISOString().split('T')[0],
            label: item.service_name,
            service_name: item.service_name,
            type: 'onetime'
          });
        });
      }
    }

    // Sort by date
    allVisits.sort((a, b) => a.date - b.date);

    // Group by date
    const grouped = {};
    allVisits.forEach(v => {
      if (!grouped[v.dateStr]) grouped[v.dateStr] = { date: v.date, services: [] };
      grouped[v.dateStr].services.push(v.label);
    });

    const groupedArr = Object.values(grouped).sort((a, b) => a.date - b.date);

    preview.innerHTML = `
      <div style="font-weight:600;font-size:13px;margin-bottom:10px;color:var(--gray-600);">Season Preview — ${groupedArr.length} visits</div>
      <div style="max-height:200px;overflow-y:auto;">
        ${groupedArr.map((g, i) => `
          <div style="display:flex;gap:10px;padding:5px 0;${i < groupedArr.length - 1 ? 'border-bottom:1px solid var(--gray-200);' : ''}">
            <span style="font-size:12px;color:var(--gray-500);min-width:85px;white-space:nowrap;">${g.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            <span style="font-size:12px;font-weight:500;color:var(--green-dark, #2d5a0f);">${g.services.join(' + ')}</span>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:10px;padding-top:10px;border-top:2px solid var(--gray-200);text-align:center;font-size:12px;color:var(--gray-500);">
        ${allVisits.length} total service visits &middot; ${groupedArr.length > 0 ? groupedArr[0].date.toLocaleDateString('en-US', { month: 'short' }) + ' through ' + groupedArr[groupedArr.length - 1].date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''}
      </div>
    `;
  },

  async scheduleFromEstimate(estimateId) {
    const btn = document.getElementById('confirmScheduleBtn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    // Build per-service schedule data
    const services = this._schedServiceConfig.map(svc => ({
      service_name: svc.service_name,
      item_id: svc.item_id,
      rounds: svc.rounds,
      interval_weeks: svc.interval,
      start_date: svc.start_date
    }));

    // One-time services
    const oneTimeServices = [];
    if (this._schedOneTimeItems && this._schedOneTimeItems.length > 0) {
      if (this._schedBundleOneTime) {
        oneTimeServices.push({
          service_names: this._schedOneTimeItems.map(i => i.service_name),
          item_ids: this._schedOneTimeItems.map(i => i.id),
          date: this._schedOneTimeDate,
          bundled: true
        });
      } else {
        const dateInputs = document.querySelectorAll('.sched-onetime-date');
        this._schedOneTimeItems.forEach((item, i) => {
          oneTimeServices.push({
            service_names: [item.service_name],
            item_ids: [item.id],
            date: dateInputs[i] ? dateInputs[i].value : this._schedOneTimeDate,
            bundled: false
          });
        });
      }
    }

    try {
      const result = await Api.post(`/api/estimates/${estimateId}/schedule`, {
        services,
        one_time_services: oneTimeServices
      });

      document.getElementById('scheduleModal').remove();
      App.toast(`${result.total_created} visits scheduled!`, 'success');
      App.navigate('scheduling');
    } catch (err) {
      App.toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Create Schedule';
    }
  },

  // ─── Helpers ──────────────────────────────────────────────
  _defaultValidDate() {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  },

  _esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  _paymentMonths: 8,
  _currentEstimate: null,
  _currentProperty: null,
  _currentItems: []
};
