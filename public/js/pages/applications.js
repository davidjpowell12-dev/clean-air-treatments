const ApplicationsPage = {
  async render(action, id, prefill) {
    if (action === 'new') return this.renderForm(null, prefill);
    if (action === 'edit' && id) return this.renderForm(id);
    if (action === 'view' && id) return this.renderDetail(id);
    return this.renderList();
  },

  async renderList() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const applications = await Api.get('/api/applications');

      main.innerHTML = `
        <div class="page-header">
          <h2>Application Log</h2>
          <button class="btn btn-primary btn-sm" onclick="App.navigate('applications', 'new')">+ New</button>
        </div>

        <div class="form-row" style="margin-bottom:16px;">
          <div class="form-group" style="margin:0;">
            <input type="date" id="filterFrom" style="width:100%;padding:10px;border:2px solid var(--gray-200);border-radius:6px;font-size:14px;">
          </div>
          <div class="form-group" style="margin:0;">
            <input type="date" id="filterTo" style="width:100%;padding:10px;border:2px solid var(--gray-200);border-radius:6px;font-size:14px;">
          </div>
        </div>

        ${App.user.role === 'admin' ? `
          <div style="margin-bottom:16px;">
            <button class="btn btn-sm btn-outline" onclick="ApplicationsPage.exportCSV()">Export CSV (MDARD Report)</button>
          </div>
        ` : ''}

        <div class="card">
          <div id="appList">
            ${applications.length === 0 ? `
              <div class="empty-state">
                <h3>No applications logged</h3>
                <p>Log your first application to start tracking</p>
                <button class="btn btn-primary" onclick="App.navigate('applications', 'new')">Log Application</button>
              </div>
            ` : applications.map(a => this.renderRow(a)).join('')}
          </div>
        </div>
      `;

      // Date filters
      const filterFrom = document.getElementById('filterFrom');
      const filterTo = document.getElementById('filterTo');
      const filterApps = () => {
        const from = filterFrom.value;
        const to = filterTo.value;
        document.querySelectorAll('#appList .data-row').forEach(row => {
          const date = row.dataset.date;
          let show = true;
          if (from && date < from) show = false;
          if (to && date > to) show = false;
          row.style.display = show ? '' : 'none';
        });
      };
      filterFrom.addEventListener('change', filterApps);
      filterTo.addEventListener('change', filterApps);
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  renderRow(a) {
    const propertyLabel = a.property_customer_name ? this.esc(a.property_customer_name) + ' — ' : '';
    return `
      <div class="data-row" data-date="${a.application_date}" onclick="App.navigate('applications', 'view', ${a.id})">
        <div class="data-row-main">
          <h4>${this.esc(a.product_name)}</h4>
          <p>${propertyLabel}${this.esc(a.address || '')}${a.city ? ', ' + this.esc(a.city) : ''}</p>
          <p style="font-size:12px;color:var(--gray-500);">${a.application_date} &middot; ${this.esc(a.application_method || '')} &middot; ${a.total_area_treated?.toLocaleString() || '?'} sqft</p>
        </div>
        <div class="data-row-right">
          ${a.synced === 1 ? '<span class="badge badge-gray" style="font-size:10px;">Locked</span>' : ''}
          ${a.is_restricted_use ? '<span class="badge badge-red">RUP</span>' : ''}
          ${a.lawn_markers_posted ? '<span class="badge badge-green" style="font-size:10px;">Marked</span>' : ''}
        </div>
      </div>
    `;
  },

  async renderDetail(id) {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const a = await Api.get(`/api/applications/${id}`);
      const isLocked = a.synced === 1;

      main.innerHTML = `
        <span class="back-link" onclick="App.navigate('applications')">&larr; Applications</span>

        <div class="card">
          <div class="card-header">
            <h3>Application Record</h3>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="badge badge-blue">#${a.id}</span>
              ${isLocked ? '<span class="locked-badge">Locked</span>' : `<button class="btn btn-sm btn-outline" onclick="App.navigate('applications', 'edit', ${a.id})">Edit</button>`}
            </div>
          </div>
          <div class="card-body">
            ${isLocked ? '<p style="font-size:13px;color:var(--gray-500);margin-bottom:16px;padding:8px 12px;background:var(--gray-50);border-radius:6px;">This record is locked for regulatory compliance and cannot be edited.</p>' : ''}

            <div class="detail-section">
              <h3>Application Details</h3>
              <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${a.application_date}</span></div>
              <div class="detail-row"><span class="detail-label">Time</span><span class="detail-value">${a.start_time || ''}${a.end_time ? ' – ' + a.end_time : ''}</span></div>
              <div class="detail-row"><span class="detail-label">Applicator</span><span class="detail-value">${this.esc(a.applicator_name || '')}</span></div>
              <div class="detail-row"><span class="detail-label">Cert #</span><span class="detail-value">${this.esc(a.applicator_cert_number || 'N/A')}</span></div>
              <div class="detail-row"><span class="detail-label">Method</span><span class="detail-value">${this.esc(a.application_method || 'N/A')}</span></div>
            </div>

            <div class="detail-section">
              <h3>Location</h3>
              ${a.property_id ? `<div class="detail-row"><span class="detail-label">Property</span><span class="detail-value"><a href="#properties/view/${a.property_id}" style="color:var(--green-dark);font-weight:600;">${this.esc(a.property_customer_name || 'View Property')}</a></span></div>` : ''}
              <div class="detail-row"><span class="detail-label">Customer</span><span class="detail-value">${this.esc(a.customer_name || 'N/A')}</span></div>
              <div class="detail-row"><span class="detail-label">Address</span><span class="detail-value">${this.esc(a.address)}${a.city ? ', ' + this.esc(a.city) : ''} ${this.esc(a.state || '')} ${this.esc(a.zip || '')}</span></div>
              <div class="detail-row"><span class="detail-label">Property Size</span><span class="detail-value">${a.property_sqft ? a.property_sqft.toLocaleString() + ' sq ft' : 'N/A'}</span></div>
              <div class="detail-row"><span class="detail-label">Area Treated</span><span class="detail-value">${a.total_area_treated?.toLocaleString() || 'N/A'} sq ft</span></div>
            </div>

            <div class="detail-section">
              <h3>Product</h3>
              <div class="detail-row"><span class="detail-label">Product</span><span class="detail-value">${this.esc(a.product_name)}</span></div>
              <div class="detail-row"><span class="detail-label">EPA Reg #</span><span class="detail-value">${this.esc(a.epa_reg_number || 'N/A')}</span></div>
              <div class="detail-row"><span class="detail-label">Rate Used</span><span class="detail-value">${a.app_rate_used} ${this.esc(a.app_rate_unit)}</span></div>
              <div class="detail-row"><span class="detail-label">Total Product</span><span class="detail-value">${a.total_product_used}</span></div>
              ${a.dilution_rate ? `<div class="detail-row"><span class="detail-label">Dilution</span><span class="detail-value">${this.esc(a.dilution_rate)}</span></div>` : ''}
              ${a.total_mix_volume ? `<div class="detail-row"><span class="detail-label">Total Mix</span><span class="detail-value">${a.total_mix_volume} gal</span></div>` : ''}
              <div class="detail-row"><span class="detail-label">Target Pest</span><span class="detail-value">${this.esc(a.target_pest || 'N/A')}</span></div>
              <div class="detail-row"><span class="detail-label">Restricted Use</span><span class="detail-value">${a.is_restricted_use ? 'Yes' : 'No'}</span></div>
            </div>

            <div class="detail-section">
              <h3>Weather Conditions</h3>
              <div class="detail-row"><span class="detail-label">Temperature</span><span class="detail-value">${a.temperature_f ? a.temperature_f + '\u00B0F' : 'N/A'}</span></div>
              <div class="detail-row"><span class="detail-label">Wind Speed</span><span class="detail-value">${a.wind_speed_mph ? a.wind_speed_mph + ' mph' : 'N/A'}</span></div>
              <div class="detail-row"><span class="detail-label">Wind Direction</span><span class="detail-value">${this.esc(a.wind_direction || 'N/A')}</span></div>
              <div class="detail-row"><span class="detail-label">Conditions</span><span class="detail-value">${this.esc(a.weather_conditions || 'N/A')}</span></div>
            </div>

            <div class="detail-section">
              <h3>Michigan Compliance</h3>
              <div class="detail-row"><span class="detail-label">Lawn Markers Posted</span><span class="detail-value">${a.lawn_markers_posted ? 'Yes' : 'No'}</span></div>
              <div class="detail-row"><span class="detail-label">Registry Checked</span><span class="detail-value">${a.notification_registry_checked ? 'Yes' : 'No'}</span></div>
              <div class="detail-row"><span class="detail-label">Retention</span><span class="detail-value">${a.retention_years || 3} years</span></div>
            </div>

            ${a.notes ? `<div class="detail-section"><h3>Notes</h3><p style="font-size:14px;color:var(--gray-700);">${this.esc(a.notes)}</p></div>` : ''}

            ${(a.revenue != null || a.labor_cost != null || a.material_cost != null) ? `
              <div class="detail-section">
                <h3>Job Costing</h3>
                ${a.duration_minutes ? `<div class="detail-row"><span class="detail-label">Duration</span><span class="detail-value">${a.duration_minutes} min (${(a.duration_minutes / 60).toFixed(1)} hr)</span></div>` : ''}
                <div class="detail-row"><span class="detail-label">Revenue</span><span class="detail-value" style="color:var(--green-dark);font-weight:600;">${a.revenue != null ? '$' + Number(a.revenue).toFixed(2) : 'N/A'}</span></div>
                <div class="detail-row"><span class="detail-label">Labor Cost</span><span class="detail-value">${a.labor_cost != null ? '$' + Number(a.labor_cost).toFixed(2) : 'N/A'}</span></div>
                <div class="detail-row"><span class="detail-label">Material Cost</span><span class="detail-value">${a.material_cost != null ? '$' + Number(a.material_cost).toFixed(2) : 'N/A'}</span></div>
                <div class="detail-row" style="border-top:2px solid var(--gray-200);padding-top:8px;margin-top:4px;">
                  <span class="detail-label" style="font-weight:700;">Total Cost</span>
                  <span class="detail-value" style="font-weight:700;">${(a.labor_cost != null || a.material_cost != null) ? '$' + ((a.labor_cost || 0) + (a.material_cost || 0)).toFixed(2) : 'N/A'}</span>
                </div>
                ${a.revenue != null ? `
                  <div class="detail-row">
                    <span class="detail-label" style="font-weight:700;">Gross Margin</span>
                    <span class="detail-value" style="font-weight:700;color:${(a.revenue - (a.labor_cost || 0) - (a.material_cost || 0)) >= 0 ? 'var(--green-dark)' : 'var(--red)'};">
                      $${(a.revenue - (a.labor_cost || 0) - (a.material_cost || 0)).toFixed(2)}
                      (${a.revenue > 0 ? Math.round(((a.revenue - (a.labor_cost || 0) - (a.material_cost || 0)) / a.revenue) * 100) : 0}%)
                    </span>
                  </div>
                ` : ''}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  async renderForm(editId, prefill) {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    let app = {};
    let products = [];

    try {
      products = await Api.get('/api/products');
      // Fetch labor rate for job costing
      try {
        const settings = await Api.get('/api/settings');
        ApplicationsPage._laborRate = Number(settings.hourly_labor_rate) || 45;
      } catch (e) {
        ApplicationsPage._laborRate = 45;
      }
      if (editId) {
        app = await Api.get(`/api/applications/${editId}`);
        // Block editing locked records
        if (app.synced === 1) {
          App.toast('This record is locked for compliance and cannot be edited.', 'error');
          App.navigate('applications', 'view', editId);
          return;
        }
      }
    } catch (err) {
      // Try offline products
      try {
        products = await OfflineStore.getCachedProducts();
      } catch (e) {}
      if (products.length === 0) {
        main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
        return;
      }
    }

    // Apply prefill from calculator or property page
    if (prefill) {
      if (prefill.productId) app.product_id = prefill.productId;
      if (prefill.sqft) app.total_area_treated = prefill.sqft;
      if (prefill.rate) app.app_rate_used = prefill.rate;
      if (prefill.method) app.application_method = prefill.method;
      if (prefill.productUsed) app.total_product_used = prefill.productUsed;
      // Property prefill
      if (prefill.propertyId) app.property_id = prefill.propertyId;
      if (prefill.customerName) app.customer_name = prefill.customerName;
      if (prefill.address) app.address = prefill.address;
      if (prefill.city) app.city = prefill.city;
      if (prefill.state) app.state = prefill.state;
      if (prefill.zip) app.zip = prefill.zip;
      if (prefill.sqft && !prefill.productId) app.property_sqft = prefill.sqft;
    }

    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toTimeString().slice(0, 5);

    main.innerHTML = `
      <span class="back-link" onclick="App.navigate('applications')">&larr; Applications</span>

      <div class="card">
        <div class="card-header"><h3>${editId ? 'Edit' : 'New'} Application Record</h3></div>
        <div class="card-body">
          <form id="appForm" class="app-form">
            <!-- Property Search -->
            <h3 style="color:var(--blue);margin-bottom:12px;padding-bottom:8px;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid var(--gray-200);">Property</h3>
            <div class="form-group" style="position:relative;">
              <label>Search Property</label>
              <input type="text" id="propSearchInput" placeholder="Type customer name or address..." value="${app.property_id ? this.esc(app.customer_name || '') + ' — ' + this.esc(app.address || '') : ''}" autocomplete="off">
              <input type="hidden" name="property_id" id="propIdField" value="${app.property_id || ''}">
              <div id="propDropdown" class="dropdown-results" style="display:none;"></div>
              ${app.property_id ? `<p class="form-hint" id="propSelectedHint" style="color:var(--green-dark);">Property linked: ${this.esc(app.customer_name || '')} — ${this.esc(app.address || '')}</p>` : '<p class="form-hint" id="propSelectedHint">Select a property to auto-fill location, or enter manually below</p>'}
              <div id="propZonesHint" style="display:none;font-size:13px;color:var(--gray-700);margin-top:4px;padding:8px 10px;background:var(--gray-50);border-radius:6px;"></div>
              <button type="button" class="btn btn-sm btn-outline" style="margin-top:6px;" id="clearPropBtn" ${!app.property_id ? 'style="display:none;"' : ''} onclick="ApplicationsPage.clearPropertySelection()">Clear Property</button>
            </div>

            <!-- Date & Time -->
            <h3 style="color:var(--blue);margin:24px 0 12px;padding-bottom:8px;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid var(--gray-200);">When</h3>
            <div class="form-group">
              <label>Date *</label>
              <input type="date" name="application_date" value="${app.application_date || today}" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Start Time</label>
                <input type="time" name="start_time" value="${app.start_time || now}">
              </div>
              <div class="form-group">
                <label>End Time</label>
                <input type="time" name="end_time" value="${app.end_time || ''}">
              </div>
            </div>

            <!-- Location -->
            <h3 style="color:var(--blue);margin:24px 0 12px;padding-bottom:8px;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid var(--gray-200);">Where</h3>
            <div class="form-group">
              <label>Customer Name</label>
              <input type="text" name="customer_name" id="appCustomerName" value="${this.esc(app.customer_name || '')}">
            </div>
            <div class="form-group">
              <label>Address *</label>
              <input type="text" name="address" id="appAddress" value="${this.esc(app.address || '')}" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>City</label>
                <input type="text" name="city" id="appCity" value="${this.esc(app.city || '')}">
              </div>
              <div class="form-group">
                <label>Zip</label>
                <input type="text" name="zip" id="appZip" value="${this.esc(app.zip || '')}" maxlength="10">
              </div>
            </div>
            <div class="form-group">
              <label>Property Size (sq ft)</label>
              <input type="number" name="property_sqft" id="appPropSqft" value="${app.property_sqft || ''}" step="1">
            </div>

            <!-- Product -->
            <h3 style="color:var(--blue);margin:24px 0 12px;padding-bottom:8px;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid var(--gray-200);">What</h3>
            <div class="form-group">
              <label>Product *</label>
              <select name="product_id" id="appProduct" required>
                <option value="">Choose product...</option>
                ${products.map(p => `<option value="${p.id}" data-epa="${this.esc(p.epa_reg_number || '')}" data-name="${this.esc(p.name)}" data-rup="${p.is_restricted_use}" data-unit="${this.esc(p.app_rate_unit || '')}" data-cost="${p.cost_per_unit || ''}" ${app.product_id == p.id ? 'selected' : ''}>${this.esc(p.name)}</option>`).join('')}
              </select>
              <p class="form-hint" id="stockHint" style="display:none;font-weight:600;"></p>
            </div>
            <div id="rupWarning" style="display:none;padding:10px 14px;background:#fff3cd;border:1px solid #ffc107;border-radius:6px;margin-bottom:16px;font-size:13px;color:#856404;">
              <strong>Restricted-Use Product</strong> — Weather conditions, lawn markers, and registry check are required for MDARD compliance.
            </div>
            <div class="form-group">
              <label>Target Pest / Purpose *</label>
              <input type="text" name="target_pest" value="${this.esc(app.target_pest || '')}" placeholder="e.g. broadleaf weeds, grubs" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Rate Applied *</label>
                <input type="number" step="any" name="app_rate_used" value="${app.app_rate_used || ''}" required>
              </div>
              <div class="form-group">
                <label>Rate Unit</label>
                <input type="text" name="app_rate_unit" id="appRateUnit" value="${this.esc(app.app_rate_unit || '')}" readonly>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Total Product Used *</label>
                <input type="number" step="any" name="total_product_used" value="${app.total_product_used || ''}" required>
              </div>
              <div class="form-group">
                <label>Area Treated (sq ft) *</label>
                <input type="number" step="1" name="total_area_treated" value="${app.total_area_treated || ''}" required>
              </div>
            </div>
            <div class="form-group">
              <label>Application Method *</label>
              <select name="application_method" required>
                <option value="">Select...</option>
                <option value="broadcast" ${app.application_method === 'broadcast' ? 'selected' : ''}>Broadcast</option>
                <option value="spot_treat" ${app.application_method === 'spot_treat' ? 'selected' : ''}>Spot Treat</option>
                <option value="perimeter" ${app.application_method === 'perimeter' ? 'selected' : ''}>Perimeter</option>
                <option value="granular_spread" ${app.application_method === 'granular_spread' ? 'selected' : ''}>Granular Spread</option>
              </select>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Dilution Rate</label>
                <input type="text" name="dilution_rate" value="${this.esc(app.dilution_rate || '')}" placeholder="e.g. 3 oz/gal">
              </div>
              <div class="form-group">
                <label>Total Mix (gal)</label>
                <input type="number" step="any" name="total_mix_volume" value="${app.total_mix_volume || ''}">
              </div>
            </div>

            <!-- Weather -->
            <h3 style="color:var(--blue);margin:24px 0 12px;padding-bottom:8px;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid var(--gray-200);">Weather</h3>
            <div class="form-row">
              <div class="form-group">
                <label>Temp (\u00B0F) <span id="tempRequired" style="display:none;color:var(--red);">*</span></label>
                <input type="number" name="temperature_f" id="appTempF" value="${app.temperature_f || ''}" step="1">
              </div>
              <div class="form-group">
                <label>Wind (mph) <span id="windRequired" style="display:none;color:var(--red);">*</span></label>
                <input type="number" name="wind_speed_mph" id="appWindMph" value="${app.wind_speed_mph || ''}" step="1">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Wind Direction</label>
                <select name="wind_direction">
                  <option value="">N/A</option>
                  ${['N','NE','E','SE','S','SW','W','NW'].map(d => `<option value="${d}" ${app.wind_direction === d ? 'selected' : ''}>${d}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Conditions</label>
                <select name="weather_conditions">
                  <option value="">Select...</option>
                  ${['sunny','partly_cloudy','cloudy','light_rain','windy'].map(c => `<option value="${c}" ${app.weather_conditions === c ? 'selected' : ''}>${c.replace('_', ' ')}</option>`).join('')}
                </select>
              </div>
            </div>

            <!-- Michigan Compliance -->
            <h3 style="color:var(--blue);margin:24px 0 12px;padding-bottom:8px;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid var(--gray-200);">Michigan Compliance</h3>
            <div class="checkbox-group">
              <input type="checkbox" id="lawnMarkers" name="lawn_markers_posted" ${app.lawn_markers_posted ? 'checked' : ''}>
              <label for="lawnMarkers">Lawn markers posted at entry points</label>
            </div>
            <div class="checkbox-group">
              <input type="checkbox" id="registryChecked" name="notification_registry_checked" ${app.notification_registry_checked ? 'checked' : ''}>
              <label for="registryChecked">Pesticide Notification Registry checked</label>
            </div>

            <!-- Validation errors -->
            <div id="rupErrors" style="display:none;padding:10px 14px;background:#fde8e8;border:1px solid var(--red);border-radius:6px;margin-top:16px;font-size:13px;color:var(--red);"></div>

            <!-- Job Costing -->
            <h3 style="color:var(--blue);margin:24px 0 12px;padding-bottom:8px;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid var(--gray-200);">Job Costing</h3>
            <div class="form-group">
              <label>Duration (minutes)</label>
              <input type="number" name="duration_minutes" id="durationMinutes" value="${app.duration_minutes || ''}" step="1" min="0" placeholder="Auto-calculated from times">
              <p class="form-hint" id="durationHint">Auto-calculated from start/end times, or enter manually</p>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Labor Cost ($)</label>
                <input type="number" name="labor_cost" id="laborCost" value="${app.labor_cost != null ? app.labor_cost : ''}" step="0.01" min="0" readonly style="background:var(--gray-50);">
                <p class="form-hint" id="laborCostHint">Auto: duration × rate</p>
              </div>
              <div class="form-group">
                <label>Material Cost ($)</label>
                <input type="number" name="material_cost" id="materialCost" value="${app.material_cost != null ? app.material_cost : ''}" step="0.01" min="0">
                <p class="form-hint">Auto-filled from product cost</p>
              </div>
            </div>
            <div class="form-group">
              <label>Revenue ($)</label>
              <input type="number" name="revenue" id="revenueInput" value="${app.revenue != null ? app.revenue : ''}" step="0.01" min="0" placeholder="What did the customer pay?">
            </div>

            <!-- Notes -->
            <div class="form-group" style="margin-top:16px;">
              <label>Notes</label>
              <textarea name="notes" rows="3" placeholder="Additional notes...">${this.esc(app.notes || '')}</textarea>
            </div>

            <button type="submit" class="btn btn-primary btn-full">${editId ? 'Save Changes' : 'Log Application'}</button>
          </form>
        </div>
      </div>
    `;

    // --- Property search typeahead ---
    this._setupPropertySearch();

    // If property is already linked, load zones
    if (app.property_id) {
      this._loadPropertyZones(app.property_id);
    }

    // --- Product change: auto-fill rate unit + show RUP warning ---
    const productSelect = document.getElementById('appProduct');
    const rupWarning = document.getElementById('rupWarning');

    const updateProductInfo = async () => {
      const opt = productSelect.selectedOptions[0];
      const stockHint = document.getElementById('stockHint');
      if (opt && opt.value) {
        document.getElementById('appRateUnit').value = opt.dataset.unit || '';
        const isRup = opt.dataset.rup === '1';
        rupWarning.style.display = isRup ? 'block' : 'none';
        document.getElementById('tempRequired').style.display = isRup ? 'inline' : 'none';
        document.getElementById('windRequired').style.display = isRup ? 'inline' : 'none';

        // Capture product cost for material cost auto-calc
        ApplicationsPage._selectedProductCost = opt.dataset.cost ? Number(opt.dataset.cost) : null;
        calcMaterialCost();

        // Fetch and show current stock
        try {
          if (navigator.onLine) {
            const inv = await Api.get('/api/inventory/' + opt.value);
            stockHint.textContent = 'In stock: ' + Number(inv.quantity).toFixed(1) + ' ' + (inv.unit_of_measure || '');
            stockHint.style.color = inv.quantity <= 0 ? 'var(--red)' : inv.quantity <= inv.reorder_threshold ? 'var(--orange)' : 'var(--green-dark)';
            stockHint.style.display = 'block';
            ApplicationsPage._currentStock = inv.quantity;
            ApplicationsPage._currentStockUnit = inv.unit_of_measure || '';
          }
        } catch (e) {
          stockHint.style.display = 'none';
          ApplicationsPage._currentStock = null;
        }
      } else {
        rupWarning.style.display = 'none';
        document.getElementById('tempRequired').style.display = 'none';
        document.getElementById('windRequired').style.display = 'none';
        if (stockHint) stockHint.style.display = 'none';
        ApplicationsPage._currentStock = null;
        ApplicationsPage._selectedProductCost = null;
      }
    };
    productSelect.addEventListener('change', updateProductInfo);

    // --- Job Costing auto-calculations ---
    const startTimeInput = document.querySelector('[name="start_time"]');
    const endTimeInput = document.querySelector('[name="end_time"]');
    const durationInput = document.getElementById('durationMinutes');
    const laborCostInput = document.getElementById('laborCost');
    const materialCostInput = document.getElementById('materialCost');
    const totalProductInput = document.querySelector('[name="total_product_used"]');
    let durationManual = !!app.duration_minutes;
    let materialCostManual = !!(app.material_cost != null && editId);

    const calcLaborCost = () => {
      const mins = Number(durationInput.value);
      if (mins > 0 && ApplicationsPage._laborRate) {
        laborCostInput.value = ((mins / 60) * ApplicationsPage._laborRate).toFixed(2);
        document.getElementById('laborCostHint').textContent = 'Auto: ' + mins + ' min × $' + ApplicationsPage._laborRate + '/hr';
      }
    };

    const calcDuration = () => {
      if (durationManual) return;
      const start = startTimeInput.value;
      const end = endTimeInput.value;
      if (start && end) {
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        let mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins < 0) mins += 24 * 60;
        if (mins > 0) {
          durationInput.value = mins;
          calcLaborCost();
        }
      }
    };

    const calcMaterialCost = () => {
      if (materialCostManual) return;
      const qty = Number(totalProductInput.value);
      if (qty > 0 && ApplicationsPage._selectedProductCost != null && ApplicationsPage._selectedProductCost > 0) {
        materialCostInput.value = (qty * ApplicationsPage._selectedProductCost).toFixed(2);
      }
    };

    durationInput.addEventListener('input', () => { durationManual = true; calcLaborCost(); });
    startTimeInput.addEventListener('change', calcDuration);
    endTimeInput.addEventListener('change', calcDuration);
    materialCostInput.addEventListener('input', () => { materialCostManual = true; });
    totalProductInput.addEventListener('input', calcMaterialCost);

    // Trigger initial fill if product pre-selected
    if (app.product_id) {
      updateProductInfo();
    }
    // Run initial calculations for edit mode
    if (editId) {
      if (!durationManual) calcDuration();
      calcLaborCost();
    }

    // --- Form submit ---
    document.getElementById('appForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData.entries());

      // Get product info for denormalization
      const selectedOpt = document.querySelector(`#appProduct option[value="${data.product_id}"]`);
      data.product_name = selectedOpt?.dataset.name || '';
      data.epa_reg_number = selectedOpt?.dataset.epa || '';
      data.is_restricted_use = selectedOpt?.dataset.rup === '1' ? 1 : 0;
      data.lawn_markers_posted = document.getElementById('lawnMarkers').checked ? 1 : 0;
      data.notification_registry_checked = document.getElementById('registryChecked').checked ? 1 : 0;
      data.state = 'MI';

      // Property ID
      data.property_id = document.getElementById('propIdField').value ? Number(document.getElementById('propIdField').value) : null;

      // Applicator info from session
      data.applicator_cert_number = App.user.applicatorCertNumber || '';

      // Convert numeric fields
      ['property_sqft', 'app_rate_used', 'total_product_used', 'total_area_treated', 'total_mix_volume', 'temperature_f', 'wind_speed_mph', 'duration_minutes', 'labor_cost', 'material_cost', 'revenue'].forEach(f => {
        data[f] = data[f] ? Number(data[f]) : null;
      });
      data.product_id = Number(data.product_id);

      // --- RUP validation ---
      if (data.is_restricted_use) {
        const errors = [];
        if (data.temperature_f == null) errors.push('Temperature is required for restricted-use products');
        if (data.wind_speed_mph == null) errors.push('Wind speed is required for restricted-use products');
        if (!data.lawn_markers_posted) errors.push('Lawn markers must be posted for restricted-use products');
        if (!data.notification_registry_checked) errors.push('Notification registry must be checked for restricted-use products');
        if (!data.applicator_cert_number) errors.push('Applicator certification number is required for restricted-use products. Update your profile in Settings.');

        if (errors.length > 0) {
          const errDiv = document.getElementById('rupErrors');
          errDiv.style.display = 'block';
          errDiv.innerHTML = '<strong>Missing required fields for RUP:</strong><br>' + errors.join('<br>');
          // Scroll to first empty required field so the tech sees what needs filling
          const firstEmpty = data.temperature_f == null ? document.getElementById('appTempF')
            : data.wind_speed_mph == null ? document.getElementById('appWindMph')
            : errDiv;
          firstEmpty.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (firstEmpty.focus) firstEmpty.focus();
          return;
        }
      }

      // Stock validation (soft warning — allows override)
      if (ApplicationsPage._currentStock != null && data.total_product_used > ApplicationsPage._currentStock) {
        const deficit = (data.total_product_used - ApplicationsPage._currentStock).toFixed(1);
        const proceed = confirm(
          'Warning: You are using ' + data.total_product_used + ' ' + (ApplicationsPage._currentStockUnit || '') +
          ', but only ' + ApplicationsPage._currentStock.toFixed(1) + ' is in stock (' +
          deficit + ' more than available).\n\nThis may indicate an inventory error.\n\nProceed anyway?'
        );
        if (!proceed) return;
      }

      // Clear validation errors
      document.getElementById('rupErrors').style.display = 'none';

      try {
        if (!navigator.onLine) {
          // Save offline
          await OfflineStore.savePendingApplication(data);
          App.toast('Saved offline \u2014 will sync when connected', 'success');
          App.navigate('applications');
          return;
        }

        if (editId) {
          await Api.put(`/api/applications/${editId}`, data);
          App.toast('Application updated', 'success');
        } else {
          await Api.post('/api/applications', data);
          App.toast('Application logged', 'success');
        }
        App.navigate('applications');
      } catch (err) {
        // If network error, try offline save
        if (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('Failed')) {
          await OfflineStore.savePendingApplication(data);
          App.toast('Saved offline \u2014 will sync when connected', 'success');
          App.navigate('applications');
        } else {
          App.toast(err.message, 'error');
        }
      }
    });
  },

  _setupPropertySearch() {
    const input = document.getElementById('propSearchInput');
    const dropdown = document.getElementById('propDropdown');
    let debounceTimer = null;

    input.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const q = e.target.value.trim();
      if (q.length < 2) {
        dropdown.style.display = 'none';
        return;
      }

      debounceTimer = setTimeout(async () => {
        let results = [];
        try {
          if (navigator.onLine) {
            results = await Api.get(`/api/properties?search=${encodeURIComponent(q)}`);
          } else {
            results = await OfflineStore.searchCachedProperties(q);
          }
        } catch (err) {
          // Fallback to cached
          try {
            results = await OfflineStore.searchCachedProperties(q);
          } catch (e) { results = []; }
        }

        if (results.length === 0) {
          dropdown.innerHTML = '<div class="dropdown-item" style="color:var(--gray-500);cursor:default;">No properties found</div>';
        } else {
          dropdown.innerHTML = results.slice(0, 8).map(p => `
            <div class="dropdown-item" data-id="${p.id}" data-name="${this.esc(p.customer_name)}" data-address="${this.esc(p.address)}" data-city="${this.esc(p.city || '')}" data-state="${this.esc(p.state || 'MI')}" data-zip="${this.esc(p.zip || '')}" data-sqft="${p.sqft || ''}">
              <strong>${this.esc(p.customer_name)}</strong>
              <span style="color:var(--gray-500);font-size:13px;">${this.esc(p.address)}${p.city ? ', ' + this.esc(p.city) : ''}</span>
            </div>
          `).join('');
        }
        dropdown.style.display = 'block';

        // Handle dropdown item clicks
        dropdown.querySelectorAll('.dropdown-item[data-id]').forEach(item => {
          item.addEventListener('click', () => {
            this._selectProperty(item.dataset);
            dropdown.style.display = 'none';
          });
        });
      }, 250);
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#propSearchInput') && !e.target.closest('#propDropdown')) {
        dropdown.style.display = 'none';
      }
    });

    // Focus shows dropdown if there's content
    input.addEventListener('focus', () => {
      if (dropdown.innerHTML && input.value.length >= 2) {
        dropdown.style.display = 'block';
      }
    });
  },

  _selectProperty(data) {
    document.getElementById('propIdField').value = data.id;
    document.getElementById('propSearchInput').value = data.name + ' \u2014 ' + data.address;
    document.getElementById('appCustomerName').value = data.name;
    document.getElementById('appAddress').value = data.address;
    document.getElementById('appCity').value = data.city || '';
    document.getElementById('appZip').value = data.zip || '';
    if (data.sqft) document.getElementById('appPropSqft').value = data.sqft;

    const hint = document.getElementById('propSelectedHint');
    hint.textContent = 'Property linked: ' + data.name + ' \u2014 ' + data.address;
    hint.style.color = 'var(--green-dark)';

    const clearBtn = document.getElementById('clearPropBtn');
    if (clearBtn) clearBtn.style.display = 'inline-flex';

    // Fetch and show yard zones
    this._loadPropertyZones(data.id);
  },

  async _loadPropertyZones(propId) {
    const zonesHint = document.getElementById('propZonesHint');
    if (!zonesHint) return;
    try {
      const zones = await Api.get('/api/properties/' + propId + '/zones');
      if (zones.length > 0) {
        const total = zones.reduce((s, z) => s + z.sqft, 0);
        const parts = zones.map(z => '<strong>' + z.zone_name + ':</strong> ' + z.sqft.toLocaleString());
        zonesHint.innerHTML = parts.join(' &middot; ') + '<br><strong>Total: ' + total.toLocaleString() + ' sq ft</strong>';
        zonesHint.style.display = 'block';
      } else {
        zonesHint.style.display = 'none';
      }
    } catch (e) {
      zonesHint.style.display = 'none';
    }
  },

  clearPropertySelection() {
    document.getElementById('propIdField').value = '';
    document.getElementById('propSearchInput').value = '';
    document.getElementById('appCustomerName').value = '';
    document.getElementById('appAddress').value = '';
    document.getElementById('appCity').value = '';
    document.getElementById('appZip').value = '';
    document.getElementById('appPropSqft').value = '';

    const hint = document.getElementById('propSelectedHint');
    hint.textContent = 'Select a property to auto-fill location, or enter manually below';
    hint.style.color = '';

    const zonesHint = document.getElementById('propZonesHint');
    if (zonesHint) zonesHint.style.display = 'none';

    const clearBtn = document.getElementById('clearPropBtn');
    if (clearBtn) clearBtn.style.display = 'none';
  },

  async exportCSV() {
    try {
      const res = await fetch('/api/applications/export');
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clean-air-applications-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      App.toast('CSV exported', 'success');
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
