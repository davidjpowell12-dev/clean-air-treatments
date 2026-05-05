const PropertiesPage = {
  async render(action, id) {
    if (action === 'new' || action === 'edit') return this.renderForm(action === 'edit' ? id : null);
    if (action === 'view' && id) return this.renderDetail(id);
    if (action === 'import') return this.renderImport();
    if (action === 'tracker') return this.renderTracker();
    return this.renderList();
  },

  async renderList() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const showInactive = this._showInactive ? 1 : 0;
      const properties = await Api.get('/api/properties' + (showInactive ? '?include_inactive=1' : ''));
      const isAdmin = App.user.role === 'admin';

      main.innerHTML = `
        <div class="page-header">
          <h2>Properties</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${isAdmin ? '<button class="btn btn-sm btn-outline" onclick="App.navigate(\'properties\', \'tracker\')">📋 Tracker</button>' : ''}
            ${isAdmin ? '<button class="btn btn-sm btn-outline" onclick="App.navigate(\'properties\', \'import\')">Import CSV</button>' : ''}
            <button class="btn btn-primary btn-sm" onclick="App.navigate('properties', 'new')">+ Add</button>
          </div>
        </div>

        <div class="search-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="propSearch" placeholder="Search by name or address...">
        </div>

        ${isAdmin ? `
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--gray-600);margin-bottom:8px;cursor:pointer;">
            <input type="checkbox" id="showInactiveToggle" ${showInactive ? 'checked' : ''} onchange="PropertiesPage._toggleInactive(this.checked)">
            Show archived (inactive) properties
          </label>
        ` : ''}

        <div class="card">
          <div id="propList">
            ${properties.length === 0 ? `
              <div class="empty-state">
                <h3>No properties${showInactive ? '' : ' yet'}</h3>
                <p>${showInactive ? 'No properties match the filter' : 'Add your first property or import from CSV'}</p>
                ${showInactive ? '' : `<button class="btn btn-primary" onclick="App.navigate('properties', 'new')">Add Property</button>`}
              </div>
            ` : properties.map(p => {
              const inactive = p.is_active === 0;
              return `
              <div class="data-row" data-search="${this.esc(p.customer_name + ' ' + p.address + ' ' + (p.city || '')).toLowerCase()}" onclick="App.navigate('properties', 'view', ${p.id})" style="${inactive ? 'opacity:0.55;' : ''}">
                <div class="data-row-main">
                  <h4>${this.esc(p.customer_name)} ${inactive ? '<span class="badge badge-gray" style="font-size:10px;margin-left:6px;">archived</span>' : ''}</h4>
                  <p>${this.esc(p.address)}${p.city ? ', ' + this.esc(p.city) : ''} ${this.esc(p.state || '')} ${this.esc(p.zip || '')}</p>
                  <p style="font-size:12px;color:var(--gray-500);">${p.sqft ? p.sqft.toLocaleString() + ' sq ft' : ''}${p.soil_type ? ' · ' + this.esc(p.soil_type) : ''}</p>
                </div>
                <div class="data-row-right">
                  <svg viewBox="0 0 24 24" fill="none" stroke="var(--gray-300)" stroke-width="2" width="20" height="20"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              </div>
            `;}).join('')}
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
      const [overview, applications, ipmCases, scheduleRounds, soilTests, followUps] = await Promise.all([
        Api.get(`/api/properties/${id}/overview`),
        Api.get(`/api/properties/${id}/applications`),
        Api.get(`/api/properties/${id}/ipm-cases`),
        Api.get(`/api/schedules/property/${id}`).catch(() => []),
        Api.get(`/api/soil-tests/property/${id}`).catch(() => []),
        Api.get(`/api/follow-ups?property_id=${id}&status=open`).catch(() => [])
      ]);
      const prop = overview.property;
      const estimates = overview.estimates || [];
      const invoices = overview.invoices || [];
      const stats = prop.overview_stats || {};
      const isAdmin = App.user.role === 'admin';

      const zones = prop.zones || [];
      const zoneTotalSqft = zones.reduce((sum, z) => sum + (z.sqft || 0), 0);
      this._currentPropertyId = prop.id;
      this.currentDetailId = id; // used by FollowUpsPage to refresh

      main.innerHTML = `
        <span class="back-link" onclick="App.navigate('properties')">&larr; Properties</span>

        <div class="card">
          <div class="card-header">
            <h3>${this.esc(prop.customer_name)}</h3>
            ${isAdmin ? `
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-sm btn-outline" onclick="App.navigate('properties', 'edit', ${prop.id})">Edit</button>
                ${prop.is_active === 0
                  ? `<button class="btn btn-sm btn-outline" style="color:var(--green-dark);border-color:var(--green-dark);" onclick="PropertiesPage.toggleArchive(${prop.id}, true)">↺ Restore</button>`
                  : `<button class="btn btn-sm btn-outline" style="color:var(--gray-600);" onclick="PropertiesPage.toggleArchive(${prop.id}, false)">📦 Archive</button>`}
                <button class="btn btn-sm btn-danger" onclick="PropertiesPage.deleteProperty(${prop.id})">Delete</button>
              </div>
            ` : ''}
            ${prop.is_active === 0 ? `<div style="margin-top:8px;padding:8px 12px;background:var(--gray-100);border-radius:8px;font-size:12px;color:var(--gray-600);">📦 This property is archived — hidden from default lists. Click <strong>Restore</strong> to make it active again.</div>` : ''}
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

        ${this._renderOverviewStats(stats)}

        ${this._renderEstimatesSection(estimates, prop.id)}

        ${this._renderInvoicesSection(invoices)}

        <div class="card" style="margin-bottom:12px;">
          <div class="card-header">
            <h3 style="font-size:16px;">📋 Follow-ups ${followUps.length > 0 ? `<span style="color:var(--gray-500);font-weight:500;font-size:13px;">(${followUps.length})</span>` : ''}</h3>
            <button class="btn btn-sm btn-outline" onclick="FollowUpsPage.openCreate(${prop.id})">+ Add</button>
          </div>
          ${followUps.length === 0 ? `
            <div style="padding:16px;text-align:center;color:var(--gray-500);font-size:14px;">
              No open follow-ups for this customer.
            </div>
          ` : `
            <div>
              ${followUps.map(f => {
                const waitingBadge = f.waiting_on === 'customer'
                  ? '<span class="badge badge-blue" style="font-size:10px;">Waiting</span>'
                  : '<span class="badge badge-orange" style="font-size:10px;">On me</span>';
                return `
                  <div class="data-row">
                    <div class="data-row-main" onclick="FollowUpsPage.openEdit(${f.id})" style="cursor:pointer;">
                      <h4>${f.pinned ? '📌 ' : ''}${this.esc(f.title)}</h4>
                      ${f.notes ? `<p style="font-size:13px;color:var(--gray-700);">${this.esc(f.notes.slice(0, 80))}${f.notes.length > 80 ? '…' : ''}</p>` : ''}
                      <div style="margin-top:4px;display:flex;gap:6px;align-items:center;">${waitingBadge}<span style="font-size:11px;color:var(--gray-500);">${f.bucket === 'today' ? '🔥 Today' : f.bucket === 'this_week' ? '📆 Week' : '💭 Someday'}</span></div>
                    </div>
                    <div class="data-row-right">
                      <button class="btn-icon fu-done-btn" onclick="event.stopPropagation();FollowUpsPage.complete(${f.id})" title="Mark done">✓</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
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

          // Group by service type
          const svcGroups = {};
          scheduleRounds.forEach(r => {
            const svc = r.service_type || 'Scheduled Visit';
            if (!svcGroups[svc]) svcGroups[svc] = [];
            svcGroups[svc].push(r);
          });

          const svcColorMap = (svc) => {
            const lower = svc.toLowerCase();
            if (lower.includes('fert') || lower.includes('weed')) return { bg: '#e8f5d8', text: '#3d7a0f', border: '#78be20' };
            if (lower.includes('mosquito') || lower.includes('tick')) return { bg: '#ede9fe', text: '#5b21b6', border: '#7c3aed' };
            if (lower.includes('aerat') || lower.includes('seed') || lower.includes('compost') || lower.includes('topdress')) return { bg: '#fef3c7', text: '#92400e', border: '#f59e0b' };
            return { bg: '#dbeafe', text: '#1e40af', border: '#3b82f6' };
          };

          return `
            <div class="card" style="margin-bottom:12px;">
              <div class="card-header"><h3 style="font-size:16px;">Season Schedule</h3><span class="badge ${done === total ? 'badge-green' : 'badge-blue'}">${done}/${total} complete</span></div>
              <div class="card-body">
                <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>

                ${Object.entries(svcGroups).map(([svc, rounds]) => {
                  const c = svcColorMap(svc);
                  const svcDone = rounds.filter(r => r.status === 'completed').length;
                  return `
                    <div style="margin-top:14px;border-left:4px solid ${c.border};padding-left:12px;">
                      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-weight:700;font-size:14px;color:${c.text};">${this.esc(svc)}</span>
                        <span style="font-size:12px;color:var(--gray-500);">${svcDone}/${rounds.length}</span>
                      </div>
                      <div style="display:flex;flex-wrap:wrap;gap:6px;">
                        ${rounds.map(r => {
                          const d = new Date(r.scheduled_date + 'T12:00:00');
                          const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                          const isOverdue = r.status === 'scheduled' && r.scheduled_date < today;
                          const bgColor = r.status === 'completed' ? '#dcf5c8' : r.status === 'skipped' ? 'var(--gray-100)' : isOverdue ? '#fdd' : c.bg;
                          const txtColor = r.status === 'completed' ? '#2d6a1e' : r.status === 'skipped' ? 'var(--gray-500)' : isOverdue ? '#b91c1c' : c.text;
                          const icon = r.status === 'completed' ? '✓ ' : r.status === 'skipped' ? '— ' : isOverdue ? '! ' : '';
                          return `<div style="background:${bgColor};color:${txtColor};padding:4px 10px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;" onclick="App.navigate('scheduling')" title="${r.status}${isOverdue ? ' (overdue)' : ''}">
                            ${icon}${r.round_number ? 'R' + r.round_number + ' ' : ''}${dateStr}
                          </div>`;
                        }).join('')}
                      </div>
                    </div>
                  `;
                }).join('')}
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

  // Migration tracker — at-a-glance view of which properties still need an
  // estimate or invoice. Useful during the migration push and as a long-term
  // data-health view (annual renewals, new client onboarding).
  async renderTracker() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const data = await Api.get('/api/properties/migration-status');
      const rows = data.rows || [];
      const s = data.summary || {};

      main.innerHTML = `
        <span class="back-link" onclick="App.navigate('properties')">&larr; Properties</span>
        <div class="page-header" style="margin-top:8px;">
          <h2>📋 Migration Tracker</h2>
        </div>

        <div class="card" style="padding:16px;margin-bottom:12px;">
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
            <div style="padding:10px;background:var(--gray-50);border-radius:8px;">
              <div style="font-size:11px;color:var(--gray-500);text-transform:uppercase;font-weight:600;">Total Properties</div>
              <div style="font-size:24px;font-weight:700;">${s.total || 0}</div>
            </div>
            <div style="padding:10px;background:#ecfdf5;border-radius:8px;">
              <div style="font-size:11px;color:#047857;text-transform:uppercase;font-weight:600;">Fully Set Up</div>
              <div style="font-size:24px;font-weight:700;color:#047857;">${s.fully_setup || 0}</div>
            </div>
            <div style="padding:10px;background:#fef3c7;border-radius:8px;">
              <div style="font-size:11px;color:#92400e;text-transform:uppercase;font-weight:600;">Has Estimate</div>
              <div style="font-size:24px;font-weight:700;color:#92400e;">${s.estimate_accepted || 0}</div>
            </div>
            <div style="padding:10px;background:#fee2e2;border-radius:8px;">
              <div style="font-size:11px;color:#991b1b;text-transform:uppercase;font-weight:600;">No Estimate Yet</div>
              <div style="font-size:24px;font-weight:700;color:#991b1b;">${s.no_estimate || 0}</div>
            </div>
          </div>
          ${s.total > 0 ? `
            <div style="margin-top:12px;">
              <div style="height:8px;background:var(--gray-200);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${Math.round((s.fully_setup / s.total) * 100)}%;background:#10b981;transition:width 0.3s;"></div>
              </div>
              <div style="font-size:12px;color:var(--gray-500);margin-top:4px;text-align:center;">
                ${Math.round((s.fully_setup / s.total) * 100)}% complete · ${s.fully_setup} of ${s.total}
              </div>
            </div>
          ` : ''}
        </div>

        <div class="search-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="trackSearch" placeholder="Search by name or address...">
        </div>

        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
          <button class="btn btn-sm chip-btn active" data-filter="all">All (${rows.length})</button>
          <button class="btn btn-sm chip-btn" data-filter="incomplete">⚠️ Incomplete (${rows.filter(r => !(r.estimate_status === 'accepted' && r.invoice_count > 0)).length})</button>
          <button class="btn btn-sm chip-btn" data-filter="no-estimate">🔴 No Estimate (${rows.filter(r => !r.estimate_status).length})</button>
          <button class="btn btn-sm chip-btn" data-filter="estimate-no-invoice">🟡 Estimate, No Invoice (${rows.filter(r => r.estimate_status === 'accepted' && r.invoice_count === 0).length})</button>
          <button class="btn btn-sm chip-btn" data-filter="complete">✅ Complete (${rows.filter(r => r.estimate_status === 'accepted' && r.invoice_count > 0).length})</button>
        </div>

        <div class="card">
          <div id="trackList">
            ${rows.length === 0 ? `
              <div class="empty-state"><h3>No properties</h3></div>
            ` : rows.map(r => this._renderTrackerRow(r)).join('')}
          </div>
        </div>

        <style>
          .chip-btn { background:#fff;border:1px solid var(--gray-300);color:var(--gray-700);font-size:12px;padding:6px 10px;border-radius:14px;cursor:pointer; }
          .chip-btn.active { background:var(--green);color:#fff;border-color:var(--green); }
          .track-row { display:flex;align-items:center;gap:10px;padding:12px;border-bottom:1px solid var(--gray-100); }
          .track-row:last-child { border-bottom:none; }
          .track-main { flex:1;min-width:0; }
          .track-main h4 { margin:0 0 2px;font-size:14px; }
          .track-main p { margin:0;font-size:12px;color:var(--gray-500); }
          .track-badge { display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;margin-right:4px; }
          .b-green { background:#d1fae5;color:#065f46; }
          .b-yellow { background:#fef3c7;color:#92400e; }
          .b-red { background:#fee2e2;color:#991b1b; }
          .b-gray { background:var(--gray-100);color:var(--gray-600); }
          .track-action { font-size:12px;font-weight:600;color:var(--green);text-decoration:none;white-space:nowrap; }
        </style>
      `;

      const allRows = Array.from(document.querySelectorAll('#trackList .track-row'));
      const applyFilters = () => {
        const q = (document.getElementById('trackSearch').value || '').toLowerCase();
        const filter = document.querySelector('.chip-btn.active')?.dataset.filter || 'all';
        allRows.forEach(el => {
          const matchSearch = !q || (el.dataset.search || '').includes(q);
          let matchFilter = true;
          const status = el.dataset.status;
          if (filter === 'incomplete') matchFilter = status !== 'complete';
          else if (filter === 'no-estimate') matchFilter = status === 'no-estimate';
          else if (filter === 'estimate-no-invoice') matchFilter = status === 'estimate-no-invoice';
          else if (filter === 'complete') matchFilter = status === 'complete';
          el.style.display = (matchSearch && matchFilter) ? '' : 'none';
        });
      };

      document.getElementById('trackSearch').addEventListener('input', applyFilters);
      document.querySelectorAll('.chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          applyFilters();
        });
      });
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  _renderTrackerRow(r) {
    let status = 'complete';
    let estBadge, invBadge, action;

    if (r.estimate_status === 'accepted') {
      estBadge = '<span class="track-badge b-green">✅ Estimate</span>';
    } else if (r.estimate_status === 'sent') {
      estBadge = '<span class="track-badge b-yellow">🟡 Sent</span>';
      status = 'no-estimate';
    } else if (r.estimate_status === 'draft') {
      estBadge = '<span class="track-badge b-yellow">📝 Draft</span>';
      status = 'no-estimate';
    } else {
      estBadge = '<span class="track-badge b-red">🔴 No Est</span>';
      status = 'no-estimate';
    }

    if (r.invoice_count > 0) {
      const paid = r.paid_count || 0;
      const unpaid = r.unpaid_count || 0;
      invBadge = `<span class="track-badge b-green">💰 ${r.invoice_count} inv${paid ? ` (${paid} paid)` : ''}</span>`;
    } else {
      invBadge = '<span class="track-badge b-red">🔴 No Inv</span>';
      if (status === 'complete') status = 'estimate-no-invoice';
    }

    if (!r.estimate_status) {
      action = `<a class="track-action" onclick="App.navigate('estimates', 'new')">+ Estimate</a>`;
    } else if (r.estimate_status !== 'accepted') {
      action = `<a class="track-action" onclick="App.navigate('estimates', 'view', ${r.estimate_id})">Review →</a>`;
    } else if (r.invoice_count === 0) {
      action = `<a class="track-action" onclick="App.navigate('estimates', 'view', ${r.estimate_id})">Generate Inv →</a>`;
    } else {
      action = `<a class="track-action" onclick="App.navigate('properties', 'view', ${r.id})">View →</a>`;
    }

    const search = this.esc(((r.customer_name || '') + ' ' + (r.address || '') + ' ' + (r.city || '')).toLowerCase());
    return `
      <div class="track-row" data-search="${search}" data-status="${status}">
        <div class="track-main">
          <h4>${this.esc(r.customer_name || '(no name)')}</h4>
          <p>${this.esc(r.address || '')}${r.city ? ', ' + this.esc(r.city) : ''}</p>
          <div style="margin-top:6px;">${estBadge}${invBadge}</div>
        </div>
        ${action}
      </div>
    `;
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

  _toggleInactive(checked) {
    this._showInactive = !!checked;
    this.renderList();
  },

  // Soft archive / restore. Property stays in DB so historical applications,
  // license records, and profitability lookback all continue to work.
  async toggleArchive(id, restore) {
    const willArchive = !restore;
    const verb = willArchive ? 'Archive' : 'Restore';
    if (!confirm(`${verb} this property?\n\n${willArchive ? 'It will be hidden from default lists but kept in the database for historical records.' : 'It will reappear in the default Properties list.'}`)) return;
    try {
      await Api.put(`/api/properties/${id}/active`, { is_active: restore ? 1 : 0 });
      App.toast(willArchive ? 'Property archived' : 'Property restored', 'success');
      this.renderDetail(id);
    } catch (err) {
      App.toast('Failed: ' + err.message, 'error');
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
    const t = tests[0]; // newest first
    const phPct = t.ph ? Math.max(0, Math.min(100, ((t.ph - 4) / 6) * 100)) : null;

    const hasData = t.ph || t.calcium_lbs_acre || t.potassium_lbs_acre || t.organic_matter_pct ||
      t.cec || t.base_sat_calcium_pct || t.boron_ppm || t.sulfur_ppm || t.phosphorus_lbs_acre || t.nitrogen_ppm;

    // Cation bar helper: found vs desired
    const cationBar = (label, color, found, desired) => {
      if (found == null) return '';
      const pct = desired ? Math.min(100, (found / desired) * 100) : 50;
      const deficit = desired ? found - desired : null;
      const deficitColor = deficit != null ? (deficit >= 0 ? 'var(--green-dark)' : 'var(--red)') : '';
      return `<div class="soil-cation-row">
        <span class="soil-cation-label" style="color:${color};">${label}</span>
        <div class="soil-cation-bar-wrap">
          <div class="soil-bar-track"><div class="soil-bar-fill" style="width:${pct}%;background:${color};"></div></div>
          ${desired ? `<div class="soil-cation-meta"><span>${found.toLocaleString()}</span><span style="color:var(--gray-400);">/ ${desired.toLocaleString()}</span></div>` : `<div class="soil-cation-meta"><span>${found.toLocaleString()}</span></div>`}
        </div>
        ${deficit != null ? `<span class="soil-cation-deficit" style="color:${deficitColor};">${deficit >= 0 ? '+' : ''}${deficit.toLocaleString()}</span>` : `<span class="soil-cation-deficit">${found.toLocaleString()}</span>`}
      </div>`;
    };

    // Base saturation bar segment helper
    const baseSatData = [
      { label: 'Ca', pct: t.base_sat_calcium_pct, color: '#3182ce', ideal: '60-70%' },
      { label: 'Mg', pct: t.base_sat_magnesium_pct, color: '#38a169', ideal: '10-20%' },
      { label: 'K', pct: t.base_sat_potassium_pct, color: '#dd6b20', ideal: '2-5%' },
      { label: 'Na', pct: t.base_sat_sodium_pct, color: '#e53e3e', ideal: '0.5-3%' },
      { label: 'H', pct: t.base_sat_hydrogen_pct, color: '#805ad5', ideal: '10-15%' },
      { label: 'Other', pct: t.base_sat_other_pct, color: '#a0aec0', ideal: '' }
    ].filter(b => b.pct != null);

    return `
      <div class="soil-summary">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <span style="font-size:12px;color:var(--gray-500);">${t.test_date}${t.lab_name ? ' &middot; ' + this.esc(t.lab_name) : ''}${t.lab_number ? ' #' + this.esc(t.lab_number) : ''}</span>
          <button class="btn btn-sm btn-outline" style="font-size:11px;padding:2px 8px;" onclick="PropertiesPage.showSoilTestModal(${t.property_id}, ${t.id})">Edit</button>
        </div>

        ${!hasData ? `
          <div style="text-align:center;padding:20px 12px;background:var(--gray-50);border-radius:10px;margin:8px 0;">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" stroke-width="1.5" width="36" height="36" style="margin-bottom:8px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 6v6l4 2"/></svg>
            <h4 style="margin:0 0 4px;color:var(--gray-700);font-size:15px;">Lab results not entered yet</h4>
            <p style="margin:0 0 12px;font-size:13px;color:var(--gray-500);line-height:1.4;">Tap Edit to enter values from your lab report to see visual charts.</p>
            <button class="btn btn-sm btn-primary" onclick="PropertiesPage.showSoilTestModal(${t.property_id}, ${t.id})">Enter Lab Results</button>
          </div>
        ` : ''}

        ${t.ph ? `
          <div class="soil-section-title">pH</div>
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:4px;">
            <span class="soil-ph-value ${this.phColor(t.ph)}">${t.ph}</span>
            <span style="font-size:13px;color:var(--gray-500);">${this.phLabel(t.ph)}</span>
          </div>
          <div style="position:relative;margin-bottom:8px;">
            <div class="soil-ph-gauge"><div class="soil-ph-marker" style="left:${phPct}%;"></div></div>
            <div class="soil-ph-labels"><span>4.0</span><span style="color:var(--green-dark);font-weight:600;">6.0–7.0</span><span>10.0</span></div>
          </div>
        ` : ''}

        ${(t.organic_matter_pct || t.cec || t.sulfur_ppm || t.phosphorus_lbs_acre || t.nitrogen_ppm) ? `
          <div class="soil-section-title">Primary Results</div>
          <div class="soil-detail-grid">
            ${t.organic_matter_pct != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Organic Matter</span><span class="soil-detail-value">${t.organic_matter_pct}%</span></div>` : ''}
            ${t.cec != null ? `<div class="soil-detail-item"><span class="soil-detail-label">CEC (M.E.)</span><span class="soil-detail-value">${t.cec}</span></div>` : ''}
            ${t.nitrogen_ppm != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Nitrogen</span><span class="soil-detail-value">${t.nitrogen_ppm} ppm</span></div>` : ''}
            ${t.sulfur_ppm != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Sulfur</span><span class="soil-detail-value">${t.sulfur_ppm} ppm</span></div>` : ''}
            ${t.phosphorus_lbs_acre != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Phosphorus (P₂O₅)</span><span class="soil-detail-value">${t.phosphorus_lbs_acre} lbs/ac</span></div>` : ''}
            ${t.buffer_ph != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Buffer pH</span><span class="soil-detail-value">${t.buffer_ph}</span></div>` : ''}
            ${t.sample_depth_inches != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Sample Depth</span><span class="soil-detail-value">${t.sample_depth_inches}"</span></div>` : ''}
          </div>
        ` : ''}

        ${(t.calcium_lbs_acre != null || t.magnesium_lbs_acre != null || t.potassium_lbs_acre != null) ? `
          <div class="soil-section-title">Exchangeable Cations <span style="font-weight:400;color:var(--gray-400);">lbs/acre</span></div>
          <div style="font-size:11px;color:var(--gray-400);display:flex;justify-content:space-between;padding:0 0 4px;margin-top:-2px;">
            <span>Found vs Desired</span><span>Deficit</span>
          </div>
          <div class="soil-cation-group">
            ${cationBar('Ca', '#3182ce', t.calcium_lbs_acre, t.calcium_desired_lbs_acre)}
            ${cationBar('Mg', '#38a169', t.magnesium_lbs_acre, t.magnesium_desired_lbs_acre)}
            ${cationBar('K', '#dd6b20', t.potassium_lbs_acre, t.potassium_desired_lbs_acre)}
            ${t.sodium_lbs_acre != null ? cationBar('Na', '#e53e3e', t.sodium_lbs_acre, null) : ''}
          </div>
        ` : ''}

        ${baseSatData.length > 0 ? `
          <div class="soil-section-title">Base Saturation %</div>
          <div class="soil-basesat-bar">
            ${baseSatData.map(b => `<div class="soil-basesat-seg" style="width:${Math.max(b.pct, 2)}%;background:${b.color};" title="${b.label}: ${b.pct}%"></div>`).join('')}
          </div>
          <div class="soil-basesat-legend">
            ${baseSatData.map(b => `<span class="soil-basesat-item"><span class="soil-basesat-dot" style="background:${b.color};"></span>${b.label} ${b.pct}%${b.ideal ? ` <span style="color:var(--gray-400);">(${b.ideal})</span>` : ''}</span>`).join('')}
          </div>
        ` : ''}

        ${(t.boron_ppm != null || t.iron_ppm != null || t.manganese_ppm != null || t.copper_ppm != null || t.zinc_ppm != null || t.aluminum_ppm != null) ? `
          <div class="soil-section-title">Trace Elements <span style="font-weight:400;color:var(--gray-400);">ppm</span></div>
          <div class="soil-detail-grid soil-detail-grid-3">
            ${t.boron_ppm != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Boron</span><span class="soil-detail-value">${t.boron_ppm}</span></div>` : ''}
            ${t.iron_ppm != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Iron</span><span class="soil-detail-value">${t.iron_ppm}</span></div>` : ''}
            ${t.manganese_ppm != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Manganese</span><span class="soil-detail-value">${t.manganese_ppm}</span></div>` : ''}
            ${t.copper_ppm != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Copper</span><span class="soil-detail-value">${t.copper_ppm}</span></div>` : ''}
            ${t.zinc_ppm != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Zinc</span><span class="soil-detail-value">${t.zinc_ppm}</span></div>` : ''}
            ${t.aluminum_ppm != null ? `<div class="soil-detail-item"><span class="soil-detail-label">Aluminum</span><span class="soil-detail-value">${t.aluminum_ppm}</span></div>` : ''}
          </div>
        ` : ''}

        ${t.recommendations ? `
          <div class="soil-section-title">Recommendations</div>
          <p style="font-size:14px;color:var(--gray-700);line-height:1.5;">${this.esc(t.recommendations)}</p>
        ` : ''}

        ${t.file_path ? `
          <a href="/api/soil-tests/${t.id}/report" target="_blank" class="btn btn-outline btn-full" style="margin-top:12px;gap:6px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            View Lab Report
          </a>
        ` : `
          <button class="btn btn-outline btn-full" style="margin-top:12px;gap:6px;" onclick="PropertiesPage.uploadSoilReport(${t.id})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload Lab Report
          </button>
        `}

        ${tests.length > 1 ? `
          <div class="soil-section-title" style="margin-top:16px;">Previous Tests</div>
          ${tests.slice(1).map(prev => `
            <div class="soil-history-row" onclick="PropertiesPage.showSoilTestDetail(${prev.id})">
              <div class="soil-history-info">
                <span class="soil-history-date">${prev.test_date}</span>
                <span class="soil-history-lab">${this.esc(prev.lab_name || 'Unknown lab')}</span>
              </div>
              ${prev.ph ? `<span class="soil-history-ph ${this.phColor(prev.ph)}">${prev.ph}</span>` : ''}
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

  _soilNumericFields: [
    'sample_depth_inches', 'ph', 'buffer_ph', 'organic_matter_pct', 'cec',
    'nitrogen_ppm', 'sulfur_ppm', 'phosphorus_lbs_acre',
    'calcium_lbs_acre', 'calcium_desired_lbs_acre',
    'magnesium_lbs_acre', 'magnesium_desired_lbs_acre',
    'potassium_lbs_acre', 'potassium_desired_lbs_acre',
    'sodium_lbs_acre',
    'base_sat_calcium_pct', 'base_sat_magnesium_pct',
    'base_sat_potassium_pct', 'base_sat_sodium_pct',
    'base_sat_other_pct', 'base_sat_hydrogen_pct',
    'boron_ppm', 'iron_ppm', 'manganese_ppm',
    'copper_ppm', 'zinc_ppm', 'aluminum_ppm'
  ],

  _sfv(test, f) { return test[f] != null && test[f] !== '' ? test[f] : ''; },

  async showSoilTestModal(propertyId, editId) {
    let test = {};
    if (editId) {
      try { test = await Api.get(`/api/soil-tests/${editId}`); } catch (e) {}
    }

    const today = new Date().toISOString().slice(0, 10);
    const v = (f) => this._sfv(test, f);
    const sect = (title) => `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--gray-500);margin:16px 0 8px;">${title}</div>`;
    const nf = (name, label, placeholder) => `<div class="form-group"><label>${label}</label><input type="number" name="${name}" value="${v(name)}" step="0.01" min="0" ${placeholder ? 'placeholder="'+placeholder+'"' : ''}></div>`;

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
              <div class="form-group"><label>Test Date *</label><input type="date" name="test_date" value="${test.test_date || today}" required></div>
              <div class="form-group"><label>Lab Name</label><input type="text" name="lab_name" value="${this.esc(test.lab_name || '')}" placeholder="e.g. Logan Labs"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Lab Number</label><input type="text" name="lab_number" value="${this.esc(test.lab_number || '')}"></div>
              ${nf('sample_depth_inches', 'Sample Depth (in)', '6')}
            </div>

            ${sect('Primary Results')}
            <div class="form-row">
              ${nf('ph', 'pH', '6.7')}
              ${nf('buffer_ph', 'Buffer pH', '')}
            </div>
            <div class="form-row">
              ${nf('cec', 'CEC (M.E.)', '19.24')}
              ${nf('organic_matter_pct', 'Organic Matter %', '7.7')}
            </div>

            ${sect('Anions / Macro Nutrients')}
            <div class="form-row">
              ${nf('nitrogen_ppm', 'Nitrogen (ppm)', '25')}
              ${nf('sulfur_ppm', 'Sulfur (ppm)', '15')}
            </div>
            <div class="form-row">
              ${nf('phosphorus_lbs_acre', 'Phosphorus P₂O₅ (lbs/ac)', '110')}
              <div class="form-group"></div>
            </div>

            ${sect('Exchangeable Cations (lbs/acre)')}
            <div style="font-size:11px;color:var(--gray-400);margin-bottom:4px;">Enter Desired Value and Value Found from your report</div>
            <div class="form-row">
              ${nf('calcium_desired_lbs_acre', 'Ca Desired', '5232')}
              ${nf('calcium_lbs_acre', 'Ca Found', '5724')}
            </div>
            <div class="form-row">
              ${nf('magnesium_desired_lbs_acre', 'Mg Desired', '553')}
              ${nf('magnesium_lbs_acre', 'Mg Found', '679')}
            </div>
            <div class="form-row">
              ${nf('potassium_desired_lbs_acre', 'K Desired', '600')}
              ${nf('potassium_lbs_acre', 'K Found', '181')}
            </div>
            <div class="form-row">
              ${nf('sodium_lbs_acre', 'Sodium (lbs/ac)', '43')}
              <div class="form-group"></div>
            </div>

            ${sect('Base Saturation %')}
            <div class="form-row">
              ${nf('base_sat_calcium_pct', 'Calcium %', '74.39')}
              ${nf('base_sat_magnesium_pct', 'Magnesium %', '14.71')}
            </div>
            <div class="form-row">
              ${nf('base_sat_potassium_pct', 'Potassium %', '1.21')}
              ${nf('base_sat_sodium_pct', 'Sodium %', '0.49')}
            </div>
            <div class="form-row">
              ${nf('base_sat_other_pct', 'Other Bases %', '4.70')}
              ${nf('base_sat_hydrogen_pct', 'Exch. Hydrogen %', '4.50')}
            </div>

            ${sect('Trace Elements (ppm)')}
            <div class="form-row">
              ${nf('boron_ppm', 'Boron', '0.69')}
              ${nf('iron_ppm', 'Iron', '232')}
            </div>
            <div class="form-row">
              ${nf('manganese_ppm', 'Manganese', '28')}
              ${nf('copper_ppm', 'Copper', '3.59')}
            </div>
            <div class="form-row">
              ${nf('zinc_ppm', 'Zinc', '3.49')}
              ${nf('aluminum_ppm', 'Aluminum', '453')}
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
      this._soilNumericFields.forEach(f => {
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
  },

  // ─── Customer 360° overview sections ──────────────────────────────
  // Three helpers that render the Summary / Estimates / Invoices cards
  // on the property detail page. All data comes from the new
  // /api/properties/:id/overview endpoint.

  _renderOverviewStats(stats) {
    // Quick health read — season total, outstanding, paid, last visit,
    // next visit, plan. Only render if there's anything meaningful to show.
    if (!stats || (!stats.season_total && !stats.outstanding && !stats.paid && !stats.last_visit_date && !stats.next_visit_date)) {
      return '';
    }
    const fmt = (v) => '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const fmtDate = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    const planLabel = stats.payment_plan === 'monthly' ? 'Monthly'
                   : stats.payment_plan === 'per_service' ? 'Per Service'
                   : stats.payment_plan === 'full' ? 'Pay in Full'
                   : '—';
    return `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header" style="padding:10px 14px;"><h3 style="font-size:14px;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;margin:0;">Customer Overview</h3></div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--gray-100);">
          <div style="background:white;padding:12px 14px;">
            <div style="font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Season Total</div>
            <div style="font-size:18px;font-weight:700;color:var(--navy,var(--blue));margin-top:2px;">${fmt(stats.season_total)}</div>
          </div>
          <div style="background:white;padding:12px 14px;">
            <div style="font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Outstanding</div>
            <div style="font-size:18px;font-weight:700;color:${stats.outstanding > 0 ? 'var(--orange)' : 'var(--gray-400)'};margin-top:2px;">${fmt(stats.outstanding)}</div>
          </div>
          <div style="background:white;padding:12px 14px;">
            <div style="font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Paid</div>
            <div style="font-size:18px;font-weight:700;color:${stats.paid > 0 ? 'var(--green-dark,#2d6a1e)' : 'var(--gray-400)'};margin-top:2px;">${fmt(stats.paid)}</div>
          </div>
          <div style="background:white;padding:12px 14px;">
            <div style="font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Last Visit</div>
            <div style="font-size:14px;font-weight:600;color:var(--gray-800);margin-top:2px;">${fmtDate(stats.last_visit_date)}</div>
          </div>
          <div style="background:white;padding:12px 14px;">
            <div style="font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Next Visit</div>
            <div style="font-size:14px;font-weight:600;color:var(--gray-800);margin-top:2px;">${fmtDate(stats.next_visit_date)}${stats.next_visit_service ? '<br><span style="font-size:11px;color:var(--gray-500);font-weight:400;">' + this.esc(stats.next_visit_service) + '</span>' : ''}</div>
          </div>
          <div style="background:white;padding:12px 14px;">
            <div style="font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Plan</div>
            <div style="font-size:14px;font-weight:600;color:var(--gray-800);margin-top:2px;">${planLabel}${stats.payment_method ? '<br><span style="font-size:11px;color:var(--gray-500);font-weight:400;text-transform:capitalize;">' + this.esc(stats.payment_method) + '</span>' : ''}</div>
          </div>
        </div>
      </div>
    `;
  },

  _renderEstimatesSection(estimates, propertyId) {
    const statusConfig = {
      draft: { label: 'Draft', class: 'badge-gray' },
      sent: { label: 'Sent', class: 'badge-blue' },
      viewed: { label: 'Viewed', class: 'badge-orange' },
      accepted: { label: 'Accepted', class: 'badge-green' },
      declined: { label: 'Declined', class: 'badge-red' },
      expired: { label: 'Expired', class: 'badge-gray' }
    };
    const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    return `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header">
          <h3 style="font-size:16px;">📄 Estimates ${estimates.length > 0 ? `<span style="color:var(--gray-500);font-weight:500;font-size:13px;">(${estimates.length})</span>` : ''}</h3>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('estimates', 'new');EstimatesPage._currentProperty={id:${propertyId}};" title="Start a new estimate for this customer">+ New</button>
        </div>
        ${estimates.length === 0 ? `
          <div style="padding:16px;text-align:center;color:var(--gray-500);font-size:14px;">
            No estimates yet for this customer.
          </div>
        ` : `
          <div>
            ${estimates.map(e => {
              const s = statusConfig[e.status] || statusConfig.draft;
              const dateLabel = e.accepted_at ? 'Accepted ' + fmtDate(e.accepted_at)
                              : e.sent_at ? 'Sent ' + fmtDate(e.sent_at)
                              : 'Created ' + fmtDate(e.created_at);
              return `
                <div class="data-row" style="cursor:pointer;" onclick="App.navigate('estimates','view',${e.id})">
                  <div class="data-row-main">
                    <h4>$${Number(e.total_price || 0).toFixed(0)}${e.status === 'accepted' && e.monthly_price ? ` <span style="font-weight:400;color:var(--gray-500);font-size:13px;">· $${Number(e.monthly_price).toFixed(0)}/mo</span>` : ''}</h4>
                    ${e.services_summary ? `<p style="color:var(--gray-700);font-size:13px;">${this.esc(e.services_summary)}</p>` : ''}
                    <p style="color:var(--gray-500);font-size:12px;margin-top:2px;">${dateLabel}</p>
                  </div>
                  <div class="data-row-right">
                    <span class="badge ${s.class}">${s.label}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;
  },

  _renderInvoicesSection(invoices) {
    if (!invoices.length) {
      return `
        <div class="card" style="margin-bottom:12px;">
          <div class="card-header"><h3 style="font-size:16px;">💵 Invoices</h3></div>
          <div style="padding:16px;text-align:center;color:var(--gray-500);font-size:14px;">
            No invoices yet. Generated automatically when an estimate is accepted.
          </div>
        </div>
      `;
    }

    // Group by estimate_id so we can show "Monthly · 2 of 8 paid" per plan
    const groups = new Map();
    for (const inv of invoices) {
      const key = inv.estimate_id || 'unlinked';
      if (!groups.has(key)) groups.set(key, { estimate_id: inv.estimate_id, plan: inv.payment_plan, items: [] });
      groups.get(key).items.push(inv);
    }
    const today = new Date().toISOString().slice(0, 10);

    const groupHtml = Array.from(groups.values()).filter(g => {
      // Hide groups where every invoice is void — these are ghost/duplicate
      // estimate sets that have been cleaned up. No point showing them.
      return g.items.some(i => i.status !== 'void');
    }).map(g => {
      const paid = g.items.filter(i => i.status === 'paid').length;
      const total = g.items.length;
      const outstandingCents = g.items.reduce((s, i) =>
        s + ((i.status !== 'paid' && i.status !== 'void') ? (i.amount_cents || 0) : 0), 0);
      const planLabel = g.plan === 'monthly' ? `Monthly · ${paid} of ${total} paid`
                     : g.plan === 'per_service' ? `Per Service · ${paid} of ${total} paid`
                     : g.plan === 'full' ? `Pay in Full · ${paid === total ? 'Paid' : 'Outstanding'}`
                     : `${total} invoice${total === 1 ? '' : 's'}`;
      const rows = g.items.map(inv => {
        const overdue = (inv.status === 'pending' || inv.status === 'failed') && inv.due_date && inv.due_date < today;
        const statusClass = inv.status === 'paid' ? 'badge-green'
                          : inv.status === 'void' ? 'badge-gray'
                          : inv.status === 'failed' ? 'badge-red'
                          : overdue ? 'badge-red'
                          : inv.status === 'scheduled' ? 'badge-muted'
                          : 'badge-orange';
        const statusLabel = inv.status === 'paid' ? 'Paid'
                          : inv.status === 'void' ? 'Void'
                          : inv.status === 'failed' ? 'Failed'
                          : overdue ? 'Overdue'
                          : inv.status === 'scheduled' ? 'Scheduled'
                          : 'Pending';
        const dueStr = inv.due_date ? new Date(inv.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        const installment = inv.total_installments ? ` · ${inv.installment_number}/${inv.total_installments}` : '';
        return `
          <div class="data-row" style="cursor:pointer;padding:10px 14px;" onclick="App.navigate('invoicing','view',${inv.id})">
            <div class="data-row-main">
              <h4 style="font-family:monospace;font-size:13px;letter-spacing:0.5px;">${this.esc(inv.invoice_number)}${installment}</h4>
              <p style="color:var(--gray-500);font-size:12px;">${inv.status === 'paid' && inv.paid_at ? 'Paid ' + new Date(inv.paid_at).toLocaleDateString() : dueStr ? 'Due ' + dueStr : ''}</p>
            </div>
            <div class="data-row-right" style="display:flex;gap:8px;align-items:center;">
              <span style="font-weight:600;">$${((inv.amount_cents || 0) / 100).toFixed(2)}</span>
              <span class="badge ${statusClass}" style="font-size:11px;">${statusLabel}</span>
            </div>
          </div>
        `;
      }).join('');

      const groupId = 'inv-group-' + (g.estimate_id || 'unlinked');
      return `
        <div style="border-top:1px solid var(--gray-100);">
          <div onclick="const b=document.getElementById('${groupId}');b.style.display=b.style.display==='none'?'':'none';" style="padding:12px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;background:var(--gray-50);">
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--navy,var(--blue));">${planLabel}</div>
              ${outstandingCents > 0 ? `<div style="font-size:12px;color:var(--orange);margin-top:2px;">$${(outstandingCents/100).toFixed(2)} outstanding</div>` : ''}
            </div>
            <span style="color:var(--gray-400);font-size:12px;">▾</span>
          </div>
          <div id="${groupId}" style="display:none;">
            ${rows}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><h3 style="font-size:16px;">💵 Invoices <span style="color:var(--gray-500);font-weight:500;font-size:13px;">(${invoices.length})</span></h3></div>
        ${groupHtml}
      </div>
    `;
  }
};
