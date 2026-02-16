const IpmPage = {
  async render(action, id) {
    if (action === 'view' && id) return this.renderDetail(id);
    return this.renderList();
  },

  async renderList() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const cases = await Api.get('/api/ipm/cases');

      main.innerHTML = `
        <div class="page-header">
          <h2>IPM Cases</h2>
        </div>

        <div class="filter-pills" id="ipmFilters">
          <span class="pill active" data-filter="all" onclick="IpmPage.filterCases('all')">All (${cases.length})</span>
          <span class="pill" data-filter="active" onclick="IpmPage.filterCases('active')">Active (${cases.filter(c => c.status === 'active').length})</span>
          <span class="pill" data-filter="monitoring" onclick="IpmPage.filterCases('monitoring')">Monitoring (${cases.filter(c => c.status === 'monitoring').length})</span>
          <span class="pill" data-filter="resolved" onclick="IpmPage.filterCases('resolved')">Resolved (${cases.filter(c => c.status === 'resolved').length})</span>
        </div>

        <div class="card">
          <div id="ipmList">
            ${cases.length === 0 ? `
              <div class="empty-state">
                <h3>No IPM cases</h3>
                <p>Create an IPM case from a property's detail page to start tracking pest issues.</p>
              </div>
            ` : cases.map(c => `
              <div class="data-row" data-status="${c.status}" onclick="App.navigate('ipm', 'view', ${c.id})">
                <div class="data-row-main">
                  <h4>${this.esc(c.issue_description.substring(0, 80))}${c.issue_description.length > 80 ? '...' : ''}</h4>
                  <p>${this.esc(c.property_customer_name || 'Unknown')} &middot; ${this.esc(c.property_address || '')}</p>
                  <p style="font-size:12px;color:var(--gray-500);">
                    Opened ${c.created_at?.split('T')[0] || ''} &middot;
                    ${c.observation_count || 0} observation${(c.observation_count || 0) !== 1 ? 's' : ''}
                  </p>
                </div>
                <div class="data-row-right">
                  <span class="badge ipm-status-${c.status}">${c.status}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  filterCases(filter) {
    document.querySelectorAll('#ipmFilters .pill').forEach(p => {
      p.classList.toggle('active', p.dataset.filter === filter);
    });
    document.querySelectorAll('#ipmList .data-row').forEach(row => {
      row.style.display = (filter === 'all' || row.dataset.status === filter) ? '' : 'none';
    });
  },

  async renderDetail(caseId) {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const c = await Api.get(`/api/ipm/cases/${caseId}`);

      main.innerHTML = `
        <span class="back-link" onclick="App.navigate('ipm')">&larr; IPM Cases</span>

        <div class="card">
          <div class="card-header">
            <h3>IPM Case #${c.id}</h3>
            <span class="badge ipm-status-${c.status}">${c.status}</span>
          </div>
          <div class="card-body">
            <div class="detail-row">
              <span class="detail-label">Property</span>
              <span class="detail-value">
                <a href="#properties/view/${c.property_id}" style="color:var(--green-dark);font-weight:600;">
                  ${this.esc(c.property_customer_name || 'View Property')}
                </a>
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Issue</span>
              <span class="detail-value" style="max-width:70%;text-align:right;">${this.esc(c.issue_description)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Opened</span>
              <span class="detail-value">${c.created_at?.split('T')[0] || ''}</span>
            </div>
            ${c.resolved_at ? `<div class="detail-row"><span class="detail-label">Resolved</span><span class="detail-value">${c.resolved_at.split('T')[0]}</span></div>` : ''}
          </div>
        </div>

        <!-- Status Actions -->
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
          ${c.status === 'active' ? `
            <button class="btn btn-sm btn-outline" onclick="IpmPage.changeStatus(${c.id}, 'monitoring')">Move to Monitoring</button>
            <button class="btn btn-sm btn-primary" onclick="IpmPage.changeStatus(${c.id}, 'resolved')">Resolve Case</button>
          ` : ''}
          ${c.status === 'monitoring' ? `
            <button class="btn btn-sm btn-outline" onclick="IpmPage.changeStatus(${c.id}, 'active')">Reopen as Active</button>
            <button class="btn btn-sm btn-primary" onclick="IpmPage.changeStatus(${c.id}, 'resolved')">Resolve Case</button>
          ` : ''}
          ${c.status === 'resolved' ? `
            <button class="btn btn-sm btn-outline" onclick="IpmPage.changeStatus(${c.id}, 'active')">Reopen Case</button>
          ` : ''}
        </div>

        <!-- Add Observation Form -->
        <div class="card" style="margin-bottom:16px;">
          <div class="card-header"><h3>Add Observation</h3></div>
          <div class="card-body">
            <form id="obsForm" class="app-form">
              <div class="form-group">
                <label>Notes *</label>
                <textarea name="notes" rows="3" placeholder="Describe what you observed..." required></textarea>
              </div>
              <div class="form-group">
                <label>Photo (optional)</label>
                <input type="file" name="photo" accept="image/*" capture="environment" style="font-size:16px;">
              </div>
              <button type="submit" class="btn btn-primary btn-sm">Add Observation</button>
            </form>
          </div>
        </div>

        <!-- Observations Timeline -->
        <h3 style="color:var(--blue);font-size:16px;margin-bottom:12px;">Observations (${(c.observations || []).length})</h3>
        ${(c.observations || []).length === 0 ? `
          <div class="empty-state" style="padding:20px;"><p>No observations yet. Add your first observation above.</p></div>
        ` : `
          <div class="timeline">
            ${c.observations.map(obs => `
              <div class="timeline-item">
                <div class="timeline-date">${obs.created_at?.split('T')[0] || ''} ${obs.created_at?.split('T')[1]?.substring(0, 5) || ''}</div>
                <div class="timeline-content">
                  <p>${this.esc(obs.notes)}</p>
                  ${obs.photos && obs.photos.length > 0 ? `
                    <div class="photo-grid">
                      ${obs.photos.map(ph => `
                        <img src="/api/ipm/photos/${ph.id}" alt="${this.esc(ph.original_filename)}" onclick="IpmPage.showLightbox('/api/ipm/photos/${ph.id}')" loading="lazy">
                      `).join('')}
                    </div>
                  ` : ''}
                  <div class="timeline-user">by ${this.esc(obs.created_by_name || 'Unknown')}</div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      `;

      // Observation form submit
      document.getElementById('obsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const notes = form.notes.value.trim();
        if (!notes) return;

        try {
          // Create observation first
          const obs = await Api.post(`/api/ipm/cases/${caseId}/observations`, { notes });

          // If photo selected, upload it
          const fileInput = form.photo;
          if (fileInput.files && fileInput.files[0]) {
            const formData = new FormData();
            formData.append('photo', fileInput.files[0]);
            await fetch(`/api/ipm/observations/${obs.id}/photos`, {
              method: 'POST',
              body: formData
            });
          }

          App.toast('Observation added', 'success');
          this.renderDetail(caseId); // Refresh
        } catch (err) {
          App.toast(err.message, 'error');
        }
      });
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  async changeStatus(caseId, newStatus) {
    try {
      await Api.put(`/api/ipm/cases/${caseId}`, { status: newStatus });
      App.toast(`Case status changed to ${newStatus}`, 'success');
      this.renderDetail(caseId);
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  async showNewCaseModal(propertyId) {
    // Create a modal for new IPM case
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>New IPM Case</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <form id="newCaseForm" class="app-form">
            <div class="form-group">
              <label>Issue Description *</label>
              <textarea name="issue_description" rows="4" placeholder="Describe the pest or issue observed..." required></textarea>
            </div>
            <button type="submit" class="btn btn-primary btn-full">Create Case</button>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Form submit
    document.getElementById('newCaseForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const issue = e.target.issue_description.value.trim();
      if (!issue) return;

      try {
        const newCase = await Api.post('/api/ipm/cases', {
          property_id: propertyId,
          issue_description: issue
        });
        overlay.remove();
        App.toast('IPM case created', 'success');
        App.navigate('ipm', 'view', newCase.id);
      } catch (err) {
        App.toast(err.message, 'error');
      }
    });
  },

  showLightbox(src) {
    const existing = document.querySelector('.lightbox');
    if (existing) existing.remove();

    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `
      <button class="lightbox-close" onclick="this.parentElement.remove()">&times;</button>
      <img src="${src}" alt="Photo">
    `;
    lb.addEventListener('click', (e) => {
      if (e.target === lb) lb.remove();
    });
    document.body.appendChild(lb);
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }
};
