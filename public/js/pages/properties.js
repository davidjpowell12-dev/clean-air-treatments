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
            <div class="detail-row"><span class="detail-label">Total Size</span><span class="detail-value" id="propTotalSqft">${prop.sqft ? prop.sqft.toLocaleString() + ' sq ft' : 'N/A'}</span></div>
            <div class="detail-row"><span class="detail-label">Soil Type</span><span class="detail-value">${this.esc(prop.soil_type || 'N/A')}</span></div>
            <div class="detail-row"><span class="detail-label">Last Treatment</span><span class="detail-value">${prop.last_application_date || 'Never'}</span></div>
            ${prop.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value">${this.esc(prop.notes)}</span></div>` : ''}
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

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }
};
