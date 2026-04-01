const SettingsPage = {
  async render() {
    if (App.user.role !== 'admin') {
      document.getElementById('mainContent').innerHTML = '<div class="empty-state"><h3>Admin access required</h3></div>';
      return;
    }

    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const [users, settings, services] = await Promise.all([
        Api.get('/api/auth/users'),
        Api.get('/api/settings').catch(() => ({})),
        Api.get('/api/services').catch(() => [])
      ]);

      main.innerHTML = `
        <div class="page-header">
          <h2>Settings</h2>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Pricing Matrix</h3>
            <div style="display:flex;gap:8px;">
              <label class="btn btn-primary btn-sm" style="cursor:pointer;margin:0;">
                Upload CSV
                <input type="file" accept=".csv" style="display:none;" onchange="SettingsPage.importCSV(this)">
              </label>
              ${services.length > 0 ? `<button class="btn btn-sm btn-outline" onclick="SettingsPage.showAddServiceModal()">+ Service</button>` : ''}
            </div>
          </div>
          <div class="card-body">
            ${services.length > 0 ? this.renderPricingMatrix(services) : `
              <div class="empty-state" style="padding:24px 0;">
                <p style="color:var(--gray-500);margin-bottom:12px;">No pricing matrix loaded yet.</p>
                <p style="font-size:13px;color:var(--gray-400);">Upload your pricing CSV to get started. First column should be sq ft, remaining columns are service names with prices.</p>
              </div>
            `}
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <div class="card-header">
            <h3>Team Members</h3>
            <button class="btn btn-primary btn-sm" onclick="SettingsPage.showUserModal()">+ Add User</button>
          </div>
          ${users.map(u => `
            <div class="data-row">
              <div class="data-row-main">
                <h4>${this.esc(u.full_name)}</h4>
                <p>@${this.esc(u.username)}${u.applicator_cert_number ? ' &middot; Cert# ' + this.esc(u.applicator_cert_number) : ''}</p>
              </div>
              <div class="data-row-right" style="display:flex;gap:8px;align-items:center;">
                <span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}">${u.role}</span>
                <button class="btn btn-sm btn-outline" onclick="SettingsPage.showUserModal(${u.id}, '${this.esc(u.username)}', '${this.esc(u.full_name)}', '${u.role}', '${this.esc(u.applicator_cert_number || '')}')">Edit</button>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="card" style="margin-top:16px;">
          <div class="card-header"><h3>Job Costing Settings</h3></div>
          <div class="card-body">
            <div class="form-group" style="margin-bottom:0;">
              <label>Hourly Labor Rate ($)</label>
              <div style="display:flex;gap:10px;align-items:center;">
                <input type="number" id="laborRateInput" value="${settings.hourly_labor_rate || '45'}" step="0.50" min="0" style="flex:1;padding:12px;border:2px solid var(--gray-200);border-radius:6px;font-size:16px;">
                <button class="btn btn-primary btn-sm" onclick="SettingsPage.saveLaborRate()">Save</button>
              </div>
              <p class="form-hint">Used to auto-calculate labor cost on applications (duration × rate)</p>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <div class="card-header"><h3>Route Optimization</h3></div>
          <div class="card-body">
            <div class="form-group" style="margin-bottom:0;">
              <label>Home / Starting Address</label>
              <div style="display:flex;gap:10px;align-items:center;">
                <input type="text" id="homeAddressInput" value="${settings.home_address || ''}" placeholder="e.g. 123 Main St, Grand Rapids, MI" style="flex:1;padding:12px;border:2px solid var(--gray-200);border-radius:6px;font-size:16px;">
                <button class="btn btn-primary btn-sm" onclick="SettingsPage.saveHomeAddress()">Save</button>
              </div>
              <p class="form-hint">Your daily route starts from this address. Used by the Optimize Route feature on the Schedule page.</p>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <div class="card-header">
            <h3>CRM Import</h3>
          </div>
          <div class="card-body">
            <p style="font-size:14px;color:var(--gray-700);margin-bottom:8px;">Import clients and schedules from your existing CRM via CSV.</p>
            <p style="font-size:12px;color:var(--gray-400);margin-bottom:16px;">CSV must include columns: <strong>customer_name, address, city, zip</strong>. Optional: <strong>state, email, phone, sqft, start_date, interval_weeks, rounds</strong>.</p>
            <label class="btn btn-primary btn-full" style="cursor:pointer;text-align:center;display:block;">
              Upload CRM CSV
              <input type="file" accept=".csv" style="display:none;" onchange="SettingsPage.importCRM(this)">
            </label>
            <div id="crmImportPreview"></div>
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <div class="card-header"><h3>Data Export</h3></div>
          <div class="card-body">
            <p style="font-size:14px;color:var(--gray-700);margin-bottom:12px;">Export application records for MDARD annual reporting (due March 1).</p>
            <button class="btn btn-secondary btn-full" onclick="ApplicationsPage.exportCSV()">Download Application CSV</button>
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <div class="card-header"><h3>Data &amp; Backups</h3></div>
          <div class="card-body">
            <div id="dbHealthStatus" style="margin-bottom:16px;padding:12px;border-radius:8px;background:var(--gray-50, #f8f9fa);font-size:13px;color:var(--gray-500);">
              Checking database health...
            </div>

            <h4 style="margin:0 0 8px;font-size:14px;">Database Backups</h4>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">Create and download SQLite database backups. Last 30 are kept automatically.</p>
            <div style="display:flex;gap:8px;margin-bottom:16px;">
              <button class="btn btn-primary" id="createBackupBtn" onclick="SettingsPage.createBackup()">Create Backup Now</button>
              <button class="btn btn-outline" onclick="SettingsPage.downloadDatabase()">Download Database</button>
            </div>
            <div id="backupsList" style="margin-bottom:20px;"></div>

            <h4 style="margin:0 0 8px;font-size:14px;">Google Drive Backup</h4>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:8px;">Backup database to Google Drive. Automatic backups run every 24 hours.</p>
            <div id="driveBackupStatus" style="margin-bottom:12px;padding:10px;border-radius:8px;background:var(--gray-50, #f8f9fa);font-size:13px;color:var(--gray-500);">
              Checking backup status...
            </div>
            <div style="display:flex;gap:8px;margin-bottom:12px;">
              <button class="btn btn-primary" id="driveBackupBtn" onclick="SettingsPage.backupToDrive()">Backup to Google Drive Now</button>
            </div>
            <div id="driveBackupsList" style="margin-bottom:20px;"></div>

            <h4 style="margin:0 0 8px;font-size:14px;">CSV Exports</h4>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">Download your data as CSV spreadsheets.</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
              <button class="btn btn-outline btn-sm" onclick="SettingsPage.exportCSV('properties')">Properties</button>
              <button class="btn btn-outline btn-sm" onclick="SettingsPage.exportCSV('schedules')">Schedule</button>
              <button class="btn btn-outline btn-sm" onclick="SettingsPage.exportCSV('applications')">Applications</button>
              <button class="btn btn-outline btn-sm" onclick="SettingsPage.exportCSV('estimates')">Estimates</button>
              <button class="btn btn-outline btn-sm" onclick="SettingsPage.exportCSV('invoices')">Invoices</button>
            </div>
            <button class="btn btn-secondary btn-full" onclick="SettingsPage.exportAll()">Download All Exports</button>
          </div>
        </div>
      `;

      // Load backups section asynchronously after render
      this.loadBackupsSection();
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  renderPricingMatrix(services) {
    if (!services.length) return '';

    // Collect all unique sqft values across all services
    const sqftSet = new Set();
    for (const svc of services) {
      for (const t of (svc.tiers || [])) sqftSet.add(t.min_sqft);
    }
    const sqftValues = [...sqftSet].sort((a, b) => a - b);

    if (!sqftValues.length) return '<p style="color:var(--gray-500);">No pricing tiers configured.</p>';

    let html = `
      <div style="overflow-x:auto;margin:-16px;padding:0;">
        <table class="pricing-matrix-table">
          <thead>
            <tr>
              <th>Sq Ft</th>
              ${services.map(s => `<th>${this.esc(s.name)}<br><span style="font-weight:400;font-size:10px;color:var(--gray-400);">${s.is_recurring ? 'per treatment' : 'one-time'}</span></th>`).join('')}
            </tr>
          </thead>
          <tbody>
    `;

    for (const sqft of sqftValues) {
      html += `<tr><td style="font-weight:600;">${sqft.toLocaleString()}</td>`;
      for (const svc of services) {
        const tier = (svc.tiers || []).find(t => t.min_sqft === sqft);
        if (tier) {
          html += `<td class="pricing-cell" onclick="SettingsPage.editTierPrice(${tier.id}, ${tier.price})">$${tier.price.toFixed(2)}</td>`;
        } else {
          html += `<td style="color:var(--gray-300);">—</td>`;
        }
      }
      html += '</tr>';
    }

    html += '</tbody></table></div>';

    html += `<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--gray-100);display:flex;gap:16px;flex-wrap:wrap;">`;
    for (const svc of services) {
      const tierCount = (svc.tiers || []).length;
      html += `<div style="font-size:12px;color:var(--gray-500);">
        <strong style="color:var(--gray-700);">${this.esc(svc.name)}</strong> &middot;
        ${svc.is_recurring ? svc.rounds + ' rounds/season' : 'One-time'} &middot;
        ${tierCount} tiers
      </div>`;
    }
    html += '</div>';

    return html;
  },

  async importCSV(input) {
    const file = input.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = await Api.post('/api/services/import-matrix', { csv_content: text });
      App.toast(`Imported ${result.services} services with ${result.tiers} price tiers`, 'success');
      this.render();
    } catch (err) {
      App.toast('Import failed: ' + err.message, 'error');
    }
    input.value = '';
  },

  editTierPrice(tierId, currentPrice) {
    const newPrice = prompt('Enter new price:', currentPrice.toFixed(2));
    if (newPrice === null) return;
    const price = parseFloat(newPrice);
    if (isNaN(price) || price < 0) { App.toast('Invalid price', 'error'); return; }

    Api.put(`/api/services/tiers/${tierId}`, { price }).then(() => {
      App.toast('Price updated', 'success');
      this.render();
    }).catch(err => App.toast(err.message, 'error'));
  },

  showAddServiceModal() {
    document.querySelector('.modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Add Service</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').classList.remove('open');setTimeout(()=>this.closest('.modal-overlay').remove(),200)">&times;</button>
        </div>
        <div class="modal-body">
          <form id="addServiceForm" class="app-form">
            <div class="form-group">
              <label>Service Name *</label>
              <input type="text" name="name" required placeholder="e.g., Grub Control">
            </div>
            <div class="form-group">
              <label>Type</label>
              <select name="is_recurring">
                <option value="0">One-time</option>
                <option value="1">Recurring (seasonal)</option>
              </select>
            </div>
            <div class="form-group" id="roundsGroup" style="display:none;">
              <label>Treatments per Season</label>
              <input type="number" name="rounds" value="6" min="1" max="12">
            </div>
            <button type="submit" class="btn btn-primary btn-full">Add Service</button>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    overlay.querySelector('[name="is_recurring"]').addEventListener('change', (e) => {
      overlay.querySelector('#roundsGroup').style.display = e.target.value === '1' ? 'block' : 'none';
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); }
    });

    document.getElementById('addServiceForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      data.is_recurring = Number(data.is_recurring);
      data.rounds = data.is_recurring ? Number(data.rounds) : 1;
      try {
        await Api.post('/api/services', data);
        App.toast('Service added', 'success');
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
        this.render();
      } catch (err) {
        App.toast(err.message, 'error');
      }
    });
  },

  showUserModal(id, username, fullName, role, certNumber) {
    document.querySelector('.modal-overlay')?.remove();

    const isEdit = !!id;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${isEdit ? 'Edit' : 'Add'} User</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').classList.remove('open');setTimeout(()=>this.closest('.modal-overlay').remove(),200)">&times;</button>
        </div>
        <div class="modal-body">
          <form id="userForm" class="app-form">
            ${!isEdit ? `
              <div class="form-group">
                <label>Username *</label>
                <input type="text" name="username" required>
              </div>
            ` : ''}
            <div class="form-group">
              <label>Full Name *</label>
              <input type="text" name="fullName" value="${this.esc(fullName || '')}" required>
            </div>
            <div class="form-group">
              <label>${isEdit ? 'New Password (leave blank to keep)' : 'Password *'}</label>
              <input type="password" name="password" ${isEdit ? '' : 'required'}>
            </div>
            <div class="form-group">
              <label>Role</label>
              <select name="role">
                <option value="technician" ${role === 'technician' ? 'selected' : ''}>Technician</option>
                <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
              </select>
            </div>
            <div class="form-group">
              <label>Applicator Cert #</label>
              <input type="text" name="applicatorCertNumber" value="${this.esc(certNumber || '')}">
            </div>
            <div style="display:flex;gap:10px;">
              <button type="submit" class="btn btn-primary" style="flex:1;">${isEdit ? 'Save' : 'Create User'}</button>
              ${isEdit && id !== App.user.id ? `<button type="button" class="btn btn-danger" onclick="SettingsPage.deleteUser(${id})">Delete</button>` : ''}
            </div>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
      }
    });

    document.getElementById('userForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData.entries());
      if (!data.password) delete data.password;

      try {
        if (isEdit) {
          await Api.put(`/api/auth/users/${id}`, data);
          App.toast('User updated', 'success');
        } else {
          await Api.post('/api/auth/users', data);
          App.toast('User created', 'success');
        }
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
        this.render();
      } catch (err) {
        App.toast(err.message, 'error');
      }
    });
  },

  async saveHomeAddress() {
    const value = document.getElementById('homeAddressInput').value.trim();
    if (!value) { App.toast('Enter an address', 'error'); return; }
    try {
      await Api.put('/api/settings/home_address', { value });
      App.toast('Home address saved', 'success');
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  async saveLaborRate() {
    const value = document.getElementById('laborRateInput').value;
    if (!value || Number(value) < 0) {
      App.toast('Enter a valid rate', 'error');
      return;
    }
    try {
      await Api.put('/api/settings/hourly_labor_rate', { value });
      App.toast('Labor rate updated', 'success');
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  async importCRM(input) {
    const file = input.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      if (lines.length < 2) { App.toast('CSV must have a header + at least one row', 'error'); return; }

      // Parse header
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].match(/(".*?"|[^,]+)/g)?.map(v => v.replace(/^"|"$/g, '').trim()) || [];
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
        if (obj.customer_name && obj.address) rows.push(obj);
      }

      if (rows.length === 0) { App.toast('No valid rows found. Need customer_name and address columns.', 'error'); return; }

      // Show preview
      const preview = document.getElementById('crmImportPreview');
      preview.innerHTML = `
        <div style="margin-top:16px;background:var(--gray-50, #f8f9fa);border-radius:12px;padding:16px;">
          <h4 style="margin:0 0 8px;">Preview: ${rows.length} clients found</h4>
          <div style="max-height:200px;overflow-y:auto;">
            ${rows.slice(0, 10).map(r => `
              <div style="padding:6px 0;border-bottom:1px solid var(--gray-200);font-size:13px;">
                <strong>${r.customer_name}</strong> &middot; ${r.address}, ${r.city || ''} ${r.zip || ''}
                ${r.sqft ? ' &middot; ' + r.sqft + ' sqft' : ''}
              </div>
            `).join('')}
            ${rows.length > 10 ? `<div style="padding:6px 0;font-size:12px;color:var(--gray-400);">...and ${rows.length - 10} more</div>` : ''}
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;">
              <input type="checkbox" id="crmCreateSchedules" ${rows[0]?.start_date ? 'checked' : ''}>
              Also create schedules (needs start_date column)
            </label>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;">
            <button class="btn btn-outline" style="flex:1;" onclick="document.getElementById('crmImportPreview').innerHTML=''">Cancel</button>
            <button class="btn btn-primary" style="flex:1;background:var(--green);" id="confirmCrmImport">Import ${rows.length} Clients</button>
          </div>
        </div>
      `;

      document.getElementById('confirmCrmImport').addEventListener('click', async () => {
        const btn = document.getElementById('confirmCrmImport');
        btn.disabled = true;
        btn.textContent = 'Importing...';
        const createSchedules = document.getElementById('crmCreateSchedules').checked;

        try {
          const result = await Api.post('/api/properties/import', {
            clients: rows,
            create_schedules: createSchedules
          });
          App.toast(`Imported ${result.properties_created} clients${result.schedules_created ? ', ' + result.schedules_created + ' schedule entries' : ''}`, 'success');
          preview.innerHTML = '';
        } catch (err) {
          App.toast('Import failed: ' + err.message, 'error');
          btn.disabled = false;
          btn.textContent = `Import ${rows.length} Clients`;
        }
      });
    } catch (err) {
      App.toast('Failed to read CSV: ' + err.message, 'error');
    }
    input.value = '';
  },

  async deleteUser(id) {
    if (!confirm('Delete this user?')) return;
    try {
      await Api.delete(`/api/auth/users/${id}`);
      App.toast('User deleted', 'success');
      document.querySelector('.modal-overlay')?.remove();
      this.render();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  async loadBackupsSection() {
    // Health check
    try {
      const health = await Api.get('/api/admin/health');
      const el = document.getElementById('dbHealthStatus');
      if (el) {
        const sizeKB = health.database_size ? (health.database_size / 1024).toFixed(1) : '?';
        el.style.background = health.status === 'ok' ? 'var(--green-50, #ecfdf5)' : 'var(--red-50, #fef2f2)';
        el.style.color = health.status === 'ok' ? 'var(--green-700, #15803d)' : 'var(--red-700, #b91c1c)';
        el.textContent = health.status === 'ok'
          ? `Database healthy (${sizeKB} KB)`
          : `Database issue: ${health.integrity_check}`;
      }
    } catch (err) {
      const el = document.getElementById('dbHealthStatus');
      if (el) { el.textContent = 'Could not check database health'; el.style.color = 'var(--gray-400)'; }
    }

    // Load backups list
    try {
      const backups = await Api.get('/api/admin/backups');
      const container = document.getElementById('backupsList');
      if (!container) return;

      if (backups.length === 0) {
        container.innerHTML = '<p style="font-size:13px;color:var(--gray-400);">No backups yet.</p>';
      } else {
        container.innerHTML = `
          <div style="max-height:200px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:8px;">
            ${backups.slice(0, 10).map(b => {
              const sizeKB = (b.size / 1024).toFixed(1);
              return `<div style="padding:8px 12px;border-bottom:1px solid var(--gray-100);display:flex;justify-content:space-between;align-items:center;font-size:13px;">
                <div>
                  <span style="font-weight:500;">${this.esc(b.filename)}</span>
                  <span style="color:var(--gray-400);margin-left:8px;">${sizeKB} KB</span>
                </div>
                <a href="/api/admin/backups/${encodeURIComponent(b.filename)}" class="btn btn-sm btn-outline" style="padding:2px 10px;font-size:12px;">Download</a>
              </div>`;
            }).join('')}
            ${backups.length > 10 ? `<div style="padding:6px 12px;font-size:12px;color:var(--gray-400);">...and ${backups.length - 10} more</div>` : ''}
          </div>
        `;
      }
    } catch (err) {
      const container = document.getElementById('backupsList');
      if (container) container.innerHTML = '<p style="font-size:13px;color:var(--gray-400);">Could not load backups.</p>';
    }

    // Load Drive backup status and history
    try {
      const status = await Api.get('/api/backup/status');
      const statusEl = document.getElementById('driveBackupStatus');
      if (statusEl) {
        if (!status.driveConfigured) {
          statusEl.style.background = 'var(--yellow-50, #fefce8)';
          statusEl.style.color = 'var(--yellow-700, #a16207)';
          statusEl.textContent = 'Google Drive not configured. Add GOOGLE_DRIVE_CREDENTIALS to enable cloud backups.';
        } else if (status.lastBackupTime) {
          statusEl.style.background = 'var(--green-50, #ecfdf5)';
          statusEl.style.color = 'var(--green-700, #15803d)';
          statusEl.textContent = 'Last backup: ' + new Date(status.lastBackupTime).toLocaleString() +
            ' | ' + status.driveBackups.length + ' backups on Drive' +
            (status.dbSize ? ' | DB size: ' + (status.dbSize / 1024).toFixed(1) + ' KB' : '');
        } else {
          statusEl.style.color = 'var(--gray-500)';
          statusEl.textContent = 'No backups yet this session. ' + status.driveBackups.length + ' backups on Drive.' +
            (status.dbSize ? ' DB size: ' + (status.dbSize / 1024).toFixed(1) + ' KB' : '');
        }
      }

      const driveList = document.getElementById('driveBackupsList');
      if (driveList && status.driveBackups && status.driveBackups.length > 0) {
        const recent = status.driveBackups.slice(0, 5);
        driveList.innerHTML = `
          <div style="border:1px solid var(--gray-200);border-radius:8px;">
            ${recent.map(b => {
              const sizeKB = b.size ? (b.size / 1024).toFixed(1) : '?';
              const date = new Date(b.createdTime).toLocaleString();
              return `<div style="padding:8px 12px;border-bottom:1px solid var(--gray-100);display:flex;justify-content:space-between;align-items:center;font-size:13px;">
                <div>
                  <span style="font-weight:500;">${this.esc(b.name)}</span>
                  <span style="color:var(--gray-400);margin-left:8px;">${sizeKB} KB</span>
                </div>
                <span style="color:var(--gray-400);font-size:12px;">${date}</span>
              </div>`;
            }).join('')}
            ${status.driveBackups.length > 5 ? `<div style="padding:6px 12px;font-size:12px;color:var(--gray-400);">...and ${status.driveBackups.length - 5} more on Drive</div>` : ''}
          </div>
        `;
      } else if (driveList) {
        driveList.innerHTML = '<p style="font-size:13px;color:var(--gray-400);">No Drive backups yet.</p>';
      }
    } catch (err) {
      const statusEl = document.getElementById('driveBackupStatus');
      if (statusEl) { statusEl.textContent = 'Could not check Drive backup status'; statusEl.style.color = 'var(--gray-400)'; }
    }
  },

  async createBackup() {
    const btn = document.getElementById('createBackupBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
    try {
      const result = await Api.post('/api/admin/backup');
      const sizeKB = (result.size / 1024).toFixed(1);
      App.toast(`Backup created: ${result.filename} (${sizeKB} KB)`, 'success');
      this.loadBackupsSection();
    } catch (err) {
      App.toast('Backup failed: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Create Backup Now'; }
    }
  },

  downloadDatabase() {
    window.location.href = '/api/backup/download';
  },

  downloadLatestBackup() {
    window.location.href = '/api/admin/backup/latest';
  },

  async backupToDrive() {
    const btn = document.getElementById('driveBackupBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Backing up...'; }
    try {
      const result = await Api.post('/api/backup/now');
      if (result.drive) {
        App.toast('Backup uploaded to Google Drive', 'success');
      } else if (result.error) {
        App.toast('Local backup saved. Drive upload failed: ' + result.error, 'warning');
      } else {
        App.toast('Backup saved locally', 'success');
      }
      this.loadBackupsSection();
    } catch (err) {
      App.toast('Backup failed: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Backup to Google Drive Now'; }
    }
  },

  exportCSV(type) {
    window.location.href = `/api/export/${type}`;
  },

  exportAll() {
    const types = ['properties', 'schedules', 'applications', 'estimates', 'invoices'];
    types.forEach((type, i) => {
      setTimeout(() => { this.exportCSV(type); }, i * 500);
    });
    App.toast('Downloading all exports...', 'success');
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
