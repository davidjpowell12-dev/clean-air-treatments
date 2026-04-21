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
          <div class="card-header"><h3>📱 SMS Messaging</h3></div>
          <div class="card-body">
            <p style="font-size:13px;color:var(--gray-600);margin-bottom:14px;">
              Templates used to compose heads-up (night-before) and completion (after-service) text messages.
              You can edit each message before sending — these are just the starting points.
              Variables: <code>{{first_name}}</code>, <code>{{customer_name}}</code>, <code>{{address}}</code>, <code>{{friendly_date}}</code>, <code>{{business_name}}</code>, <code>{{review_link}}</code>.
            </p>

            <div id="msgTwilioStatus" style="padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:14px;"></div>

            <div class="form-group">
              <label>Business name</label>
              <input type="text" id="msgBusinessName" value="${this.esc(settings.msg_business_name || 'Clean Air Treatments')}" placeholder="Clean Air Treatments">
            </div>

            <div class="form-group">
              <label>Greeting</label>
              <input type="text" id="msgGreeting" value="${this.esc(settings.msg_greeting || 'Hi {{first_name}},')}">
            </div>

            <div class="form-group">
              <label>Heads-up intro (night before)</label>
              <textarea id="msgHeadsUpIntro" rows="2" placeholder="{{business_name}} will be at {{address}} {{friendly_date}} for:">${this.esc(settings.msg_heads_up_intro || '{{business_name}} will be at {{address}} {{friendly_date}} for:')}</textarea>
            </div>

            <div class="form-group">
              <label>Heads-up closing line</label>
              <textarea id="msgHeadsUpClosing" rows="2">${this.esc(settings.msg_heads_up_closing || 'Please unlock gates and secure pets. Reply with any questions.')}</textarea>
            </div>

            <div class="form-group">
              <label>Completion intro</label>
              <textarea id="msgCompletionIntro" rows="2">${this.esc(settings.msg_completion_intro || 'We just finished at {{address}} today:')}</textarea>
            </div>

            <div class="form-group">
              <label>Google review link</label>
              <input type="text" id="msgReviewLink" value="${this.esc(settings.msg_review_link || '')}" placeholder="https://g.page/r/XXXXXX/review">
              <p class="form-hint">Leave blank to omit the review ask from completion texts. Short link preferred.</p>
            </div>

            <div class="form-group">
              <label>Review ask line</label>
              <input type="text" id="msgReviewLine" value="${this.esc(settings.msg_review_line || 'Enjoyed our service? A quick review helps a ton: {{review_link}}')}">
            </div>

            <div class="form-group">
              <label>Signature</label>
              <input type="text" id="msgSignature" value="${this.esc(settings.msg_signature || 'Thanks! — {{business_name}}')}">
            </div>

            <div class="form-group">
              <label>Opt-out line (required on every message)</label>
              <input type="text" id="msgOptOut" value="${this.esc(settings.msg_opt_out || 'Reply STOP to unsubscribe.')}">
            </div>

            <button class="btn btn-primary btn-full" onclick="SettingsPage.saveMessagingTemplates()">Save Messaging Templates</button>

            <details style="margin-top:16px;">
              <summary style="cursor:pointer;font-weight:600;color:var(--blue);">Per-service templates (${services.length})</summary>
              <p style="font-size:12px;color:var(--gray-500);margin:8px 0 12px;">
                Each service has its own heads-up line, completion line, and optional client action (e.g. "Water in within 24 hours").
                When a visit includes multiple services, the lines are combined.
              </p>
              <div id="msgServiceTemplates">
                ${services.map(s => `
                  <div class="fu-svc-tmpl" data-svc-id="${s.id}" style="padding:12px;border:1px solid var(--gray-200);border-radius:10px;margin-bottom:10px;">
                    <h4 style="margin:0 0 8px;color:var(--gray-800);">${this.esc(s.name)}</h4>
                    <div class="form-group" style="margin-bottom:8px;">
                      <label style="font-size:12px;">Heads-up line</label>
                      <textarea rows="2" data-field="heads_up_text" placeholder="e.g. Weed Control — pre-emergent to stop crabgrass and annual weeds">${this.esc(s.heads_up_text || '')}</textarea>
                    </div>
                    <div class="form-group" style="margin-bottom:8px;">
                      <label style="font-size:12px;">Completion line</label>
                      <textarea rows="2" data-field="completion_text" placeholder="e.g. Weed Control applied — pre-emergent barrier is now in place">${this.esc(s.completion_text || '')}</textarea>
                    </div>
                    <div class="form-group" style="margin-bottom:8px;">
                      <label style="font-size:12px;">Client action (optional)</label>
                      <input type="text" data-field="client_action" placeholder="e.g. Water within 24 hours to activate" value="${this.esc(s.client_action || '')}">
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="SettingsPage.saveServiceTemplate(${s.id})">Save</button>
                  </div>
                `).join('')}
              </div>
            </details>
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
          <div class="card-header"><h3>Data Cleanup</h3></div>
          <div class="card-body">
            <p style="font-size:14px;color:var(--gray-700);margin-bottom:12px;">Find and merge duplicate property records.</p>
            <button class="btn btn-secondary btn-full" id="findDupesBtn" onclick="SettingsPage.findDuplicates()">Find Duplicate Properties</button>
            <div id="duplicatesResults" style="margin-top:12px;"></div>

            <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-200);">

            <p style="font-size:14px;color:var(--gray-700);margin-bottom:12px;">Find estimates where a line item's rounds/recurring flag doesn't match the current service definition — usually a sign the service was imported as one-time and later flipped to recurring.</p>
            <button class="btn btn-secondary btn-full" id="findRoundsMismatchBtn" onclick="SettingsPage.findRoundsMismatch()">Find Rounds Mismatches</button>
            <div id="roundsMismatchResults" style="margin-top:12px;"></div>

            <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-200);">

            <p style="font-size:14px;color:var(--gray-700);margin-bottom:4px;font-weight:600;">Relabel Unlabeled Schedule Entries</p>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">
              One-time cleanup. Finds every schedule entry with no service_type label and relabels them all to <strong>Fert &amp; Weed Control</strong> — since that's the only service performed so far. Use after you've stopped seeing the auto-relabel bug so historical data matches reality.
            </p>
            <button class="btn btn-secondary btn-full" id="relabelNullServicesBtn" onclick="SettingsPage.relabelNullServiceTypes()">Relabel all NULL schedules \u2192 Fert & Weed Control</button>
            <div id="relabelNullResults" style="margin-top:12px;"></div>

            <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-200);">

            <p style="font-size:14px;color:var(--gray-700);margin-bottom:4px;font-weight:600;">Invoice vs Estimate Audit</p>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">
              Read-only diagnostic. Finds accepted estimates where the displayed season total (plus card fee) doesn't match the sum of invoices on file. Shows you the scope of any mismatches. <strong>Does not fix anything</strong> — just reports.
            </p>
            <button class="btn btn-secondary btn-full" id="findInvoiceMismatchBtn" onclick="SettingsPage.findInvoiceMismatch()">Run Audit</button>
            <div id="invoiceMismatchResults" style="margin-top:12px;"></div>
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
      this.loadTwilioStatus();
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

  // ─── Messaging templates ───────────────────────────────
  async saveMessagingTemplates() {
    const fields = {
      msg_business_name:     document.getElementById('msgBusinessName').value.trim(),
      msg_greeting:          document.getElementById('msgGreeting').value.trim(),
      msg_heads_up_intro:    document.getElementById('msgHeadsUpIntro').value.trim(),
      msg_heads_up_closing:  document.getElementById('msgHeadsUpClosing').value.trim(),
      msg_completion_intro:  document.getElementById('msgCompletionIntro').value.trim(),
      msg_review_link:       document.getElementById('msgReviewLink').value.trim(),
      msg_review_line:       document.getElementById('msgReviewLine').value.trim(),
      msg_signature:         document.getElementById('msgSignature').value.trim(),
      msg_opt_out:           document.getElementById('msgOptOut').value.trim()
    };
    try {
      await Promise.all(
        Object.entries(fields).map(([k, v]) => Api.put('/api/settings/' + k, { value: v }))
      );
      App.toast('Messaging templates saved', 'success');
    } catch (err) {
      App.toast('Save failed: ' + err.message, 'error');
    }
  },

  async saveServiceTemplate(serviceId) {
    const row = document.querySelector(`.fu-svc-tmpl[data-svc-id="${serviceId}"]`);
    if (!row) return;
    const body = {
      heads_up_text:   row.querySelector('[data-field="heads_up_text"]').value.trim() || null,
      completion_text: row.querySelector('[data-field="completion_text"]').value.trim() || null,
      client_action:   row.querySelector('[data-field="client_action"]').value.trim() || null
    };
    try {
      await Api.put('/api/services/' + serviceId, body);
      App.toast('Service template saved', 'success');
    } catch (err) {
      App.toast('Save failed: ' + err.message, 'error');
    }
  },

  async loadTwilioStatus() {
    const box = document.getElementById('msgTwilioStatus');
    if (!box) return;
    try {
      const s = await Api.get('/api/messaging/status');
      if (s.twilio_configured) {
        box.style.background = '#dcf5c8';
        box.style.color = '#2d6a1e';
        box.innerHTML = '✓ Twilio is live — messages will be sent for real.';
      } else {
        box.style.background = '#fee4b8';
        box.style.color = '#92400e';
        box.innerHTML = '⚠ Twilio not configured — running in dry-run mode. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER to Railway env vars once A2P is approved.';
      }
    } catch (e) {
      box.innerHTML = '';
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

  async findRoundsMismatch() {
    const btn = document.getElementById('findRoundsMismatchBtn');
    const container = document.getElementById('roundsMismatchResults');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
    try {
      const rows = await Api.get('/api/admin/audit/estimate-rounds-mismatch');
      if (!rows.length) {
        container.innerHTML = '<p style="font-size:13px;color:var(--green);font-weight:600;">No rounds mismatches found.</p>';
        return;
      }

      // Group by estimate for readable display
      const byEst = {};
      for (const r of rows) {
        if (!byEst[r.estimate_id]) byEst[r.estimate_id] = { customer_name: r.customer_name, status: r.estimate_status, items: [] };
        byEst[r.estimate_id].items.push(r);
      }
      const estCount = Object.keys(byEst).length;

      container.innerHTML = `
        <p style="font-size:13px;color:var(--orange);font-weight:600;margin-bottom:12px;">
          Found ${rows.length} mismatch${rows.length === 1 ? '' : 'es'} across ${estCount} estimate${estCount === 1 ? '' : 's'}.
        </p>
        <button class="btn btn-primary btn-sm" style="margin-bottom:12px;" onclick="SettingsPage.fixAllRoundsMismatch()">Fix All (${rows.length})</button>
        <div>
          ${Object.entries(byEst).map(([estId, est]) => `
            <div style="border:1px solid var(--gray-200);border-radius:8px;padding:12px;margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div style="font-weight:600;font-size:14px;">${this.esc(est.customer_name)}</div>
                <span class="badge badge-${est.status === 'accepted' ? 'green' : 'gray'}" style="font-size:10px;">${est.status}</span>
              </div>
              ${est.items.map(it => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--gray-100);font-size:13px;">
                  <div>
                    <div style="font-weight:600;">${this.esc(it.service_name)}</div>
                    <div style="color:var(--gray-500);font-size:12px;">
                      Estimate: ${it.item_is_recurring ? (it.item_rounds + ' rounds') : 'one-time'}
                      &middot; Service definition: ${it.service_is_recurring ? (it.service_rounds + ' rounds') : 'one-time'}
                    </div>
                  </div>
                  <button class="btn btn-outline btn-sm" onclick="SettingsPage.fixRoundsMismatch(${it.item_id})">Fix</button>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<p style="color:var(--red);font-size:13px;">Error: ${err.message}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Find Rounds Mismatches'; }
    }
  },

  async fixRoundsMismatch(itemId) {
    try {
      const r = await Api.post('/api/admin/fix/estimate-item-rounds/' + itemId, {});
      App.toast(`Fixed ${r.service_name} for ${r.customer_name}`, 'success');
      this.findRoundsMismatch();
    } catch (err) {
      App.toast('Fix failed: ' + err.message, 'error');
    }
  },

  async relabelNullServiceTypes() {
    const ok = confirm('This will relabel EVERY schedule entry that has no service_type as "Fert & Weed Control". Run this only if Fert & Weed Control is the only service you\'ve performed so far. Continue?');
    if (!ok) return;
    const btn = document.getElementById('relabelNullServicesBtn');
    const box = document.getElementById('relabelNullResults');
    if (btn) { btn.disabled = true; btn.textContent = 'Working...'; }
    try {
      const r = await Api.post('/api/admin/fix/relabel-null-service-types', { service_type: 'Fert & Weed Control' });
      box.innerHTML = `<p style="font-size:13px;color:var(--green);font-weight:600;">Relabeled ${r.entries_updated} of ${r.entries_before} unlabeled schedule entries to "${r.target_service_type}".</p>`;
      App.toast(`Relabeled ${r.entries_updated} schedule entries`, 'success');
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red);font-size:13px;">Error: ${err.message}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Relabel all NULL schedules \u2192 Fert & Weed Control'; }
    }
  },

  async findInvoiceMismatch() {
    const btn = document.getElementById('findInvoiceMismatchBtn');
    const container = document.getElementById('invoiceMismatchResults');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
    try {
      const r = await Api.get('/api/admin/audit/estimate-invoice-mismatch');
      if (!r.mismatches || r.mismatches.length === 0) {
        container.innerHTML = `<p style="font-size:13px;color:var(--green);font-weight:600;">No mismatches found across ${r.estimates_scanned} estimate${r.estimates_scanned === 1 ? '' : 's'}.</p>`;
        return;
      }

      // Total $ impact across all mismatches
      const totalImpact = r.mismatches.reduce((sum, m) => sum + Math.abs(m.diff), 0);

      container.innerHTML = `
        <p style="font-size:13px;color:var(--orange);font-weight:600;margin-bottom:8px;">
          Found ${r.mismatches.length} mismatch${r.mismatches.length === 1 ? '' : 'es'} across ${r.estimates_scanned} accepted estimate${r.estimates_scanned === 1 ? '' : 's'}.
        </p>
        <p style="font-size:12px;color:var(--gray-500);margin-bottom:12px;">
          Total discrepancy across all clients: $${totalImpact.toFixed(2)}
        </p>
        <div>
          ${r.mismatches.map(m => {
            const rowColor = m.paid_count > 0 ? 'var(--red)' : 'var(--orange)';
            const direction = m.diff_sign === 'invoices_higher'
              ? 'Invoices total higher than estimate'
              : 'Estimate total higher than invoices';
            const actionHint = m.diff_sign === 'estimate_higher'
              ? `⚠ Client is shown ${this.fmtDollar(m.diff)} MORE on their estimate than they will be billed.`
              : `⚠ Client will be billed ${this.fmtDollar(-m.diff)} MORE than their estimate says.`;
            return `
              <div style="border:1px solid var(--gray-200);border-left:4px solid ${rowColor};border-radius:8px;padding:12px;margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
                  <div style="font-weight:600;font-size:14px;color:var(--navy, var(--blue));">${this.esc(m.customer_name)}</div>
                  <span class="badge badge-${m.paid_count > 0 ? 'red' : 'orange'}" style="font-size:10px;white-space:nowrap;">${m.paid_count > 0 ? m.paid_count + ' paid' : 'none paid yet'}</span>
                </div>
                <div style="font-size:12px;color:var(--gray-700);display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin-bottom:8px;">
                  <div style="color:var(--gray-500);">Estimate shows:</div>
                  <div>${this.fmtDollar(m.estimate_total)} season · ${this.fmtDollar(m.monthly_price_shown)}/mo${m.payment_method === 'card' ? ` (+3.5% fee = ${this.fmtDollar(m.estimate_total_with_fee)})` : ''}</div>

                  <div style="color:var(--gray-500);">Invoices total:</div>
                  <div>${this.fmtDollar(m.invoices_total)} (${m.invoice_count} × installments)</div>

                  <div style="color:var(--gray-500);">Already paid:</div>
                  <div>${this.fmtDollar(m.invoices_paid)}</div>

                  <div style="color:var(--gray-500);">Unpaid remaining:</div>
                  <div>${this.fmtDollar(m.invoices_unpaid)}</div>

                  <div style="color:var(--gray-500);">Difference:</div>
                  <div style="color:${rowColor};font-weight:600;">${this.fmtDollar(Math.abs(m.diff))} (${direction})</div>

                  <div style="color:var(--gray-500);">Plan:</div>
                  <div>${m.payment_plan} · ${m.payment_method}</div>
                </div>
                <div style="font-size:12px;color:${rowColor};padding:6px 8px;background:var(--gray-50);border-radius:4px;">
                  ${actionHint}
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <p style="font-size:12px;color:var(--gray-500);margin-top:12px;padding:10px;background:var(--gray-50);border-radius:6px;">
          <strong>No fixes applied.</strong> Review the list above and decide what to do with each client. Come back when you want to discuss next steps.
        </p>
      `;
    } catch (err) {
      container.innerHTML = `<p style="color:var(--red);font-size:13px;">Error: ${err.message}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Run Audit'; }
    }
  },

  fmtDollar(n) {
    const v = Number(n) || 0;
    const sign = v < 0 ? '-' : '';
    return sign + '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  async fixAllRoundsMismatch() {
    if (!confirm('Fix all mismatches? Line items will be updated to match the service definition, and estimate totals will be recalculated. This cannot be undone.')) return;
    try {
      const r = await Api.post('/api/admin/fix/estimate-rounds-mismatch-all', {});
      App.toast(`Fixed ${r.items_fixed} items across ${r.estimates_affected} estimate${r.estimates_affected === 1 ? '' : 's'}`, 'success');
      this.findRoundsMismatch();
    } catch (err) {
      App.toast('Fix failed: ' + err.message, 'error');
    }
  },

  async findDuplicates() {
    const btn = document.getElementById('findDupesBtn');
    const container = document.getElementById('duplicatesResults');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
    try {
      const result = await Api.get('/api/admin/duplicates/properties');
      if (!result.duplicate_groups || result.duplicate_groups.length === 0) {
        container.innerHTML = '<p style="font-size:13px;color:var(--green);font-weight:600;">No duplicates found.</p>';
        return;
      }

      container.innerHTML = `
        <p style="font-size:13px;color:var(--red);font-weight:600;margin-bottom:12px;">
          Found ${result.total_duplicates} duplicate record${result.total_duplicates > 1 ? 's' : ''} across ${result.duplicate_groups.length} address${result.duplicate_groups.length > 1 ? 'es' : ''}
        </p>
        ${result.duplicate_groups.map(group => `
          <div style="border:1px solid var(--gray-200);border-radius:8px;padding:12px;margin-bottom:12px;">
            <div style="font-weight:600;font-size:14px;margin-bottom:8px;">${this.esc(group.address)}</div>
            ${group.properties.map(p => {
              const isRecommended = p.id === group.recommended_keep_id;
              const linked = p.schedule_count + p.application_count + p.estimate_count;
              return `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--gray-100);font-size:13px;">
                  <span style="min-width:60px;font-weight:500;">ID ${p.id}</span>
                  <span style="flex:1;color:var(--gray-500);">${this.esc(p.customer_name)} &middot; ${linked} linked record${linked !== 1 ? 's' : ''}</span>
                  ${isRecommended
                    ? '<span style="color:var(--green);font-weight:600;font-size:12px;">KEEP</span>'
                    : `<button class="btn btn-sm" style="padding:2px 10px;font-size:12px;color:var(--red);border:1px solid var(--red);background:none;" onclick="SettingsPage.mergeDuplicate(${group.recommended_keep_id}, ${p.id})">Remove</button>`
                  }
                </div>
              `;
            }).join('')}
            <button class="btn btn-primary btn-sm" style="margin-top:8px;font-size:12px;" onclick="SettingsPage.mergeAll(${group.recommended_keep_id}, [${group.properties.filter(p => p.id !== group.recommended_keep_id).map(p => p.id).join(',')}])">
              Merge All &rarr; Keep ID ${group.recommended_keep_id}
            </button>
          </div>
        `).join('')}
      `;
    } catch (err) {
      container.innerHTML = `<p style="font-size:13px;color:var(--red);">Error: ${err.message}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Find Duplicate Properties'; }
    }
  },

  async mergeDuplicate(keepId, removeId) {
    if (!confirm(`Merge property ${removeId} into ${keepId}? All linked records will be moved and the duplicate will be deleted.`)) return;
    try {
      const result = await Api.post('/api/admin/duplicates/merge', { keep_id: keepId, remove_ids: [removeId] });
      App.toast(`Merged! ${result.records_reassigned} record(s) reassigned.`, 'success');
      this.findDuplicates(); // Refresh the list
    } catch (err) {
      App.toast('Merge failed: ' + err.message, 'error');
    }
  },

  async mergeAll(keepId, removeIds) {
    if (!confirm(`Merge ${removeIds.length} duplicate(s) into property ${keepId}? All linked records will be moved and duplicates deleted.`)) return;
    try {
      const result = await Api.post('/api/admin/duplicates/merge', { keep_id: keepId, remove_ids: removeIds });
      App.toast(`Merged! ${result.records_reassigned} record(s) reassigned, ${removeIds.length} duplicate(s) removed.`, 'success');
      this.findDuplicates(); // Refresh the list
    } catch (err) {
      App.toast('Merge failed: ' + err.message, 'error');
    }
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
