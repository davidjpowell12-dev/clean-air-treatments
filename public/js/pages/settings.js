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
          <div class="card-header"><h3>Data Export</h3></div>
          <div class="card-body">
            <p style="font-size:14px;color:var(--gray-700);margin-bottom:12px;">Export application records for MDARD annual reporting (due March 1).</p>
            <button class="btn btn-secondary btn-full" onclick="ApplicationsPage.exportCSV()">Download Application CSV</button>
          </div>
        </div>
      `;
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

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
