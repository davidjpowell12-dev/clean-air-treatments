const PropertiesPage = {
  async render(action, id) {
    if (action === 'new' || action === 'edit') return this.renderForm(action === 'edit' ? id : null);
    if (action === 'view' && id) return this.renderDetail(id);
    if (action === 'import') return this.renderImport();
    return this.renderList();
  },

  async renderList() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const properties = await Api.get('/api/properties');
      const isAdmin = App.user.role === 'admin';

      main.innerHTML = `
        <div class="page-header">
          <h2>Properties</h2>
          <div style="display:flex;gap:8px;">
            ${isAdmin ? '<button class="btn btn-sm btn-outline" onclick="App.navigate(\'properties\', \'import\')">Import CSV</button>' : ''}
            <button class="btn btn-primary btn-sm" onclick="App.navigate('properties', 'new')">+ Add</button>
          </div>
        </div>

        <div class="search-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="propSearch" placeholder="Search by name or address...">
        </div>

        <div class="card">
          <div id="propList">
            ${properties.length === 0 ? `
              <div class="empty-state">
                <h3>No properties yet</h3>
                <p>Add your first property or import from CSV</p>
                <button class="btn btn-primary" onclick="App.navigate('properties', 'new')">Add Property</button>
              </div>
            ` : properties.map(p => `
              <div class="data-row" data-search="${this.esc(p.customer_name + ' ' + p.address + ' ' + (p.city || '')).toLowerCase()}" onclick="App.navigate('properties', 'view', ${p.id})">
                <div class="data-row-main">
                  <h4>${this.esc(p.customer_name)}</h4>
                  <p>${this.esc(p.address)}${p.city ? ', ' + this.esc(p.city) : ''} ${this.esc(p.state || '')} ${this.esc(p.zip || '')}</p>
                  <p style="font-size:12px;color:var(--gray-500);">${p.sqft ? p.sqft.toLocaleString() + ' sq ft' : ''}${p.soil_type ? ' · ' + this.esc(p.soil_type) : ''}</p>
                </div>
                <div class="data-row-right">
                  <svg viewBox="0 0 24 24" fill="none" stroke="var(--gray-300)" stroke-width="2" width="20" height="20"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      document.getElementById('propSearch').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('#propList .data-row').forEach(row => {
          row.style.display = !q || row.dataset.search.includes(q) ? '' : 'none';
        });
      });
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  async renderDetail(id) {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const [prop, applications, ipmCases, scheduleRounds, soilTests] = await Promise.all([
        Api.get(`/api/properties/${id}`),
        Api.get(`/api/properties/${id}/applications`),
        Api.get(`/api/properties/${id}/ipm-cases`),
        Api.get(`/api/schedules/property/${id}`).catch(() => []),
        Api.get(`/api/soil-tests/property/${id}`).catch(() => [])
      ]);
      const isAdmin = App.user.role === 'admin';

      const zones = prop.zones || [];
      const zoneTotalSqft = zones.reduce((sum, z) => sum + (z.sqft || 0), 0);
      this._currentPropertyId = prop.id;

      main.innerHTML = `
        <span class="back-link" onclick="App.navigate('properties')">&larr; Properties</span>

        <div class="card">
          <div class="card-header">
            <h3>${this.esc(prop.customer_name)}</h3>
            ${isAdmin ? `
              <div style="display:flex;gap:8px;">
                <button class="btn btn-sm btn-outline" onclick="App.navigate('properties', 'edit', ${prop.id})">Edit</button>
                <button class="btn btn-sm btn-danger" onclick="PropertiesPage.deleteProperty(${prop.id})">Delete</button>
              </div>
            ` : ''}
          </div>
          <div class="card-body">
            <div class="detail-row"><span class="detail-label">Address</span><span class="detail-value">${this.esc(prop.address)}${prop.city ? ', ' + this.esc(prop.city) : ''} ${this.esc(prop.state || '')} ${this.esc(prop.zip || '')}</span></div>
            ${prop.email ? `<div class="detail-row"><span class="detail-label">Email</span><span class="detail-value"><a href="mailto:${this.esc(prop.email)}" style="color:var(--blue);text-decoration:none;">${this.esc(prop.email)}</a></span></div>` : ''}
            ${prop.phone ? `<div class="detail-row"><span class="detail-label">Phone</span><span class="detail-value"><a href="tel:${this.esc(prop.phone)}" style="color:var(--blue);text-decoration:none;">${this.esc(prop.phone)}</a></span></div>` : ''}
            <div class="detail-row"><span class="detail-label">Total Size</span><span class="detail-value" id="propTotalSqft">${prop.sqft ? prop.sqft.toLocaleString() + ' sq ft' : 'N/A'}</span></div>
            <div class="detail-row"><span class="detail-label">Soil Type</span><span class="detail-value">${this.esc(prop.soil_type || 'N/A')}</span></div>
            <div class="detail-row"><span class="detail-label">Last Treatment</span><span class="detail-value">${prop.last_application_date || 'Never'}</span></div>
            ${prop.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value">${this.esc(prop.notes)}</span></div>` : ''}
            ${prop.profitability && prop.profitability.total_revenue > 0 ? `
              <div style="margin-top:16px;padding-top:16px;border-top:2px solid var(--gray-200);">
                <h4 style="font-size:14px;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Profitability</h4>
                <div class="detail-row"><span class="detail-label">Total Revenue</span><span class="detail-value" style="color:var(--green-dark);font-weight:600;">$${Number(prop.profitability.total_revenue).toFixed(2)}</span></div>
                <div class="detail-row"><span class="detail-label">Total Cost</span><span class="detail-value">$${Number(prop.profitability.total_cost).toFixed(2)}</span></div>
                <div class="detail-row"><span class="detail-label">Total Margin</span><span class="detail-value" style="font-weight:600;color:${prop.profitability.total_margin >= 0 ? 'var(--green-dark)' : 'var(--red)'};">$${Number(prop.profitability.total_margin).toFixed(2)} (${prop.profitability.margin_pct}%)</span></div>
              </div>
            ` : ''}
          </div>
        </div>

        <div class="card" style="margin-bottom:12px;">
          <div class="card-header">
            <h3 style="font-size:16px;">Yard Zones</h3>
            <button class="btn btn-sm btn-outline" onclick="PropertiesPage.showAddZone(${prop.id})">+ Add</button>
          </div>
          <div id="zonesList">
            ${zones.length === 0 ? `
              <div id="zonesEmpty" style="padding:16px;text-align:center;color:var(--gray-500);font-size:14px;">
                No zones added yet. Tap "+ Add" to break down yard areas.
              </div>
            ` : zones.map(z => this.renderZoneRow(prop.id, z)).join('')}
          </div>
          <div id="zoneTotalRow" style="padding:12px 16px;border-top:2px solid var(--gray-200);${zones.length === 0 ? 'display:none' : 'display:flex'};justify-content:space-between;align-items:center;">
            <span style="font-weight:700;color:var(--blue);font-size:15px;">Total</span>
            <span style="font-weight:700;font-size:16px;" id="zoneTotalDisplay">${zoneTotalSqft.toLocaleString()} sq ft</span>
          </div>
          <div id="zoneFormArea"></div>
        </div>

        <div class="card" style="margin-bottom:12px;">
          <div class="card-header">
            <h3 style="font-size:16px;">Soil Tests</h3>
            <button class="btn btn-sm btn-outline" onclick="PropertiesPage.showSoilTestModal(${prop.id})">+ Add Test</button>
          </div>
          ${soilTests.length === 0 ? `
            <div style="padding:16px;text-align:center;color:var(--gray-500);font-size:14px;">
              No soil tests yet. Add lab results to track soil health.
            </div>
          ` : this.renderSoilSummary(soilTests)}
        </div>

        ${scheduleRounds.length > 0 ? (() => {
          const done = scheduleRounds.filter(r => r.status === 'completed').length;
          const total = scheduleRounds.length;
          const pct = Math.round((done / total) * 100);
          const today = new Date().toISOString().slice(0, 10);
          return `
            <div class="card" style="margin-bottom:12px;">
              <div class="card-header"><h3 style="font-size:16px;">Season Progress</h3><span class="badge ${done === total ? 'badge-green' : 'badge-blue'}">${done}/${total}</span></div>
              <div class="card-body">
                <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
                <div style="margin-top:10px;">
                  ${scheduleRounds.map(r => {
                    const statusIcon = r.status === 'completed' ? '&#10003;' : r.status === 'skipped' ? '&mdash;' : '&#9679;';
                    const statusColor = r.status === 'completed' ? 'var(--green)' : r.status === 'skipped' ? 'var(--gray-500)' : (r.scheduled_date < today ? 'var(--red)' : 'var(--blue)');
                    const d = new Date(r.scheduled_date + 'T12:00:00');
                    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    return `<div class="detail-row" style="cursor:pointer;" onclick="App.navigate('scheduling')">
                      <span class="detail-label" style="color:${statusColor};font-weight:600;">Round ${r.round_number} ${statusIcon}</span>
                      <span class="detail-value">${dateStr} &mdash; ${r.status}${r.status === 'scheduled' && r.scheduled_date < today ? ' (overdue)' : ''}</span>
                    </div>`;
                  }).join('')}
                </div>
              </div>
            </div>
          `;
        })() : ''}

        <div style="margin-bottom:12px;">
          <button class="btn btn-primary btn-full" onclick="App.navigate('applications', 'new', null, {propertyId:${prop.id}, customerName:'${this.esc(prop.customer_name)}', address:'${this.esc(prop.address)}', city:'${this.esc(prop.city || '')}', state:'${this.esc(prop.state || 'MI')}', zip:'${this.esc(prop.zip || '')}', sqft:${prop.sqft || 0}})">
            + New Application for This Property
          </button>
        </div>

        <div class="tab-bar">
          <span class="tab active" data-tab="applications" onclick="PropertiesPage.switchTab('applications')">Applications (${applications.length})</span>
          <span class="tab" data-tab="ipm" onclick="PropertiesPage.switchTab('ipm')">IPM Cases (${ipmCases.length})</span>
        </div>

        <div id="tab-applications">
          ${applications.length === 0 ? '<div class="empty-state"><p>No applications logged for this property</p></div>' :
            '<div class="card">' + applications.map(a => `
              <div class="data-row" onclick="App.navigate('applications', 'view', ${a.id})">
                <div class="data-row-main">
                  <h4>${this.esc(a.product_name)}</h4>
                  <p>${a.application_date} · ${this.esc(a.application_method || '')} · ${a.total_area_treated?.toLocaleString() || '?'} sqft</p>
                </div>
                <div class="data-row-right">
                  ${a.is_restricted_use ? '<span class="badge badge-red">RUP</span>' : ''}
                </div>
              </div>
            `).join('') + '</div>'}
        </div>

        <div id="tab-ipm" style="display:none;">
          <div style="margin-bottom:12px;">
            <button class="btn btn-sm btn-outline" onclick="IpmPage.showNewCaseModal(${prop.id})">+ New IPM Case</button>
          </div>
          ${ipmCases.length === 0 ? '<div class="empty-state"><p>No IPM cases for this property</p></div>' :
            '<div class="card">' + ipmCases.map(c => `
              <div class="data-row" onclick="App.navigate('ipm', 'view', ${c.id})">
                <div class="data-row-main">
                  <h4>${this.esc(c.issue_description.substring(0, 60))}${c.issue_description.length > 60 ? '...' : ''}</h4>
                  <p>${c.created_at?.split('T')[0] || ''} · ${c.observation_count} observation${c.observation_count !== 1 ? 's' : ''}</p>
                </div>
                <div class="data-row-right">
                  <span class="badge badge-${c.status === 'active' ? 'red' : c.status === 'monitoring' ? 'orange' : 'green'}">${c.status}</span>
                </div>
              </div>
            `).join('') + '</div>'}
        </div>
      `;
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  switchTab(tab) {
    document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('tab-applications').style.display = tab === 'applications' ? '' : 'none';
    document.getElementById('tab-ipm').style.display = tab === 'ipm' ? '' : 'none';
  },

  async renderForm(editId) {
    const main = document.getElementById('mainContent');
    let prop = {};

    if (editId) {
      main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      prop = await Api.get(`/api/properties/${editId}`);
    }

    main.innerHTML = `
      <span class="back-link" onclick="App.navigate('properties')">&larr; Properties</span>
      <div class="card">
        <div class="card-header"><h3>${editId ? 'Edit' : 'Add'} Property</h3></div>
        <div class="card-body">
          <form id="propForm" class="app-form">
            <div class="form-group">
              <label>Customer Name *</label>
              <input type="text" name="customer_name" value="${this.esc(prop.customer_name || '')}" required>
            </div>
            <div class="form-group">
              <label>Address *</label>
              <input type="text" name="address" value="${this.esc(prop.address || '')}" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>City</label>
                <input type="text" name="city" value="${this.esc(prop.city || '')}">
              </div>
              <div class="form-group">
                <label>Zip</label>
                <input type="text" name="zip" value="${this.esc(prop.zip || '')}" maxlength="10">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Email</label>
                <input type="email" name="email" value="${this.esc(prop.email || '')}">
              </div>
              <div class="form-group">
                <label>Phone</label>
                <input type="tel" name="phone" value="${this.esc(prop.phone || '')}">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Size (sq ft)</label>
                <input type="number" name="sqft" value="${prop.sqft || ''}" step="1">
              </div>
              <div class="form-group">
                <label>Soil Type</label>
                <select name="soil_type">
                  <option value="">Select...</option>
                  ${['clay', 'loam', 'sandy', 'silt', 'sandy loam', 'clay loam'].map(s =>
                    `<option value="${s}" ${prop.soil_type === s ? 'selected' : ''}>${s}</option>`
                  ).join('')}
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea name="notes" rows="3">${this.esc(prop.notes || '')}</textarea>
            </div>
            <button type="submit" class="btn btn-primary btn-full">${editId ? 'Save Changes' : 'Add Property'}</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('propForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData.entries());
      data.sqft = data.sqft ? Number(data.sqft) : null;
      data.state = 'MI';

      try {
        if (editId) {
          await Api.put(`/api/properties/${editId}`, data);
          App.toast('Property updated', 'success');
        } else {
          const created = await Api.post('/api/properties', data);
          App.toast('Property added', 'success');
          App.navigate('properties', 'view', created.id);
          return;
        }
        App.navigate('properties');
      } catch (err) {
        App.toast(err.message, 'error');
      }
    });
  },

  // --- CSV Import ---

  _columnAliases: {
    customer_name: ['customer_company_name', 'name', 'client', 'customer', 'account', 'contact', 'company_name', 'client_name', 'account_name'],
    address: ['street', 'street_address', 'address_1', 'service_address', 'street1'],
    city: ['city', 'town'],
    state: ['state', 'province', 'region'],
    zip: ['postal_code', 'zip_code', 'zipcode', 'postcode'],
    email: ['email', 'email_address', 'e-mail', 'e_mail'],
    phone: ['mobile', 'cell', 'phone_number', 'cell_phone', 'mobile_phone', 'telephone'],
    sqft: ['sqft', 'square_feet', 'sq_ft', 'lot_size'],
    soil_type: ['soil_type', 'soil'],
    notes: ['notes', 'comments', 'memo', 'description']
  },

  _appFields: ['customer_name', 'address', 'city', 'state', 'zip', 'email', 'phone', 'sqft', 'soil_type', 'notes'],

  _suggestMapping(header) {
    const h = header.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    for (const [field, aliases] of Object.entries(this._columnAliases)) {
      if (h === field || aliases.includes(h)) return field;
    }
    return '';
  },

  _splitCSVLine(line, delimiter) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === delimiter && !inQuotes) { values.push(current.trim()); current = ''; }
      else { current += char; }
    }
    values.push(current.trim());
    return values;
  },

  parseCSV(text) {
    // Strip BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return { headers: [], rows: [] };

    // Auto-detect delimiter
    const headerLine = lines[0];
    const commas = (headerLine.match(/,/g) || []).length;
    const tabs = (headerLine.match(/\t/g) || []).length;
    const semis = (headerLine.match(/;/g) || []).length;
    const delimiter = tabs > commas ? '\t' : semis > commas ? ';' : ',';

    const headers = this._splitCSVLine(headerLine, delimiter).map(h =>
      h.replace(/^"(.*)"$/, '$1').trim()
    );

    const rows = lines.slice(1).map(line => {
      const values = this._splitCSVLine(line, delimiter);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = values[i] || ''; });
      return obj;
    });

    return { headers, rows };
  },

  renderImport() {
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <span class="back-link" onclick="App.navigate('properties')">&larr; Properties</span>
      <div class="card">
        <div class="card-header"><h3>Import Properties from CSV</h3></div>
        <div class="card-body">
          <p style="font-size:14px;color:var(--gray-700);margin-bottom:16px;">
            Upload a CSV file from your CRM or spreadsheet. You'll map columns to the right fields before importing.
          </p>
          <div class="form-group">
            <label>Select CSV File</label>
            <input type="file" id="csvFile" accept=".csv,.tsv,.txt" style="font-size:16px;">
          </div>
          <div id="csvMapping" style="display:none;"></div>
          <div id="csvPreview" style="display:none;"></div>
          <div id="importResults" style="display:none;"></div>
        </div>
      </div>
    `;

    document.getElementById('csvFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const parsed = this.parseCSV(ev.target.result);
        this._csvHeaders = parsed.headers;
        this._csvRows = parsed.rows;

        if (parsed.rows.length === 0) {
          App.toast('No data found in CSV', 'error');
          return;
        }

        this.renderColumnMapping(parsed.headers, parsed.rows.length);
      };
      reader.readAsText(file);
    });
  },

  renderColumnMapping(headers, rowCount) {
    const mappingDiv = document.getElementById('csvMapping');
    mappingDiv.style.display = 'block';
    document.getElementById('csvPreview').style.display = 'none';
    document.getElementById('importResults').style.display = 'none';

    const fieldOptions = this._appFields.map(f => `<option value="${f}">${f}</option>`).join('');

    mappingDiv.innerHTML = `
      <div style="background:var(--blue-light);color:var(--blue);padding:10px 14px;border-radius:8px;font-size:14px;margin-bottom:16px;">
        Found <strong>${rowCount}</strong> rows with <strong>${headers.length}</strong> columns
      </div>
      <h4 style="margin-bottom:8px;font-size:15px;">Map CSV Columns</h4>
      <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">Match each CSV column to a property field. Required: customer_name and address.</p>
      <div id="mappingRows">
        ${headers.map((h, i) => {
          const suggested = this._suggestMapping(h);
          return `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <span style="flex:1;font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this.esc(h)}">${this.esc(h)}</span>
              <span style="color:var(--gray-400);font-size:16px;">&rarr;</span>
              <select class="csv-map-select" data-index="${i}" style="flex:1;padding:8px;border:2px solid var(--gray-200);border-radius:6px;font-size:14px;">
                <option value="">-- skip --</option>
                ${this._appFields.map(f => `<option value="${f}" ${suggested === f ? 'selected' : ''}>${f}</option>`).join('')}
              </select>
            </div>
          `;
        }).join('')}
      </div>
      <button class="btn btn-primary btn-full" style="margin-top:12px;" onclick="PropertiesPage.applyMapping()">Apply Mapping &amp; Preview</button>
    `;
  },

  applyMapping() {
    const selects = document.querySelectorAll('.csv-map-select');
    const mapping = {};
    selects.forEach(sel => {
      if (sel.value) {
        mapping[this._csvHeaders[Number(sel.dataset.index)]] = sel.value;
      }
    });

    // Validate required fields are mapped
    const mappedFields = Object.values(mapping);
    if (!mappedFields.includes('customer_name')) {
      App.toast('Please map a column to "customer_name"', 'error');
      return;
    }
    if (!mappedFields.includes('address')) {
      App.toast('Please map a column to "address"', 'error');
      return;
    }

    // Transform rows using mapping
    const mapped = [];
    let skippedEmpty = 0;
    const seenAddresses = new Set();

    for (const row of this._csvRows) {
      const obj = {};
      for (const [csvCol, appField] of Object.entries(mapping)) {
        let val = (row[csvCol] || '').trim();
        // Strip HTML from notes
        if (appField === 'notes' && val) {
          val = val.replace(/<[^>]*>/g, '').trim();
        }
        // Clean "undefined" city
        if (appField === 'city' && val.toLowerCase() === 'undefined') {
          val = '';
        }
        obj[appField] = val;
      }

      // Skip empty addresses
      if (!obj.address) { skippedEmpty++; continue; }

      // Dedup within CSV
      const addrKey = obj.address.toLowerCase();
      if (seenAddresses.has(addrKey)) { skippedEmpty++; continue; }
      seenAddresses.add(addrKey);

      // Default state
      if (!obj.state) obj.state = 'MI';

      mapped.push(obj);
    }

    this._mappedCSV = mapped;

    // Show preview
    const preview = document.getElementById('csvPreview');
    preview.style.display = 'block';

    const fields = this._appFields.filter(f => mapped.length > 0 && mapped.some(r => r[f]));
    const previewRows = mapped.slice(0, 5);

    preview.innerHTML = `
      <h4 style="margin:16px 0 8px;color:var(--blue);font-size:15px;">Preview (first 5 of ${mapped.length})</h4>
      ${skippedEmpty > 0 ? `<p style="font-size:13px;color:var(--orange);margin-bottom:8px;">${skippedEmpty} rows skipped (no address or duplicate)</p>` : ''}
      <div style="overflow-x:auto;margin-bottom:16px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr>${fields.map(f => `<th style="padding:6px 8px;border:1px solid var(--gray-200);background:var(--gray-50);text-align:left;white-space:nowrap;">${this.esc(f)}</th>`).join('')}</tr></thead>
          <tbody>${previewRows.map(row => `<tr>${fields.map(f => `<td style="padding:6px 8px;border:1px solid var(--gray-200);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.esc(row[f] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
      <button class="btn btn-primary btn-full" onclick="PropertiesPage.doImport()">Import ${mapped.length} Properties</button>
    `;
  },

  async doImport() {
    if (!this._mappedCSV || this._mappedCSV.length === 0) {
      App.toast('No data to import', 'error');
      return;
    }

    try {
      const result = await Api.post('/api/properties/import', { properties: this._mappedCSV });
      const resultsDiv = document.getElementById('importResults');
      resultsDiv.style.display = 'block';
      document.getElementById('csvPreview').style.display = 'none';
      document.getElementById('csvMapping').style.display = 'none';
      resultsDiv.innerHTML = `
        <div class="card card-accent">
          <div class="card-body">
            <h4 style="color:var(--green-dark);margin-bottom:8px;">Import Complete</h4>
            <p>${result.imported} properties imported successfully</p>
            ${result.skipped ? `<p style="color:var(--orange);margin-top:4px;">${result.skipped} duplicates skipped (address already exists)</p>` : ''}
            ${result.errors && result.errors.length > 0 ? `<p style="color:var(--red);margin-top:8px;">${result.errors.length} errors:<br>${result.errors.slice(0, 5).map(e => this.esc(e)).join('<br>')}</p>` : ''}
            <button class="btn btn-primary" style="margin-top:12px;" onclick="App.navigate('properties')">View Properties</button>
          </div>
        </div>
      `;
      App.toast(`${result.imported} properties imported`, 'success');
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  async deleteProperty(id) {
    if (!confirm('Delete this property? This cannot be undone.')) return;
    try {
      await Api.delete(`/api/properties/${id}`);
      App.toast('Property deleted', 'success');
      App.navigate('properties');
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  // --- Yard Zone Methods ---

  _zonePresets: ['Front Yard', 'Back Yard', 'Left Side Yard', 'Right Side Yard', 'Parking Strip', 'Landscape Beds'],

  renderZoneRow(propId, z) {
    return `
      <div class="data-row" data-zone-id="${z.id}" onclick="PropertiesPage.showEditZone(${propId}, ${z.id}, '${this.esc(z.zone_name)}', ${z.sqft})">
        <div class="data-row-main">
          <h4 style="font-size:15px;">${this.esc(z.zone_name)}</h4>
        </div>
        <div class="data-row-right" style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:15px;font-weight:600;color:var(--gray-900);">${z.sqft.toLocaleString()} sq ft</span>
          <button class="btn-icon" style="color:var(--red);font-size:18px;background:none;border:none;min-width:36px;min-height:36px;display:flex;align-items:center;justify-content:center;" onclick="event.stopPropagation();PropertiesPage.deleteZone(${propId}, ${z.id}, '${this.esc(z.zone_name)}')">&times;</button>
        </div>
      </div>
    `;
  },

  showAddZone(propId) {
    const area = document.getElementById('zoneFormArea');
    area.innerHTML = `
      <div style="padding:12px 16px;background:var(--gray-50);border-top:1px solid var(--gray-200);">
        <div style="margin-bottom:8px;">
          <label style="font-size:12px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px;">Zone Name</label>
          <select id="zoneNameSelect" style="width:100%;padding:10px;border:2px solid var(--gray-200);border-radius:6px;font-size:14px;" onchange="if(this.value==='__custom__'){document.getElementById('zoneNameCustom').style.display='block';document.getElementById('zoneNameCustom').focus();}else{document.getElementById('zoneNameCustom').style.display='none';}">
            <option value="">Select zone...</option>
            ${this._zonePresets.map(n => '<option value="' + n + '">' + n + '</option>').join('')}
            <option value="__custom__">Other (custom name)</option>
          </select>
          <input type="text" id="zoneNameCustom" placeholder="Custom zone name..." style="display:none;width:100%;padding:10px;border:2px solid var(--gray-200);border-radius:6px;font-size:14px;margin-top:6px;">
        </div>
        <div style="margin-bottom:8px;">
          <label style="font-size:12px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px;">Square Footage</label>
          <input type="number" id="zoneSqftInput" step="1" min="1" placeholder="e.g. 3200" style="width:100%;padding:10px;border:2px solid var(--gray-200);border-radius:6px;font-size:14px;">
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm" style="flex:1;" onclick="PropertiesPage.saveNewZone(${propId})">Save Zone</button>
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('zoneFormArea').innerHTML=''">Cancel</button>
        </div>
      </div>
    `;
    document.getElementById('zoneNameSelect').focus();
  },

  async saveNewZone(propId) {
    const select = document.getElementById('zoneNameSelect');
    const customInput = document.getElementById('zoneNameCustom');
    const sqftInput = document.getElementById('zoneSqftInput');

    const zoneName = select.value === '__custom__' ? customInput.value.trim() : select.value;
    const sqft = Number(sqftInput.value);

    if (!zoneName) { App.toast('Select or enter a zone name', 'error'); return; }
    if (!sqft || sqft <= 0) { App.toast('Enter square footage', 'error'); return; }

    try {
      const result = await Api.post(`/api/properties/${propId}/zones`, { zone_name: zoneName, sqft });
      // Clear empty state, append new row, update total
      const emptyEl = document.getElementById('zonesEmpty');
      if (emptyEl) emptyEl.remove();
      const list = document.getElementById('zonesList');
      list.insertAdjacentHTML('beforeend', this.renderZoneRow(propId, result.zone));
      document.getElementById('zoneTotalRow').style.display = 'flex';
      document.getElementById('zoneTotalDisplay').textContent = result.total_sqft.toLocaleString() + ' sq ft';
      document.getElementById('propTotalSqft').textContent = result.total_sqft.toLocaleString() + ' sq ft';
      document.getElementById('zoneFormArea').innerHTML = '';
      App.toast('Zone added', 'success');
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  showEditZone(propId, zoneId, currentName, currentSqft) {
    const area = document.getElementById('zoneFormArea');
    area.innerHTML = `
      <div style="padding:12px 16px;background:var(--gray-50);border-top:1px solid var(--gray-200);">
        <h4 style="font-size:14px;color:var(--blue);margin-bottom:8px;">Edit Zone</h4>
        <div style="margin-bottom:8px;">
          <label style="font-size:12px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px;">Zone Name</label>
          <input type="text" id="editZoneName" value="${this.esc(currentName)}" style="width:100%;padding:10px;border:2px solid var(--gray-200);border-radius:6px;font-size:14px;">
        </div>
        <div style="margin-bottom:8px;">
          <label style="font-size:12px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px;">Square Footage</label>
          <input type="number" id="editZoneSqft" value="${currentSqft}" step="1" min="1" style="width:100%;padding:10px;border:2px solid var(--gray-200);border-radius:6px;font-size:14px;">
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm" style="flex:1;" onclick="PropertiesPage.saveEditZone(${propId}, ${zoneId})">Save</button>
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('zoneFormArea').innerHTML=''">Cancel</button>
        </div>
      </div>
    `;
    document.getElementById('editZoneSqft').focus();
  },

  async saveEditZone(propId, zoneId) {
    const zoneName = document.getElementById('editZoneName').value.trim();
    const sqft = Number(document.getElementById('editZoneSqft').value);

    if (!zoneName) { App.toast('Enter a zone name', 'error'); return; }
    if (!sqft || sqft <= 0) { App.toast('Enter square footage', 'error'); return; }

    try {
      const result = await Api.put(`/api/properties/${propId}/zones/${zoneId}`, { zone_name: zoneName, sqft });
      // Update the row in place
      const row = document.querySelector(`[data-zone-id="${zoneId}"]`);
      if (row) {
        row.outerHTML = this.renderZoneRow(propId, result.zone);
      }
      document.getElementById('zoneTotalDisplay').textContent = result.total_sqft.toLocaleString() + ' sq ft';
      document.getElementById('propTotalSqft').textContent = result.total_sqft.toLocaleString() + ' sq ft';
      document.getElementById('zoneFormArea').innerHTML = '';
      App.toast('Zone updated', 'success');
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  async deleteZone(propId, zoneId, zoneName) {
    if (!confirm('Remove "' + zoneName + '" zone?')) return;
    try {
      const result = await Api.delete(`/api/properties/${propId}/zones/${zoneId}`);
      const row = document.querySelector(`[data-zone-id="${zoneId}"]`);
      if (row) row.remove();
      // Check if any zones remain
      const remaining = document.querySelectorAll('#zonesList [data-zone-id]');
      if (remaining.length === 0) {
        document.getElementById('zonesList').innerHTML = '<div id="zonesEmpty" style="padding:16px;text-align:center;color:var(--gray-500);font-size:14px;">No zones added yet. Tap "+ Add" to break down yard areas.</div>';
        document.getElementById('zoneTotalRow').style.display = 'none';
      } else {
        document.getElementById('zoneTotalDisplay').textContent = result.total_sqft.toLocaleString() + ' sq ft';
      }
      document.getElementById('propTotalSqft').textContent = result.total_sqft > 0 ? result.total_sqft.toLocaleString() + ' sq ft' : 'N/A';
      App.toast('Zone removed', 'success');
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  // --- Soil Testing Methods ---

  renderSoilSummary(tests) {
    const latest = tests[0]; // newest first
    const phPct = latest.ph ? Math.max(0, Math.min(100, ((latest.ph - 4) / 6) * 100)) : null;

    // N-P-K bar percentages (typical max ranges for lawn soil)
    const nMax = 120, pMax = 100, kMax = 400;
    const nPct = latest.nitrogen_ppm ? Math.min(100, (latest.nitrogen_ppm / nMax) * 100) : 0;
    const pPct = latest.phosphorus_ppm ? Math.min(100, (latest.phosphorus_ppm / pMax) * 100) : 0;
    const kPct = latest.potassium_ppm ? Math.min(100, (latest.potassium_ppm / kMax) * 100) : 0;

    return `
      <div class="soil-summary">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <span style="font-size:12px;color:var(--gray-500);">${latest.test_date} ${latest.lab_name ? '&middot; ' + this.esc(latest.lab_name) : ''}</span>
          <button class="btn btn-sm btn-outline" style="font-size:11px;padding:2px 8px;" onclick="PropertiesPage.showSoilTestModal(${latest.property_id}, ${latest.id})">Edit</button>
        </div>

        ${latest.ph ? `
          <div class="soil-section-title">pH Level</div>
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:4px;">
            <span class="soil-ph-value ${this.phColor(latest.ph)}">${latest.ph}</span>
            <span style="font-size:13px;color:var(--gray-500);">${this.phLabel(latest.ph)}</span>
          </div>
          <div style="position:relative;margin-bottom:8px;">
            <div class="soil-ph-gauge">
              <div class="soil-ph-marker" style="left:${phPct}%;"></div>
            </div>
            <div class="soil-ph-labels">
              <span>4.0</span>
              <span style="color:var(--green-dark);font-weight:600;">6.0–7.0</span>
              <span>10.0</span>
            </div>
          </div>
        ` : ''}

        ${(latest.nitrogen_ppm || latest.phosphorus_ppm || latest.potassium_ppm) ? `
          <div class="soil-section-title">Nutrients (N-P-K)</div>
          <div class="soil-bar-group">
            ${latest.nitrogen_ppm != null ? `
              <div class="soil-bar-row">
                <span class="soil-bar-label" style="color:#38a169;">N</span>
                <div class="soil-bar-track"><div class="soil-bar-fill soil-bar-fill-n" style="width:${nPct}%;"></div></div>
                <span class="soil-bar-value ${this.nutrientColor('n', latest.nitrogen_ppm)}">${latest.nitrogen_ppm} ppm</span>
              </div>
            ` : ''}
            ${latest.phosphorus_ppm != null ? `
              <div class="soil-bar-row">
                <span class="soil-bar-label" style="color:#3182ce;">P</span>
                <div class="soil-bar-track"><div class="soil-bar-fill soil-bar-fill-p" style="width:${pPct}%;"></div></div>
                <span class="soil-bar-value ${this.nutrientColor('p', latest.phosphorus_ppm)}">${latest.phosphorus_ppm} ppm</span>
              </div>
            ` : ''}
            ${latest.potassium_ppm != null ? `
              <div class="soil-bar-row">
                <span class="soil-bar-label" style="color:#dd6b20;">K</span>
                <div class="soil-bar-track"><div class="soil-bar-fill soil-bar-fill-k" style="width:${kPct}%;"></div></div>
                <span class="soil-bar-value ${this.nutrientColor('k', latest.potassium_ppm)}">${latest.potassium_ppm} ppm</span>
              </div>
            ` : ''}
          </div>
        ` : ''}

        ${(latest.organic_matter_pct || latest.cec || latest.calcium_ppm || latest.magnesium_ppm || latest.sulfur_ppm) ? `
          <div class="soil-section-title">Additional</div>
          <div class="soil-detail-grid">
            ${latest.organic_matter_pct != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Organic Matter</span><span class="soil-detail-value">${latest.organic_matter_pct}%</span></div>` : ''}
            ${latest.cec != null ? `<div class="soil-detail-item"><span class="soil-detail-label">CEC</span><span class="soil-detail-value">${latest.cec}</span></div>` : ''}
            ${latest.buffer_ph != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Buffer pH</span><span class="soil-detail-value">${latest.buffer_ph}</span></div>` : ''}
            ${latest.calcium_ppm != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Calcium</span><span class="soil-detail-value">${latest.calcium_ppm} ppm</span></div>` : ''}
            ${latest.magnesium_ppm != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Magnesium</span><span class="soil-detail-value">${latest.magnesium_ppm} ppm</span></div>` : ''}
            ${latest.sulfur_ppm != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Sulfur</span><span class="soil-detail-value">${latest.sulfur_ppm} ppm</span></div>` : ''}
          </div>
        ` : ''}

        ${latest.recommendations ? `
          <div class="soil-section-title">Recommendations</div>
          <p style="font-size:14px;color:var(--gray-700);line-height:1.5;">${this.esc(latest.recommendations)}</p>
        ` : ''}

        ${latest.file_path ? `
          <a href="/api/soil-tests/${latest.id}/report" target="_blank" class="btn btn-outline btn-full" style="margin-top:12px;gap:6px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            View Lab Report
          </a>
        ` : `
          <button class="btn btn-outline btn-full" style="margin-top:12px;gap:6px;" onclick="PropertiesPage.uploadSoilReport(${latest.id})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload Lab Report
          </button>
        `}

        ${tests.length > 1 ? `
          <div class="soil-section-title" style="margin-top:16px;">Previous Tests</div>
          ${tests.slice(1).map(t => `
            <div class="soil-history-row" onclick="PropertiesPage.showSoilTestDetail(${t.id})">
              <div class="soil-history-info">
                <span class="soil-history-date">${t.test_date}</span>
                <span class="soil-history-lab">${this.esc(t.lab_name || 'Unknown lab')}</span>
              </div>
              ${t.ph ? `<span class="soil-history-ph ${this.phColor(t.ph)}">${t.ph}</span>` : ''}
            </div>
          `).join('')}
        ` : ''}
      </div>
    `;
  },

  phColor(ph) {
    if (ph >= 6.0 && ph <= 7.0) return 'soil-optimal';
    if (ph >= 5.5 && ph <= 7.5) return 'soil-marginal';
    return 'soil-critical';
  },

  phLabel(ph) {
    if (ph < 5.5) return 'Very Acidic';
    if (ph < 6.0) return 'Acidic';
    if (ph <= 7.0) return 'Optimal';
    if (ph <= 7.5) return 'Slightly Alkaline';
    return 'Alkaline';
  },

  nutrientColor(type, val) {
    const ranges = {
      n: { low: 20, high: 80 },
      p: { low: 15, high: 60 },
      k: { low: 100, high: 250 }
    };
    const r = ranges[type];
    if (!r) return '';
    if (val < r.low) return 'soil-critical';
    if (val > r.high) return 'soil-marginal';
    return 'soil-optimal';
  },

  async showSoilTestModal(propertyId, editId) {
    let test = {};
    if (editId) {
      try { test = await Api.get(`/api/soil-tests/${editId}`); } catch (e) {}
    }

    const today = new Date().toISOString().slice(0, 10);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${editId ? 'Edit' : 'Add'} Soil Test</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <form id="soilTestForm" class="app-form">
            <input type="hidden" name="property_id" value="${propertyId}">

            <div class="form-row">
              <div class="form-group">
                <label>Test Date *</label>
                <input type="date" name="test_date" value="${test.test_date || today}" required>
              </div>
              <div class="form-group">
                <label>Lab Name</label>
                <input type="text" name="lab_name" value="${this.esc(test.lab_name || '')}" placeholder="e.g. MSU Soil Lab">
              </div>
            </div>

            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--gray-500);margin:16px 0 8px;">Primary</div>

            <div class="form-row">
              <div class="form-group">
                <label>pH</label>
                <input type="number" name="ph" value="${test.ph || ''}" step="0.1" min="0" max="14" placeholder="e.g. 6.5">
              </div>
              <div class="form-group">
                <label>Buffer pH</label>
                <input type="number" name="buffer_ph" value="${test.buffer_ph || ''}" step="0.1" min="0" max="14">
              </div>
            </div>

            <div class="form-group">
              <label>Organic Matter %</label>
              <input type="number" name="organic_matter_pct" value="${test.organic_matter_pct || ''}" step="0.1" min="0" max="100" placeholder="e.g. 3.5">
            </div>

            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--gray-500);margin:16px 0 8px;">Nutrients (ppm)</div>

            <div class="form-row">
              <div class="form-group">
                <label>Nitrogen (N)</label>
                <input type="number" name="nitrogen_ppm" value="${test.nitrogen_ppm || ''}" step="0.1" min="0">
              </div>
              <div class="form-group">
                <label>Phosphorus (P)</label>
                <input type="number" name="phosphorus_ppm" value="${test.phosphorus_ppm || ''}" step="0.1" min="0">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Potassium (K)</label>
                <input type="number" name="potassium_ppm" value="${test.potassium_ppm || ''}" step="0.1" min="0">
              </div>
              <div class="form-group">
                <label>CEC</label>
                <input type="number" name="cec" value="${test.cec || ''}" step="0.1" min="0">
              </div>
            </div>

            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--gray-500);margin:16px 0 8px;">Secondary Nutrients (ppm)</div>

            <div class="form-row">
              <div class="form-group">
                <label>Calcium</label>
                <input type="number" name="calcium_ppm" value="${test.calcium_ppm || ''}" step="0.1" min="0">
              </div>
              <div class="form-group">
                <label>Magnesium</label>
                <input type="number" name="magnesium_ppm" value="${test.magnesium_ppm || ''}" step="0.1" min="0">
              </div>
            </div>

            <div class="form-group">
              <label>Sulfur</label>
              <input type="number" name="sulfur_ppm" value="${test.sulfur_ppm || ''}" step="0.1" min="0">
            </div>

            <div class="form-group">
              <label>Recommendations</label>
              <textarea name="recommendations" rows="3" placeholder="Lab recommendations...">${this.esc(test.recommendations || '')}</textarea>
            </div>

            <div class="form-group">
              <label>Notes</label>
              <textarea name="notes" rows="2" placeholder="Additional notes...">${this.esc(test.notes || '')}</textarea>
            </div>

            <button type="submit" class="btn btn-primary btn-full">${editId ? 'Save Changes' : 'Add Soil Test'}</button>
            ${editId ? `<button type="button" class="btn btn-danger btn-full" style="margin-top:8px;" onclick="PropertiesPage.deleteSoilTest(${editId}, ${propertyId})">Delete Test</button>` : ''}
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('soilTestForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData.entries());

      // Convert numeric fields
      ['ph', 'buffer_ph', 'organic_matter_pct', 'nitrogen_ppm', 'phosphorus_ppm', 'potassium_ppm',
       'calcium_ppm', 'magnesium_ppm', 'sulfur_ppm', 'cec'].forEach(f => {
        if (data[f]) data[f] = Number(data[f]);
      });

      try {
        if (editId) {
          await Api.put(`/api/soil-tests/${editId}`, data);
          App.toast('Soil test updated', 'success');
        } else {
          await Api.post('/api/soil-tests', data);
          App.toast('Soil test added', 'success');
        }
        overlay.remove();
        this.renderDetail(propertyId);
      } catch (err) {
        App.toast(err.message, 'error');
      }
    });
  },

  async deleteSoilTest(testId, propertyId) {
    if (!confirm('Delete this soil test? This cannot be undone.')) return;
    try {
      await Api.delete(`/api/soil-tests/${testId}`);
      App.toast('Soil test deleted', 'success');
      document.querySelector('.modal-overlay')?.remove();
      this.renderDetail(propertyId);
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  async showSoilTestDetail(testId) {
    try {
      const test = await Api.get(`/api/soil-tests/${testId}`);
      this.showSoilTestModal(test.property_id, testId);
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  uploadSoilReport(testId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('report', file);
      try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`/api/soil-tests/${testId}/upload`, {
          method: 'POST',
          headers: token ? { 'Authorization': 'Bearer ' + token } : {},
          body: formData
        });
        if (!resp.ok) throw new Error('Upload failed');
        App.toast('Lab report uploaded', 'success');
        if (this._currentPropertyId) this.renderDetail(this._currentPropertyId);
      } catch (err) {
        App.toast(err.message, 'error');
      }
    };
    input.click();
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }
};
