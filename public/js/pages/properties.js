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
      const [prop, applications, ipmCases] = await Promise.all([
        Api.get(`/api/properties/${id}`),
        Api.get(`/api/properties/${id}/applications`),
        Api.get(`/api/properties/${id}/ipm-cases`)
      ]);
      const isAdmin = App.user.role === 'admin';

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
            <div class="detail-row"><span class="detail-label">Size</span><span class="detail-value">${prop.sqft ? prop.sqft.toLocaleString() + ' sq ft' : 'N/A'}</span></div>
            <div class="detail-row"><span class="detail-label">Soil Type</span><span class="detail-value">${this.esc(prop.soil_type || 'N/A')}</span></div>
            <div class="detail-row"><span class="detail-label">Last Treatment</span><span class="detail-value">${prop.last_application_date || 'Never'}</span></div>
            ${prop.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value">${this.esc(prop.notes)}</span></div>` : ''}
          </div>
        </div>

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

  renderImport() {
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <span class="back-link" onclick="App.navigate('properties')">&larr; Properties</span>
      <div class="card">
        <div class="card-header"><h3>Import Properties from CSV</h3></div>
        <div class="card-body">
          <p style="font-size:14px;color:var(--gray-700);margin-bottom:16px;">
            Upload a CSV file with your customer properties. Required columns: <strong>customer_name</strong> and <strong>address</strong>.
            Optional columns: city, state, zip, sqft, soil_type, notes.
          </p>
          <div class="form-group">
            <label>Select CSV File</label>
            <input type="file" id="csvFile" accept=".csv" style="font-size:16px;">
          </div>
          <div id="csvPreview" style="display:none;">
            <h4 style="margin-bottom:8px;color:var(--blue);">Preview (first 5 rows)</h4>
            <div id="csvPreviewTable" style="overflow-x:auto;margin-bottom:16px;"></div>
            <div id="csvStats" style="font-size:14px;color:var(--gray-700);margin-bottom:16px;"></div>
            <button class="btn btn-primary btn-full" onclick="PropertiesPage.doImport()">Import Properties</button>
          </div>
          <div id="importResults" style="display:none;"></div>
        </div>
      </div>
    `;

    document.getElementById('csvFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target.result;
        this._parsedCSV = this.parseCSV(text);

        if (this._parsedCSV.length === 0) {
          App.toast('No data found in CSV', 'error');
          return;
        }

        // Show preview
        const preview = document.getElementById('csvPreview');
        preview.style.display = 'block';

        const headers = Object.keys(this._parsedCSV[0]);
        const previewRows = this._parsedCSV.slice(0, 5);

        document.getElementById('csvPreviewTable').innerHTML = `
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr>${headers.map(h => `<th style="padding:6px 8px;border:1px solid var(--gray-200);background:var(--gray-50);text-align:left;">${this.esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${previewRows.map(row => `<tr>${headers.map(h => `<td style="padding:6px 8px;border:1px solid var(--gray-200);">${this.esc(row[h] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        `;

        document.getElementById('csvStats').textContent = `${this._parsedCSV.length} properties found in CSV`;
      };
      reader.readAsText(file);
    });
  },

  parseCSV(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.replace(/^"(.*)"$/, '$1').trim().toLowerCase().replace(/\s+/g, '_'));

    return lines.slice(1).map(line => {
      const values = [];
      let current = '';
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') { inQuotes = !inQuotes; }
        else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
        else { current += char; }
      }
      values.push(current.trim());

      const obj = {};
      headers.forEach((h, i) => { obj[h] = values[i] || ''; });
      return obj;
    }).filter(obj => obj.customer_name || obj.address);
  },

  async doImport() {
    if (!this._parsedCSV || this._parsedCSV.length === 0) {
      App.toast('No data to import', 'error');
      return;
    }

    try {
      const result = await Api.post('/api/properties/import', { properties: this._parsedCSV });
      const resultsDiv = document.getElementById('importResults');
      resultsDiv.style.display = 'block';
      resultsDiv.innerHTML = `
        <div class="card card-accent">
          <div class="card-body">
            <h4 style="color:var(--green-dark);margin-bottom:8px;">Import Complete</h4>
            <p>${result.imported} properties imported successfully</p>
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

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }
};
