const SettingsPage = {
  async render() {
    if (App.user.role !== 'admin') {
      document.getElementById('mainContent').innerHTML = '<div class="empty-state"><h3>Admin access required</h3></div>';
      return;
    }

    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const users = await Api.get('/api/auth/users');

      main.innerHTML = `
        <div class="page-header">
          <h2>Settings</h2>
        </div>

        <div class="card">
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
