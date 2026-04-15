const ActivatePage = {
  _services: [],

  async render() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      this._services = await Api.get('/api/services');
    } catch (e) {
      this._services = [];
    }

    main.innerHTML = `
      <div class="page-header">
        <h2>Activate Client</h2>
      </div>
      <p style="color:var(--gray-500);font-size:13px;margin-bottom:16px;">Import an existing client from CoPilot. Creates property, accepted estimate, and invoices in one step.</p>

      <form id="activateForm" onsubmit="ActivatePage.submit(event)">

        <!-- Customer Info -->
        <div class="card" style="margin-bottom:12px;">
          <div class="card-header"><h3>Customer Info</h3></div>
          <div class="card-body">
            <div class="form-group">
              <label>Customer Name *</label>
              <input type="text" name="customer_name" required class="est-input" placeholder="John Smith">
            </div>
            <div class="form-group">
              <label>Address</label>
              <input type="text" name="address" class="est-input" placeholder="123 Main St">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>City</label>
                <input type="text" name="city" class="est-input" value="Grand Rapids">
              </div>
              <div class="form-group">
                <label>State</label>
                <input type="text" name="state" class="est-input" value="MI" maxlength="2">
              </div>
              <div class="form-group">
                <label>Zip</label>
                <input type="text" name="zip" class="est-input" placeholder="49503">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Email</label>
                <input type="email" name="email" class="est-input" placeholder="john@example.com">
              </div>
              <div class="form-group">
                <label>Phone</label>
                <input type="tel" name="phone" class="est-input" placeholder="(616) 555-1234">
              </div>
            </div>
            <div class="form-group">
              <label>Property Sq Ft</label>
              <input type="number" name="property_sqft" class="est-input" placeholder="8000">
            </div>
          </div>
        </div>

        <!-- Services -->
        <div class="card" style="margin-bottom:12px;">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
            <h3>Services & Pricing</h3>
            <button type="button" class="btn btn-sm btn-outline" onclick="ActivatePage.addServiceRow()">+ Add</button>
          </div>
          <div class="card-body" id="serviceRows">
            <!-- service rows inserted here -->
          </div>
          <div style="padding:0 16px 16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-top:2px solid var(--gray-200);font-weight:700;">
              <span>Season Total</span>
              <span id="seasonTotal">$0</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px;color:var(--gray-500);">
              <span>Monthly</span>
              <span id="monthlyTotal">$0/mo</span>
            </div>
          </div>
        </div>

        <!-- Payment Setup -->
        <div class="card" style="margin-bottom:12px;">
          <div class="card-header"><h3>Payment Setup</h3></div>
          <div class="card-body">
            <div class="form-row">
              <div class="form-group">
                <label>Payment Plan</label>
                <select name="payment_plan" class="est-input" onchange="ActivatePage.updateTotals()">
                  <option value="monthly" selected>Monthly</option>
                  <option value="per_service">Per Service</option>
                  <option value="full">Pay in Full</option>
                </select>
              </div>
              <div class="form-group">
                <label>Payment Method</label>
                <select name="payment_method" class="est-input">
                  <option value="card">Card</option>
                  <option value="check">Check</option>
                </select>
              </div>
            </div>
            <div class="form-row" id="monthlyFields">
              <div class="form-group">
                <label>Total Billing Months</label>
                <input type="number" name="payment_months" class="est-input" value="8" min="1" max="12" onchange="ActivatePage.updateTotals()">
              </div>
              <div class="form-group">
                <label>Remaining Months</label>
                <input type="number" name="remaining_months" class="est-input" value="8" min="1" max="12">
                <span class="form-hint">How many invoices to create</span>
              </div>
            </div>
            <div class="form-group">
              <label>First Invoice Due Date</label>
              <input type="date" name="first_due_date" class="est-input">
              <span class="form-hint">Leave blank for 1st of next month</span>
            </div>
          </div>
        </div>

        <!-- Stripe Link -->
        <div class="card" style="margin-bottom:12px;">
          <div class="card-header"><h3>Stripe (Card Clients)</h3></div>
          <div class="card-body">
            <div class="form-group">
              <label>Search by Email</label>
              <div style="display:flex;gap:8px;">
                <input type="text" id="stripeSearchEmail" class="est-input" placeholder="customer@email.com" style="flex:1;">
                <button type="button" class="btn btn-sm btn-outline" onclick="ActivatePage.searchStripe()">Search</button>
              </div>
            </div>
            <div id="stripeResults" style="margin-top:8px;"></div>
            <div class="form-group" style="margin-top:12px;">
              <label>Stripe Customer ID</label>
              <input type="text" name="stripe_customer_id" id="stripeCustomerId" class="est-input" placeholder="cus_xxxxxxxxxxxxx">
              <span class="form-hint">Auto-filled from search, or paste directly from Stripe dashboard</span>
            </div>
          </div>
        </div>

        <!-- Notes -->
        <div class="card" style="margin-bottom:12px;">
          <div class="card-body">
            <div class="form-group">
              <label>Notes</label>
              <input type="text" name="notes" class="est-input" value="Imported from CoPilot" placeholder="Internal note">
            </div>
          </div>
        </div>

        <button type="submit" class="btn btn-primary btn-full" id="activateBtn" style="margin-bottom:24px;">
          Activate Client
        </button>
      </form>
    `;

    // Add first service row
    this.addServiceRow();

    // Auto-fill stripe search email when customer email changes
    const emailInput = document.querySelector('[name="email"]');
    emailInput.addEventListener('blur', () => {
      const stripeSearch = document.getElementById('stripeSearchEmail');
      if (!stripeSearch.value && emailInput.value) {
        stripeSearch.value = emailInput.value;
      }
    });
  },

  _svcRowCount: 0,

  addServiceRow(preset) {
    this._svcRowCount++;
    const idx = this._svcRowCount;
    const container = document.getElementById('serviceRows');

    const serviceOptions = this._services
      .filter(s => s.is_active)
      .map(s => `<option value="${s.id}" data-recurring="${s.is_recurring}" data-rounds="${s.rounds}" data-name="${this._esc(s.name)}">${this._esc(s.name)}</option>`)
      .join('');

    const row = document.createElement('div');
    row.className = 'svc-row';
    row.id = `svcRow${idx}`;
    row.style.cssText = 'padding:12px 0;border-bottom:1px solid var(--gray-100);';
    row.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="font-size:13px;">Service ${idx}</strong>
        ${idx > 1 ? `<button type="button" style="background:none;border:none;color:var(--red);font-size:12px;cursor:pointer;" onclick="ActivatePage.removeServiceRow(${idx})">Remove</button>` : ''}
      </div>
      <div class="form-group" style="margin-bottom:8px;">
        <select class="est-input svc-select" data-idx="${idx}" onchange="ActivatePage.onServiceSelect(${idx})">
          <option value="">— Select service or type custom —</option>
          ${serviceOptions}
          <option value="custom">Custom Service...</option>
        </select>
      </div>
      <div id="svcCustomName${idx}" style="display:none;" class="form-group" style="margin-bottom:8px;">
        <input type="text" class="est-input svc-custom-name" placeholder="Custom service name" data-idx="${idx}">
      </div>
      <div class="form-row" style="margin-bottom:0;">
        <div class="form-group" style="margin:0;">
          <label style="font-size:11px;">Season Price ($)</label>
          <input type="number" step="0.01" class="est-input svc-price" data-idx="${idx}" placeholder="0.00" onchange="ActivatePage.updateTotals()">
        </div>
        <div class="form-group" style="margin:0;">
          <label style="font-size:11px;">Recurring?</label>
          <select class="est-input svc-recurring" data-idx="${idx}" onchange="ActivatePage.updateTotals()">
            <option value="1">Yes (multi-round)</option>
            <option value="0">No (one-time)</option>
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label style="font-size:11px;">Rounds</label>
          <input type="number" class="est-input svc-rounds" data-idx="${idx}" value="1" min="1" onchange="ActivatePage.updateTotals()">
        </div>
      </div>
    `;
    container.appendChild(row);
  },

  onServiceSelect(idx) {
    const select = document.querySelector(`.svc-select[data-idx="${idx}"]`);
    const customDiv = document.getElementById(`svcCustomName${idx}`);
    const option = select.options[select.selectedIndex];

    if (select.value === 'custom') {
      customDiv.style.display = '';
      return;
    }
    customDiv.style.display = 'none';

    if (select.value && select.value !== 'custom') {
      const svc = this._services.find(s => s.id === Number(select.value));
      if (svc) {
        const recurringEl = document.querySelector(`.svc-recurring[data-idx="${idx}"]`);
        const roundsEl = document.querySelector(`.svc-rounds[data-idx="${idx}"]`);
        recurringEl.value = svc.is_recurring ? '1' : '0';
        roundsEl.value = svc.rounds || 1;
      }
    }
  },

  removeServiceRow(idx) {
    const row = document.getElementById(`svcRow${idx}`);
    if (row) row.remove();
    this.updateTotals();
  },

  _getItems() {
    const items = [];
    document.querySelectorAll('.svc-row').forEach(row => {
      const idx = row.id.replace('svcRow', '');
      const select = row.querySelector('.svc-select');
      const customName = row.querySelector('.svc-custom-name');
      const priceEl = row.querySelector('.svc-price');
      const recurringEl = row.querySelector('.svc-recurring');
      const roundsEl = row.querySelector('.svc-rounds');

      let serviceName = '';
      if (select.value === 'custom') {
        serviceName = customName ? customName.value.trim() : '';
      } else if (select.value) {
        serviceName = select.options[select.selectedIndex].dataset.name || select.options[select.selectedIndex].text;
      }

      const price = parseFloat(priceEl.value) || 0;
      const isRecurring = recurringEl.value === '1';
      const rounds = parseInt(roundsEl.value) || 1;

      if (serviceName && price > 0) {
        // For recurring, the price entered is the SEASON total, so per-round = price/rounds
        items.push({
          service_name: serviceName,
          price: isRecurring ? price / rounds : price,
          is_recurring: isRecurring,
          rounds: rounds,
          is_included: true
        });
      }
    });
    return items;
  },

  updateTotals() {
    const items = this._getItems();
    const total = items.reduce((sum, i) => sum + (i.is_recurring ? i.price * i.rounds : i.price), 0);
    const months = parseInt(document.querySelector('[name="payment_months"]')?.value) || 8;
    const monthly = total / months;

    document.getElementById('seasonTotal').textContent = '$' + Math.round(total).toLocaleString();
    document.getElementById('monthlyTotal').textContent = '$' + Math.round(monthly) + '/mo';

    // Show/hide monthly fields
    const plan = document.querySelector('[name="payment_plan"]')?.value;
    const monthlyFields = document.getElementById('monthlyFields');
    if (monthlyFields) {
      monthlyFields.style.display = plan === 'monthly' ? '' : 'none';
    }
  },

  async searchStripe() {
    const email = document.getElementById('stripeSearchEmail').value.trim();
    const results = document.getElementById('stripeResults');
    if (!email) { results.innerHTML = ''; return; }

    results.innerHTML = '<div style="color:var(--gray-400);font-size:13px;">Searching Stripe...</div>';

    try {
      const customers = await Api.get(`/api/admin/stripe-search?email=${encodeURIComponent(email)}`);
      if (customers.length === 0) {
        results.innerHTML = '<div style="color:var(--gray-500);font-size:13px;">No Stripe customers found for this email.</div>';
        return;
      }

      results.innerHTML = customers.map(c => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--gray-50);border-radius:8px;margin-bottom:6px;cursor:pointer;border:2px solid transparent;transition:border-color 0.15s;"
             onclick="ActivatePage.selectStripeCustomer('${c.id}', this)"
             class="stripe-result">
          <div>
            <div style="font-weight:600;font-size:14px;">${this._esc(c.name || 'No name')}</div>
            <div style="font-size:12px;color:var(--gray-500);">${this._esc(c.id)} · Created ${c.created}</div>
          </div>
          <div>
            ${c.has_payment_method
              ? '<span class="badge badge-green" style="font-size:11px;">💳 Card on file</span>'
              : '<span class="badge badge-orange" style="font-size:11px;">No card</span>'}
          </div>
        </div>
      `).join('');
    } catch (err) {
      results.innerHTML = `<div style="color:var(--red);font-size:13px;">${err.message}</div>`;
    }
  },

  selectStripeCustomer(id, el) {
    document.getElementById('stripeCustomerId').value = id;
    // Highlight selected
    document.querySelectorAll('.stripe-result').forEach(r => r.style.borderColor = 'transparent');
    el.style.borderColor = 'var(--green)';
    App.toast('Stripe customer linked');
  },

  async submit(e) {
    e.preventDefault();
    const btn = document.getElementById('activateBtn');
    btn.disabled = true;
    btn.textContent = 'Activating...';

    const form = document.getElementById('activateForm');
    const formData = new FormData(form);
    const items = this._getItems();

    if (items.length === 0) {
      App.toast('Add at least one service with a price', 'error');
      btn.disabled = false;
      btn.textContent = 'Activate Client';
      return;
    }

    const payload = {
      customer_name: formData.get('customer_name'),
      address: formData.get('address'),
      city: formData.get('city'),
      state: formData.get('state'),
      zip: formData.get('zip'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      property_sqft: parseFloat(formData.get('property_sqft')) || null,
      items: items,
      payment_plan: formData.get('payment_plan'),
      payment_method: formData.get('payment_method'),
      payment_months: parseInt(formData.get('payment_months')) || 8,
      remaining_months: parseInt(formData.get('remaining_months')) || null,
      first_due_date: formData.get('first_due_date') || null,
      stripe_customer_id: formData.get('stripe_customer_id') || null,
      notes: formData.get('notes') || null
    };

    try {
      const result = await Api.post('/api/admin/activate-client', payload);
      App.toast(`${payload.customer_name} activated! ${result.invoices_created} invoices created.`, 'success');

      // Ask to add another
      btn.disabled = false;
      btn.textContent = 'Activate Client';

      const main = document.getElementById('mainContent');
      const successBanner = document.createElement('div');
      successBanner.className = 'card';
      successBanner.style.cssText = 'background:#ecfdf5;border-left:4px solid var(--green);padding:16px;margin-bottom:12px;';
      successBanner.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong style="color:#065f46;">${this._esc(payload.customer_name)} activated!</strong>
            <p style="font-size:12px;color:#047857;margin:2px 0 0;">Season: $${Math.round(result.total_price).toLocaleString()} · ${result.invoices_created} invoices · ${payload.payment_plan}</p>
          </div>
          <div style="display:flex;gap:8px;">
            <a href="#estimates/view/${result.estimate_id}" class="btn btn-sm btn-outline" style="text-decoration:none;">View</a>
            <button class="btn btn-sm btn-primary" onclick="ActivatePage.render()">+ Next</button>
          </div>
        </div>
      `;
      main.insertBefore(successBanner, main.firstChild);
      window.scrollTo(0, 0);

    } catch (err) {
      App.toast(err.message || 'Activation failed', 'error');
      btn.disabled = false;
      btn.textContent = 'Activate Client';
    }
  },

  _esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
