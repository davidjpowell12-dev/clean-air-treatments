// Scheduling Page — daily schedule, season generation, season overview, calendar
const SchedulingPage = {
  _techs: [],
  _selectedDate: null,
  _calYear: null,
  _calMonth: null,
  _routeResult: null,

  async render(action, id) {
    if (action === 'add') return this.renderAddProperties();
    if (action === 'season') return this.renderGenerateSeason();
    if (action === 'overview') return this.renderSeasonOverview();
    if (action === 'calendar') return this.renderCalendar();
    return this.renderDaily();
  },

  _formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  },

  _shortDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  _isoDate(d) {
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${dy}`;
  },

  _today() {
    return this._isoDate(new Date());
  },

  _shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return this._isoDate(d);
  },

  _mondayOf(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return this._isoDate(d);
  },

  _nextMonday() {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
    d.setDate(d.getDate() + diff);
    return this._isoDate(d);
  },

  async _loadTechs() {
    if (this._techs.length === 0) {
      try { this._techs = await Api.get('/api/schedules/meta/technicians'); } catch (e) { this._techs = []; }
    }
    return this._techs;
  },

  // ==================== DAILY VIEW ====================
  async renderDaily() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const date = this._selectedDate || this._today();
    this._selectedDate = date;

    const [entries, techs, weekData] = await Promise.all([
      Api.get(`/api/schedules/daily?date=${date}`),
      this._loadTechs(),
      Api.get(`/api/schedules/week?start=${this._mondayOf(date)}`)
    ]);

    const total = entries.length;
    const completed = entries.filter(e => e.status === 'completed').length;
    const remaining = total - completed;

    const monday = this._mondayOf(date);
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = this._shiftDate(monday, i);
      const wd = weekData.find(w => w.scheduled_date === d);
      weekDays.push({ date: d, total: wd ? wd.total : 0, completed: wd ? wd.completed : 0 });
    }

    const techOptions = techs.map(t => `<option value="${t.id}">${t.full_name}</option>`).join('');

    main.innerHTML = `
      <div class="page-header">
        <h2>Schedule</h2>
      </div>

      <div class="card" style="margin-bottom: 12px;">
        <div class="week-bar">
          ${weekDays.map(wd => {
            const dayName = new Date(wd.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
            const dayNum = new Date(wd.date + 'T12:00:00').getDate();
            const isToday = wd.date === this._today();
            const isSelected = wd.date === date;
            return `<div class="week-day ${isSelected ? 'week-day-selected' : ''} ${isToday ? 'week-day-today' : ''}"
                         data-date="${wd.date}">
              <span class="week-day-name">${dayName}</span>
              <span class="week-day-num">${dayNum}</span>
              ${wd.total > 0 ? `<span class="week-day-count">${wd.completed}/${wd.total}</span>` : '<span class="week-day-count">&ndash;</span>'}
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="schedule-date-nav">
        <button id="prevDay" class="btn btn-sm btn-outline">&larr;</button>
        <input type="date" id="schedDate" value="${date}" class="schedule-date-input">
        <button id="nextDay" class="btn btn-sm btn-outline">&rarr;</button>
      </div>

      <div class="stat-grid" style="margin-bottom: 12px;">
        <div class="stat-card">
          <div class="stat-value">${total}</div>
          <div class="stat-label">Scheduled</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${completed}</div>
          <div class="stat-label">Completed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${remaining}</div>
          <div class="stat-label">Remaining</div>
        </div>
      </div>

      <div style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
        <button id="addPropsBtn" class="btn btn-primary btn-sm">+ Add Properties</button>
        <button id="calendarBtn" class="btn btn-outline btn-sm">Calendar</button>
        <button id="genSeasonBtn" class="btn btn-outline btn-sm">Generate Season</button>
        <button id="seasonOverviewBtn" class="btn btn-outline btn-sm">Season Overview</button>
        ${total >= 2 ? `<button id="optimizeRouteBtn" class="btn btn-outline btn-sm">&#128205; Optimize Route</button>` : ''}
        <div style="display: flex; align-items: center; gap: 6px;">
          <select id="bulkTech" class="form-select-sm">
            <option value="">Assign tech...</option>
            ${techOptions}
          </select>
          <button id="assignAllBtn" class="btn btn-outline btn-sm">Assign All</button>
        </div>
      </div>

      ${this._routeResult && this._routeResult.date === date ? `
        <div style="background:var(--green-50,#f0faf0);border:1px solid var(--green-200,#a3d9a5);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <span style="font-size:14px;color:var(--green-800,#276749);">&#128694; Route optimized &mdash; ~${this._routeResult.total_minutes} min driving &bull; ${this._routeResult.stop_count} stops</span>
          <a href="${this._routeResult.maps_url}" target="_blank" rel="noopener" class="btn btn-sm btn-outline" style="white-space:nowrap;">Open in Maps</a>
        </div>
      ` : ''}

      <div class="card">
        <div class="card-header"><h3>${this._formatDate(date)}</h3></div>
        <div id="scheduleList" class="card-body" style="padding: 0;">
          ${total === 0 ? `
            <div class="empty-state">
              <p>No properties scheduled for this date.</p>
              <button class="btn btn-primary" id="addPropsEmpty">Add Properties</button>
            </div>
          ` : entries.map((e, idx) => this._renderEntry(e, idx, techs)).join('')}
        </div>
      </div>

      <!-- Reschedule modal -->
      <div id="rescheduleModal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3>Reschedule Visit</h3>
            <button class="modal-close" id="rescheduleClose">&times;</button>
          </div>
          <div class="modal-body">
            <p id="rescheduleInfo"></p>
            <div class="form-group">
              <label>Move to Date</label>
              <input type="date" id="rescheduleDate">
            </div>
            <button id="rescheduleConfirm" class="btn btn-primary btn-full">Move Visit</button>
          </div>
        </div>
      </div>
    `;

    // Nav events
    document.getElementById('prevDay').addEventListener('click', () => {
      this._selectedDate = this._shiftDate(date, -1);
      this.renderDaily();
    });
    document.getElementById('nextDay').addEventListener('click', () => {
      this._selectedDate = this._shiftDate(date, 1);
      this.renderDaily();
    });
    document.getElementById('schedDate').addEventListener('change', (e) => {
      this._selectedDate = e.target.value;
      this.renderDaily();
    });

    document.getElementById('addPropsBtn').addEventListener('click', () => App.navigate('scheduling', 'add'));
    document.getElementById('calendarBtn').addEventListener('click', () => App.navigate('scheduling', 'calendar'));
    document.getElementById('genSeasonBtn').addEventListener('click', () => App.navigate('scheduling', 'season'));
    document.getElementById('seasonOverviewBtn').addEventListener('click', () => App.navigate('scheduling', 'overview'));
    const addEmpty = document.getElementById('addPropsEmpty');
    if (addEmpty) addEmpty.addEventListener('click', () => App.navigate('scheduling', 'add'));

    const optimizeBtn = document.getElementById('optimizeRouteBtn');
    if (optimizeBtn) {
      optimizeBtn.addEventListener('click', async () => {
        optimizeBtn.disabled = true;
        optimizeBtn.textContent = 'Optimizing...';
        try {
          const result = await Api.post('/api/schedules/optimize-route', { date });
          this._routeResult = { ...result, date };
          App.toast(`Route optimized! ~${result.total_minutes} min drive time`, 'success');
          this.renderDaily();
        } catch (err) {
          App.toast(err.message || 'Optimization failed', 'error');
          optimizeBtn.disabled = false;
          optimizeBtn.innerHTML = '&#128205; Optimize Route';
        }
      });
    }

    document.getElementById('assignAllBtn').addEventListener('click', async () => {
      const techId = document.getElementById('bulkTech').value;
      if (!techId) return App.toast('Select a technician first', 'error');
      await Api.put(`/api/schedules/assign-all/${date}`, { assigned_to: Number(techId) });
      App.toast('Technician assigned to all entries');
      this.renderDaily();
    });

    document.querySelectorAll('.week-day').forEach(el => {
      el.addEventListener('click', () => {
        this._selectedDate = el.dataset.date;
        this.renderDaily();
      });
    });

    this._bindEntryActions(entries, date);

    // Reschedule modal
    document.getElementById('rescheduleClose').addEventListener('click', () => {
      document.getElementById('rescheduleModal').classList.remove('open');
    });
    document.getElementById('rescheduleModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
    });
  },

  _svcColor(serviceType) {
    if (!serviceType) return '';
    const lower = serviceType.toLowerCase();
    if (lower.includes('fert') || lower.includes('weed')) return 'green';
    if (lower.includes('mosquito') || lower.includes('tick')) return 'purple';
    if (lower.includes('aerat') || lower.includes('seed') || lower.includes('compost') || lower.includes('topdress')) return 'amber';
    return 'blue';
  },

  _svcBorderColor(serviceType) {
    if (!serviceType) return '';
    const lower = serviceType.toLowerCase();
    if (lower.includes('fert') || lower.includes('weed')) return '#78be20';
    if (lower.includes('mosquito') || lower.includes('tick')) return '#7c3aed';
    if (lower.includes('aerat') || lower.includes('seed') || lower.includes('compost') || lower.includes('topdress')) return '#f59e0b';
    return '#3b82f6';
  },

  _renderEntry(e, idx, techs) {
    const statusClass = e.status === 'completed' ? 'badge-green' : e.status === 'skipped' ? 'badge-gray' : 'badge-blue';
    const statusLabel = e.status.charAt(0).toUpperCase() + e.status.slice(1);
    const techOptions = techs.map(t =>
      `<option value="${t.id}" ${e.assigned_to === t.id ? 'selected' : ''}>${t.full_name}</option>`
    ).join('');
    const svcColor = this._svcColor(e.service_type);

    return `
      <div class="schedule-entry ${e.status === 'completed' ? 'schedule-entry-done' : ''}" data-id="${e.id}" ${svcColor ? `data-svc-color="${svcColor}"` : ''}>
        <div class="schedule-entry-main">
          <div class="schedule-entry-order">${idx + 1}</div>
          <div class="schedule-entry-info">
            <div class="schedule-entry-name">${e.customer_name}</div>
            <div class="schedule-entry-addr">${e.address}${e.city ? ', ' + e.city : ''}</div>
            ${e.service_type ? `<div style="margin-top:2px;"><span class="svc-pill svc-pill-${svcColor || 'blue'}">${e.service_type}</span></div>` : ''}
            ${e.sqft ? `<div class="schedule-entry-meta">${Number(e.sqft).toLocaleString()} sq ft</div>` : ''}
            ${e.phone ? `<div class="schedule-entry-meta"><a href="tel:${e.phone}">${e.phone}</a></div>` : ''}
            ${e.notes ? `<div class="schedule-entry-notes">${e.notes}</div>` : ''}
          </div>
        </div>
        <div class="schedule-entry-actions">
          <div style="display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end;">
            <span class="badge ${statusClass}">${statusLabel}</span>
            ${e.round_number ? `<span class="badge badge-orange">R${e.round_number}/${e.total_rounds}</span>` : ''}
          </div>
          <select class="tech-select form-select-sm" data-id="${e.id}">
            <option value="">No tech</option>
            ${techOptions}
          </select>
          <div class="schedule-entry-btns">
            ${e.status !== 'completed' ? `<button class="btn btn-sm btn-primary sched-complete" data-id="${e.id}" data-property-id="${e.property_id}" data-date="${e.scheduled_date}" data-round="${e.round_number || ''}" data-total="${e.total_rounds || ''}" title="Complete &amp; Log Application">&#10003;</button>` : ''}
            ${e.status === 'scheduled' ? `<button class="btn btn-sm btn-outline sched-reschedule" data-id="${e.id}" data-name="${e.customer_name}" data-round="${e.round_number || ''}" data-total="${e.total_rounds || ''}" title="Reschedule">&#8644;</button>` : ''}
            <button class="btn btn-sm btn-outline sched-edit-service" data-id="${e.id}" data-current="${(e.service_type || '').replace(/"/g, '&quot;')}" data-name="${(e.customer_name || '').replace(/"/g, '&quot;')}" title="Edit service type">&#9998;</button>
            ${e.status !== 'skipped' ? `<button class="btn btn-sm btn-outline sched-skip" data-id="${e.id}" title="Skip">Skip</button>` : ''}
            ${e.status !== 'scheduled' ? `<button class="btn btn-sm btn-outline sched-reset" data-id="${e.id}" title="Reset">Reset</button>` : ''}
            <button class="btn btn-sm btn-outline sched-remove" data-id="${e.id}" title="Remove">&times;</button>
          </div>
        </div>
      </div>
    `;
  },

  _bindEntryActions(entries, date) {
    document.querySelectorAll('.sched-complete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const scheduleId = btn.dataset.id;
        const propertyId = btn.dataset.propertyId;
        const date = btn.dataset.date;
        const round = btn.dataset.round;
        const total = btn.dataset.total;

        // Look up the entry's service_type and find a matching service to see
        // if it requires a full MDARD application record. Non-chemical services
        // (Mowing, Clean-Ups, Aeration, etc) get a quick-complete modal
        // instead of the full application form — just notes + save.
        const entry = entries.find(e => String(e.id) === String(scheduleId));
        const serviceType = (entry && entry.service_type) || '';
        let requiresApp = true;
        if (serviceType) {
          try {
            const services = await Api.get('/api/services');
            const match = (services || []).find(s =>
              s.name && (
                s.name.toLowerCase() === serviceType.toLowerCase() ||
                serviceType.toLowerCase().includes(s.name.toLowerCase()) ||
                s.name.toLowerCase().includes(serviceType.toLowerCase())
              )
            );
            if (match) requiresApp = match.requires_application !== 0;
          } catch (e) { /* default to requiring application for safety */ }
        }

        if (requiresApp) {
          // Full application form (original behavior)
          window._scheduleContext = { scheduleId, propertyId, date, round, total };
          App.navigate('applications', 'new', null);
        } else {
          // Quick-complete modal: notes + save only
          this._showQuickCompleteModal(scheduleId, entry);
        }
      });
    });

    document.querySelectorAll('.sched-skip').forEach(btn => {
      btn.addEventListener('click', async () => {
        await Api.put(`/api/schedules/${btn.dataset.id}`, { status: 'skipped' });
        this.renderDaily();
      });
    });

    document.querySelectorAll('.sched-reset').forEach(btn => {
      btn.addEventListener('click', async () => {
        await Api.put(`/api/schedules/${btn.dataset.id}`, { status: 'scheduled' });
        this.renderDaily();
      });
    });

    document.querySelectorAll('.sched-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this property from the schedule?')) return;
        await Api.delete(`/api/schedules/${btn.dataset.id}`);
        App.toast('Removed from schedule');
        this.renderDaily();
      });
    });

    document.querySelectorAll('.tech-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        await Api.put(`/api/schedules/${sel.dataset.id}`, {
          assigned_to: sel.value ? Number(sel.value) : null
        });
      });
    });

    document.querySelectorAll('.schedule-entry-name').forEach(el => {
      const entry = entries.find(e => e.id === Number(el.closest('.schedule-entry').dataset.id));
      if (entry) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => App.navigate('properties', 'view', entry.property_id));
      }
    });

    // Edit service type buttons
    document.querySelectorAll('.sched-edit-service').forEach(btn => {
      btn.addEventListener('click', () => {
        this._showEditServiceModal(btn.dataset.id, btn.dataset.current, btn.dataset.name);
      });
    });

    // Reschedule buttons
    document.querySelectorAll('.sched-reschedule').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.name;
        const round = btn.dataset.round;
        const total = btn.dataset.total;
        const info = round ? `Treatment ${round} of ${total} for ${name}` : name;
        document.getElementById('rescheduleInfo').textContent = info;
        document.getElementById('rescheduleDate').value = '';
        document.getElementById('rescheduleModal').classList.add('open');

        document.getElementById('rescheduleConfirm').onclick = async () => {
          const newDate = document.getElementById('rescheduleDate').value;
          if (!newDate) return App.toast('Pick a date', 'error');
          await Api.put(`/api/schedules/${btn.dataset.id}/reschedule`, { new_date: newDate });
          document.getElementById('rescheduleModal').classList.remove('open');
          App.toast('Visit rescheduled');
          this.renderDaily();
        };
      });
    });
  },

  _esc(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
    );
  },

  // Quick-complete modal for non-chemical services (Mowing, Clean-Ups,
  // Aeration, etc). Just a notes field + Save — no product, no EPA, no
  // app rates. Skips the full MDARD application form entirely.
  _showQuickCompleteModal(scheduleId, entry) {
    const customerName = (entry && entry.customer_name) || 'this visit';
    const serviceType = (entry && entry.service_type) || 'Service';
    document.querySelector('.modal-overlay.quick-complete-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay quick-complete-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Mark Complete</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <p style="font-size:14px;color:var(--gray-700);margin-bottom:4px;"><strong>${this._esc ? this._esc(customerName) : customerName}</strong></p>
          <p style="font-size:13px;color:var(--gray-500);margin-bottom:14px;">${this._esc ? this._esc(serviceType) : serviceType}</p>
          <div class="form-group" style="margin-bottom:0;">
            <label style="font-size:13px;">Notes (optional)</label>
            <textarea id="quickCompleteNotes" rows="3" placeholder="e.g. Mowed everything, left the side gate locked" style="width:100%;padding:8px;border:1px solid var(--gray-300);border-radius:6px;font-family:inherit;font-size:14px;"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="qcCancel" style="margin-left:auto;">Cancel</button>
          <button class="btn btn-primary" id="qcSave">\u2713 Mark Complete</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('#qcCancel').addEventListener('click', close);
    overlay.querySelector('#qcSave').addEventListener('click', async () => {
      const notes = document.getElementById('quickCompleteNotes').value.trim();
      try {
        await Api.put('/api/schedules/' + scheduleId, {
          status: 'completed',
          notes: notes || null
        });
        App.toast('Marked complete', 'success');
        close();
        this.renderDaily();
      } catch (err) {
        App.toast('Failed: ' + err.message, 'error');
      }
    });
  },

  // Small modal to change a schedule entry's service type.
  // Used to fix mis-scheduled visits (e.g. was logged as "Mowing" but was really Fert+Weed).
  async _showEditServiceModal(scheduleId, currentServiceType, customerName) {
    // Fetch services so we can offer the picker
    let services = [];
    try { services = await Api.get('/api/services').catch(() => []); } catch (e) { /* ok */ }

    document.querySelector('.modal-overlay.edit-service-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay edit-service-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Edit Service Type</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <p style="font-size:13px;color:var(--gray-600);margin-bottom:12px;">
            Change what <strong>${customerName || 'this visit'}</strong> was scheduled for. Useful if you picked the wrong service when scheduling.
          </p>
          <div class="form-group">
            <label>Pick from your services:</label>
            <div id="editSvcChips" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
              ${services.map(s => `
                <button type="button" class="svc-chip" data-name="${(s.name || '').replace(/"/g, '&quot;')}">${s.name}</button>
              `).join('')}
            </div>
          </div>
          <div class="form-group" style="margin-top:12px;">
            <label>Or type it (comma-separate for multiple services):</label>
            <input type="text" id="editSvcText" value="${(currentServiceType || '').replace(/"/g, '&quot;')}" placeholder="e.g. Fertilizer, Weed Control">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="editSvcCancel" style="margin-left:auto;">Cancel</button>
          <button class="btn btn-primary" id="editSvcSave">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const input = overlay.querySelector('#editSvcText');
    const close = () => {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 200);
    };
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('#editSvcCancel').addEventListener('click', close);

    // Chip click → append to the input (so user can build combos like "Fertilizer, Weed Control")
    overlay.querySelectorAll('.svc-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const name = chip.dataset.name;
        const current = input.value.trim();
        const names = current ? current.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (!names.includes(name)) names.push(name);
        input.value = names.join(', ');
      });
    });

    overlay.querySelector('#editSvcSave').addEventListener('click', async () => {
      const newVal = input.value.trim();
      if (!newVal) return App.toast('Service type cannot be empty', 'error');
      try {
        await Api.put('/api/schedules/' + scheduleId, { service_type: newVal });
        App.toast('Service type updated');
        close();
        this.renderDaily();
      } catch (err) {
        App.toast('Update failed: ' + err.message, 'error');
      }
    });
  },

  // ==================== ADD PROPERTIES (single date) ====================
  async renderAddProperties() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const date = this._selectedDate || this._today();
    const techs = await this._loadTechs();

    main.innerHTML = `
      <a href="#scheduling" class="back-link">&larr; Back to Schedule</a>
      <div class="card">
        <div class="card-header"><h3>Add Properties to ${this._formatDate(date)}</h3></div>
        <div class="card-body">
          <div class="form-group">
            <label>Date</label>
            <input type="date" id="addDate" value="${date}">
          </div>
          <div class="form-group">
            <label>Assign to Technician</label>
            <select id="addTech">
              <option value="">None (assign later)</option>
              ${techs.map(t => `<option value="${t.id}">${t.full_name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Search Properties</label>
            <input type="text" id="propSearch" placeholder="Search by name, address, city...">
          </div>
          <div id="propResults" style="margin-top: 8px;"></div>
          <div style="margin-top: 16px; display: flex; gap: 8px; align-items: center;">
            <button id="addSelectedBtn" class="btn btn-primary" disabled>Add Selected (0)</button>
            <button id="selectAllBtn" class="btn btn-outline btn-sm">Select All</button>
          </div>
        </div>
      </div>
    `;

    let allProperties = [];
    let selected = new Set();

    const loadProperties = async () => {
      const addDate = document.getElementById('addDate').value;
      const search = document.getElementById('propSearch').value;
      const url = `/api/schedules/unscheduled?date=${addDate}${search ? '&search=' + encodeURIComponent(search) : ''}`;
      try { allProperties = await Api.get(url); } catch (err) { allProperties = []; }
      renderResults();
    };

    const renderResults = () => {
      const container = document.getElementById('propResults');
      if (allProperties.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No unscheduled properties found.</p></div>';
        return;
      }
      container.innerHTML = allProperties.map(p => `
        <div class="data-row" style="cursor: pointer;" data-pid="${p.id}">
          <label style="display: flex; align-items: center; gap: 10px; width: 100%; cursor: pointer; padding: 0;">
            <input type="checkbox" class="prop-check" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>
            <div class="data-row-main" style="padding: 0;">
              <div class="data-row-title">${p.customer_name}</div>
              <div class="data-row-subtitle">${p.address}${p.city ? ', ' + p.city : ''}</div>
            </div>
            ${p.sqft ? `<div class="data-row-right"><span class="badge badge-gray">${Number(p.sqft).toLocaleString()} ft²</span></div>` : ''}
          </label>
        </div>
      `).join('');
      container.querySelectorAll('.prop-check').forEach(cb => {
        cb.addEventListener('change', () => {
          const id = Number(cb.value);
          if (cb.checked) selected.add(id); else selected.delete(id);
          updateBtn();
        });
      });
    };

    const updateBtn = () => {
      const btn = document.getElementById('addSelectedBtn');
      btn.textContent = `Add Selected (${selected.size})`;
      btn.disabled = selected.size === 0;
    };

    let timer;
    document.getElementById('propSearch').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(loadProperties, 300);
    });

    document.getElementById('addDate').addEventListener('change', () => {
      selected.clear();
      updateBtn();
      loadProperties();
    });

    document.getElementById('selectAllBtn').addEventListener('click', () => {
      allProperties.forEach(p => selected.add(p.id));
      renderResults();
      updateBtn();
    });

    document.getElementById('addSelectedBtn').addEventListener('click', async () => {
      const addDate = document.getElementById('addDate').value;
      const techId = document.getElementById('addTech').value;
      try {
        const result = await Api.post('/api/schedules/bulk', {
          property_ids: Array.from(selected),
          scheduled_date: addDate,
          assigned_to: techId ? Number(techId) : null
        });
        App.toast(`Added ${result.added} properties to schedule`);
        this._selectedDate = addDate;
        App.navigate('scheduling');
      } catch (err) {
        App.toast('Error: ' + (err.message || 'Unknown error'), 'error');
      }
    });

    loadProperties();
  },

  // ==================== GENERATE SEASON ====================
  async renderGenerateSeason() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    // Load services + techs in parallel. Service dropdown is populated
    // from the pricing matrix so whatever the admin has configured
    // (including Mowing, Fert & Weed Control, Mosquito & Tick Control,
    // etc) shows up here with exact name matching — no more drift
    // between estimate items and schedule service types.
    const [techs, services] = await Promise.all([
      this._loadTechs(),
      Api.get('/api/services').catch(() => [])
    ]);
    const activeServices = (services || []).filter(s => s.is_active !== 0);
    const startDate = this._nextMonday();
    const year = startDate.slice(0, 4);

    main.innerHTML = `
      <a href="#scheduling" class="back-link">&larr; Back to Schedule</a>
      <div class="card">
        <div class="card-header"><h3>Generate Season</h3></div>
        <div class="card-body">
          <p class="form-hint" style="margin-bottom: 16px;">Generate a season program for selected properties. Pick a service type to schedule separately (e.g., mowing first, then fert &amp; weed).</p>

          <div class="form-group">
            <label>Service Type</label>
            <select id="seasonServiceType" style="font-weight:600;">
              ${activeServices.map(s => {
                const safe = String(s.name || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
                return `<option value="${safe}">${safe}</option>`;
              }).join('')}
              <option value="">Other / General</option>
            </select>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Start Date</label>
              <input type="date" id="seasonStart" value="${startDate}">
            </div>
            <div class="form-group">
              <label>Treatments</label>
              <input type="number" id="seasonRounds" min="1" max="52" value="6" style="width:100%;padding:8px 10px;border:2px solid var(--gray-200);border-radius:6px;font-size:16px;font-weight:600;">
            </div>
            <div class="form-group">
              <label>Weeks Apart</label>
              <select id="seasonInterval">
                <option value="2">2 wks</option>
                <option value="3">3 wks</option>
                <option value="4">4 wks</option>
                <option value="5">5 wks</option>
                <option value="6" selected>6 wks</option>
                <option value="7">7 wks</option>
                <option value="8">8 wks</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label>Assign to Technician</label>
            <select id="seasonTech">
              <option value="">None (assign later)</option>
              ${techs.map(t => `<option value="${t.id}">${t.full_name}</option>`).join('')}
            </select>
          </div>

          <div id="seasonPreview" class="season-preview-box" style="margin-bottom: 16px;"></div>

          <div class="form-group">
            <label>Select Properties</label>
            <input type="text" id="seasonSearch" placeholder="Search by name, address, city...">
          </div>
          <div id="seasonResults" style="margin-top: 8px;"></div>
          <div style="margin-top: 16px; display: flex; gap: 8px; align-items: center;">
            <button id="generateBtn" class="btn btn-primary" disabled>Generate Season (0)</button>
            <button id="seasonSelectAll" class="btn btn-outline btn-sm">Select All</button>
          </div>
        </div>
      </div>
    `;

    let allProperties = [];
    let selected = new Set();

    const updatePreview = () => {
      const start = document.getElementById('seasonStart').value;
      const weeks = Number(document.getElementById('seasonInterval').value);
      const rounds = Number(document.getElementById('seasonRounds').value);
      const svcType = document.getElementById('seasonServiceType').value;
      const box = document.getElementById('seasonPreview');
      if (selected.size === 0) {
        box.innerHTML = '';
        return;
      }
      const dates = [];
      for (let r = 0; r < rounds; r++) {
        dates.push(this._shortDate(this._shiftDate(start, r * weeks * 7)));
      }
      box.innerHTML = `
        <div class="card" style="background: var(--gray-50); margin: 0;">
          <div class="card-body" style="padding: 10px 14px;">
            <strong>${selected.size} properties &times; ${rounds} visits = ${selected.size * rounds} total entries</strong>
            ${svcType ? `<br><span style="font-size:12px;color:var(--green-dark);font-weight:600;">${svcType}</span>` : ''}
            <br>
            <span style="font-size: 13px; color: var(--gray-700);">
              ${dates.map((d, i) => `R${i + 1}: ${d}`).join(' &middot; ')}
            </span>
          </div>
        </div>
      `;
    };

    const loadProperties = async () => {
      const yr = document.getElementById('seasonStart').value.slice(0, 4);
      const search = document.getElementById('seasonSearch').value;
      const svcType = document.getElementById('seasonServiceType').value;
      let url = `/api/schedules/unscheduled-programs?year=${yr}`;
      if (svcType) url += `&service_type=${encodeURIComponent(svcType)}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      try { allProperties = await Api.get(url); } catch (err) { allProperties = []; }
      renderResults();
    };

    const renderResults = () => {
      const container = document.getElementById('seasonResults');
      if (allProperties.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>All properties already have a season scheduled.</p></div>';
        return;
      }
      container.innerHTML = allProperties.map(p => `
        <div class="data-row" style="cursor: pointer;">
          <label style="display: flex; align-items: center; gap: 10px; width: 100%; cursor: pointer; padding: 0;">
            <input type="checkbox" class="season-check" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>
            <div class="data-row-main" style="padding: 0;">
              <div class="data-row-title">${p.customer_name}</div>
              <div class="data-row-subtitle">${p.address}${p.city ? ', ' + p.city : ''}</div>
            </div>
          </label>
        </div>
      `).join('');
      container.querySelectorAll('.season-check').forEach(cb => {
        cb.addEventListener('change', () => {
          const id = Number(cb.value);
          if (cb.checked) selected.add(id); else selected.delete(id);
          updateBtn();
          updatePreview();
        });
      });
    };

    const updateBtn = () => {
      const btn = document.getElementById('generateBtn');
      btn.textContent = `Generate Season (${selected.size})`;
      btn.disabled = selected.size === 0;
    };

    let timer;
    document.getElementById('seasonSearch').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(loadProperties, 300);
    });

    document.getElementById('seasonStart').addEventListener('change', () => {
      selected.clear();
      updateBtn();
      updatePreview();
      loadProperties();
    });

    document.getElementById('seasonInterval').addEventListener('change', updatePreview);
    document.getElementById('seasonRounds').addEventListener('change', updatePreview);
    document.getElementById('seasonServiceType').addEventListener('change', () => {
      selected.clear();
      updateBtn();
      updatePreview();
      loadProperties();
    });

    document.getElementById('seasonSelectAll').addEventListener('click', () => {
      allProperties.forEach(p => selected.add(p.id));
      renderResults();
      updateBtn();
      updatePreview();
    });

    document.getElementById('generateBtn').addEventListener('click', async () => {
      const btn = document.getElementById('generateBtn');
      btn.disabled = true;
      btn.textContent = 'Generating...';
      try {
        const svcType = document.getElementById('seasonServiceType').value;
        const result = await Api.post('/api/schedules/generate-season', {
          property_ids: Array.from(selected),
          start_date: document.getElementById('seasonStart').value,
          interval_weeks: Number(document.getElementById('seasonInterval').value),
          total_rounds: Number(document.getElementById('seasonRounds').value),
          service_type: svcType || null,
          assigned_to: document.getElementById('seasonTech').value ? Number(document.getElementById('seasonTech').value) : null
        });
        const svcLabel = svcType ? ` for ${svcType}` : '';
        const msg = `Generated ${result.generated} visits${svcLabel} for ${selected.size} properties` +
          (result.skipped_properties > 0 ? ` (${result.skipped_properties} already scheduled)` : '');
        App.toast(msg);
        App.navigate('scheduling', 'overview');
      } catch (err) {
        App.toast('Error: ' + (err.message || 'Unknown error'), 'error');
        btn.disabled = false;
        btn.textContent = `Generate Season (${selected.size})`;
      }
    });

    loadProperties();
  },

  // ==================== SEASON OVERVIEW ====================
  async renderSeasonOverview() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const year = this._today().slice(0, 4);
    let programs;
    try {
      programs = await Api.get(`/api/schedules/season-overview?year=${year}`);
    } catch (err) {
      programs = [];
    }

    // Calculate stats
    const totalProperties = programs.length;
    let totalCompleted = 0;
    let totalRounds = 0;
    let behindCount = 0;
    const today = this._today();

    for (const p of programs) {
      for (const r of p.rounds) {
        totalRounds++;
        if (r.status === 'completed') totalCompleted++;
        if (r.status === 'scheduled' && r.scheduled_date < today) behindCount++;
      }
    }

    // Determine current round
    let currentRound = 1;
    if (programs.length > 0 && programs[0].rounds.length > 0) {
      for (const r of programs[0].rounds) {
        if (r.status === 'completed') currentRound = r.round_number + 1;
        else break;
      }
      if (currentRound > 6) currentRound = 6;
    }

    // Filter state
    const filterHTML = `
      <div class="tab-bar" style="margin-bottom: 12px;">
        <button class="tab active" data-filter="all">All (${totalProperties})</button>
        <button class="tab" data-filter="behind">Behind (${behindCount > 0 ? programs.filter(p => p.rounds.some(r => r.status === 'scheduled' && r.scheduled_date < today)).length : 0})</button>
        <button class="tab" data-filter="complete">Complete (${programs.filter(p => p.rounds.every(r => r.status === 'completed')).length})</button>
      </div>
    `;

    main.innerHTML = `
      <a href="#scheduling" class="back-link">&larr; Back to Schedule</a>
      <div class="page-header">
        <h2>Season Overview — ${year}</h2>
      </div>

      <div class="stat-grid" style="margin-bottom: 12px;">
        <div class="stat-card">
          <div class="stat-value">${totalProperties}</div>
          <div class="stat-label">Properties</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${totalCompleted}/${totalRounds}</div>
          <div class="stat-label">Visits Done</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${behindCount}</div>
          <div class="stat-label">Behind</div>
        </div>
      </div>

      ${programs.length > 0 ? `
        ${filterHTML}
        <div class="card">
          <div id="overviewList" class="card-body" style="padding: 0;">
            ${programs.map(p => this._renderSeasonCard(p, today)).join('')}
          </div>
        </div>
      ` : `
        <div class="card">
          <div class="empty-state">
            <p>No seasons generated yet.</p>
            <button class="btn btn-primary" id="goGenerate">Generate Season</button>
          </div>
        </div>
      `}
    `;

    // Filter tabs
    document.querySelectorAll('.tab[data-filter]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab[data-filter]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const filter = tab.dataset.filter;
        document.querySelectorAll('.season-card').forEach(card => {
          const isBehind = card.dataset.behind === 'true';
          const isComplete = card.dataset.complete === 'true';
          if (filter === 'all') card.style.display = '';
          else if (filter === 'behind') card.style.display = isBehind ? '' : 'none';
          else if (filter === 'complete') card.style.display = isComplete ? '' : 'none';
        });
      });
    });

    // Round dot clicks → navigate to that date
    document.querySelectorAll('.round-dot[data-date]').forEach(dot => {
      dot.addEventListener('click', () => {
        this._selectedDate = dot.dataset.date;
        App.navigate('scheduling');
      });
    });

    // Cancel season
    document.querySelectorAll('.cancel-season').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Cancel this season? Completed visits will be kept.')) return;
        await Api.delete(`/api/schedules/program/${btn.dataset.program}`);
        App.toast('Season cancelled');
        this.renderSeasonOverview();
      });
    });

    const goGen = document.getElementById('goGenerate');
    if (goGen) goGen.addEventListener('click', () => App.navigate('scheduling', 'season'));
  },

  _renderSeasonCard(p, today) {
    const completedCount = p.rounds.filter(r => r.status === 'completed').length;
    const isBehind = p.rounds.some(r => r.status === 'scheduled' && r.scheduled_date < today);
    const isComplete = p.rounds.every(r => r.status === 'completed');
    const pct = Math.round((completedCount / p.rounds.length) * 100);

    return `
      <div class="season-card" data-behind="${isBehind}" data-complete="${isComplete}">
        <div class="season-card-header">
          <div>
            <div class="season-card-name">${p.customer_name}</div>
            <div class="season-card-addr">${p.address}${p.city ? ', ' + p.city : ''}</div>
          </div>
          <span class="badge ${isComplete ? 'badge-green' : isBehind ? 'badge-red' : 'badge-blue'}">${completedCount}/${p.rounds.length}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
        <div class="season-rounds">
          ${p.rounds.map(r => {
            const dotClass = r.status === 'completed' ? 'round-dot-completed' : r.status === 'skipped' ? 'round-dot-skipped' : 'round-dot-scheduled';
            const overdue = r.status === 'scheduled' && r.scheduled_date < today;
            return `
              <div class="round-indicator">
                <div class="round-dot ${dotClass} ${overdue ? 'round-dot-overdue' : ''}" data-date="${r.scheduled_date}" style="cursor: pointer;" title="${this._formatDate(r.scheduled_date)}">
                  ${r.status === 'completed' ? '&#10003;' : r.round_number}
                </div>
                <span class="round-date">${this._shortDate(r.scheduled_date)}</span>
              </div>
            `;
          }).join('')}
        </div>
        <button class="cancel-season" data-program="${p.program_id}" style="font-size: 12px; color: var(--red); background: none; border: none; cursor: pointer; padding: 4px 0;">Cancel Season</button>
      </div>
    `;
  },

  // ==================== CALENDAR VIEW ====================
  async renderCalendar() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const now = new Date();
    if (this._calYear === null) this._calYear = now.getFullYear();
    if (this._calMonth === null) this._calMonth = now.getMonth();

    const year = this._calYear;
    const month = this._calMonth;

    let data;
    try {
      data = await Api.get(`/api/schedules/month?year=${year}&month=${month + 1}`);
    } catch (err) {
      data = { entries: [], grouped: {} };
    }
    const grouped = data.grouped || {};
    this._calGrouped = grouped;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    let startDow = firstDay.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;
    const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
    const monthName = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const todayStr = this._today();

    main.innerHTML = `
      <a href="#scheduling" class="back-link">&larr; Back to Schedule</a>
      <div class="page-header"><h2>Calendar</h2></div>

      <div class="cal-nav">
        <button id="calPrev" class="btn btn-sm btn-outline">&larr;</button>
        <span class="cal-month-label">${monthName}</span>
        <button id="calNext" class="btn btn-sm btn-outline">&rarr;</button>
        <button id="calToday" class="btn btn-sm btn-outline">Today</button>
      </div>

      <div class="cal-grid">
        <div class="cal-header-row">
          ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d =>
            `<div class="cal-header-cell">${d}</div>`
          ).join('')}
        </div>
        <div class="cal-body" id="calBody">
          ${this._buildCalendarCells(year, month, startDow, daysInMonth, totalCells, grouped, todayStr)}
        </div>
      </div>

      <p class="form-hint" style="margin-top: 10px; text-align: center;">Tap a day number to view details. Long-press an entry to drag it to another day.</p>
    `;

    // Month navigation
    document.getElementById('calPrev').addEventListener('click', () => {
      this._calMonth--;
      if (this._calMonth < 0) { this._calMonth = 11; this._calYear--; }
      this.renderCalendar();
    });
    document.getElementById('calNext').addEventListener('click', () => {
      this._calMonth++;
      if (this._calMonth > 11) { this._calMonth = 0; this._calYear++; }
      this.renderCalendar();
    });
    document.getElementById('calToday').addEventListener('click', () => {
      const n = new Date();
      this._calYear = n.getFullYear();
      this._calMonth = n.getMonth();
      this.renderCalendar();
    });

    // Tap day number → expanded day modal
    document.querySelectorAll('.cal-day-num[data-date]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showDayModal(el.dataset.date);
      });
    });

    // Tap "+N more" → expanded day modal
    document.querySelectorAll('.cal-entry-more[data-date]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showDayModal(el.dataset.date);
      });
    });

    // Init drag-and-drop (also handles entry tap → daily view)
    this._initCalendarDrag();
  },

  _buildCalendarCells(year, month, startDow, daysInMonth, totalCells, grouped, todayStr) {
    let html = '';
    for (let i = 0; i < totalCells; i++) {
      if (i % 7 === 0) html += '<div class="cal-row">';

      const dayNum = i - startDow + 1;
      const isInMonth = dayNum >= 1 && dayNum <= daysInMonth;

      if (isInMonth) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const entries = grouped[dateStr] || [];
        const isToday = dateStr === todayStr;
        const isWeekend = (i % 7) >= 5;

        html += `
          <div class="cal-cell ${isToday ? 'cal-cell-today' : ''} ${isWeekend ? 'cal-cell-weekend' : ''} ${entries.length > 0 ? 'cal-cell-has-entries' : ''}"
               data-date="${dateStr}">
            <div class="cal-day-num" data-date="${dateStr}">${dayNum}</div>
            ${entries.length > 0 ? `
              <div class="cal-entries">
                ${entries.slice(0, 2).map(e => {
                  const isOverdue = e.status === 'scheduled' && dateStr < todayStr;
                  const svcBorder = this._svcBorderColor(e.service_type);
                  return `
                  <div class="cal-entry cal-entry-${isOverdue ? 'overdue' : e.status}"
                       data-entry-id="${e.id}"
                       data-entry-name="${e.customer_name.replace(/"/g, '&quot;')}"
                       data-source-date="${dateStr}"
                       ${svcBorder ? `style="border-left-color:${svcBorder}; border-left-width:3px;"` : ''}>
                    <span class="cal-entry-name">${e.customer_name.length > 10 ? e.customer_name.substring(0, 10) + '…' : e.customer_name}</span>
                  </div>
                `;}).join('')}
                ${entries.length > 2 ? `<div class="cal-entry-more" data-date="${dateStr}">+${entries.length - 2} more</div>` : ''}
              </div>
            ` : ''}
            ${entries.length > 0 ? `<div class="cal-count-badge">${entries.length}</div>` : ''}
          </div>
        `;
      } else {
        html += '<div class="cal-cell cal-cell-outside"></div>';
      }

      if (i % 7 === 6) html += '</div>';
    }
    return html;
  },

  _initCalendarDrag() {
    const LONG_PRESS_MS = 300;
    const DRAG_THRESHOLD_PX = 5;
    const self = this;
    let pressTimer = null;
    let startX = 0, startY = 0;
    let isDragging = false;
    let dragEntry = null;
    let ghostEl = null;
    let sourceDate = null;
    let currentDropTarget = null;

    const calBody = document.getElementById('calBody');
    if (!calBody) return;

    calBody.addEventListener('pointerdown', (e) => {
      const entryEl = e.target.closest('.cal-entry[data-entry-id]');
      if (!entryEl) return;

      startX = e.clientX;
      startY = e.clientY;
      dragEntry = entryEl;
      sourceDate = entryEl.dataset.sourceDate;

      pressTimer = setTimeout(() => {
        isDragging = true;
        entryEl.classList.add('cal-entry-dragging');

        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';

        ghostEl = document.createElement('div');
        ghostEl.className = 'cal-drag-ghost';
        ghostEl.textContent = entryEl.dataset.entryName;
        ghostEl.style.left = e.clientX + 'px';
        ghostEl.style.top = e.clientY + 'px';
        document.body.appendChild(ghostEl);

        if (navigator.vibrate) navigator.vibrate(50);
      }, LONG_PRESS_MS);
    });

    calBody.addEventListener('pointermove', (e) => {
      if (pressTimer && !isDragging) {
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
        return;
      }

      if (!isDragging || !ghostEl) return;
      e.preventDefault();

      ghostEl.style.left = e.clientX + 'px';
      ghostEl.style.top = (e.clientY - 20) + 'px';

      ghostEl.style.pointerEvents = 'none';
      const target = document.elementFromPoint(e.clientX, e.clientY);
      ghostEl.style.pointerEvents = '';

      const cellEl = target ? target.closest('.cal-cell[data-date]') : null;

      if (currentDropTarget && currentDropTarget !== cellEl) {
        currentDropTarget.classList.remove('cal-cell-drop-target');
      }

      if (cellEl && cellEl.dataset.date !== sourceDate) {
        cellEl.classList.add('cal-cell-drop-target');
        currentDropTarget = cellEl;
      } else {
        currentDropTarget = null;
      }
    });

    const endDrag = async (e) => {
      clearTimeout(pressTimer);
      pressTimer = null;

      // Quick tap (no drag started) → navigate to daily view
      if (!isDragging && dragEntry) {
        const tapDate = dragEntry.dataset.sourceDate;
        dragEntry = null;
        sourceDate = null;
        self._selectedDate = tapDate;
        App.navigate('scheduling');
        return;
      }

      if (!isDragging) return;
      isDragging = false;

      document.body.style.overflow = '';
      document.body.style.touchAction = '';

      if (ghostEl) { ghostEl.remove(); ghostEl = null; }
      if (dragEntry) dragEntry.classList.remove('cal-entry-dragging');
      document.querySelectorAll('.cal-cell-drop-target').forEach(el =>
        el.classList.remove('cal-cell-drop-target')
      );

      if (currentDropTarget && dragEntry) {
        const entryId = dragEntry.dataset.entryId;
        const newDate = currentDropTarget.dataset.date;
        const entryName = dragEntry.dataset.entryName;

        // Optimistic UI: move the element
        dragEntry.dataset.sourceDate = newDate;
        let targetEntries = currentDropTarget.querySelector('.cal-entries');
        if (!targetEntries) {
          targetEntries = document.createElement('div');
          targetEntries.className = 'cal-entries';
          currentDropTarget.appendChild(targetEntries);
        }
        targetEntries.appendChild(dragEntry);

        // Update count badges
        self._updateCellBadge(document.querySelector(`.cal-cell[data-date="${sourceDate}"]`));
        self._updateCellBadge(currentDropTarget);

        try {
          await Api.put(`/api/schedules/${entryId}/reschedule`, { new_date: newDate });
          App.toast(`Moved ${entryName} to ${self._shortDate(newDate)}`);
        } catch (err) {
          App.toast('Reschedule failed: ' + (err.message || 'Unknown error'), 'error');
          self.renderCalendar();
        }
      }

      dragEntry = null;
      sourceDate = null;
      currentDropTarget = null;
    };

    calBody.addEventListener('pointerup', endDrag);
    calBody.addEventListener('pointercancel', endDrag);
  },

  _showDayModal(dateStr) {
    const entries = (this._calGrouped && this._calGrouped[dateStr]) || [];
    const todayStr = this._today();
    const d = new Date(dateStr + 'T12:00:00');
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    // Remove any existing modal
    const existing = document.querySelector('.day-modal-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'day-modal-backdrop';
    backdrop.innerHTML = `
      <div class="day-modal">
        <div class="day-modal-handle"></div>
        <div class="day-modal-header">
          <div>
            <h3>${dayLabel}</h3>
            <span class="day-modal-count">${entries.length} visit${entries.length !== 1 ? 's' : ''}</span>
          </div>
          <button class="day-modal-close">&times;</button>
        </div>
        <div class="day-modal-body">
          ${entries.length === 0 ? '<div class="day-modal-empty">No visits scheduled</div>' : ''}
          ${entries.map(e => {
            const isOverdue = e.status === 'scheduled' && dateStr < todayStr;
            const statusClass = isOverdue ? 'overdue' : e.status;
            const statusLabel = isOverdue ? 'Overdue' : e.status.charAt(0).toUpperCase() + e.status.slice(1);
            const svcBorder = this._svcBorderColor(e.service_type);
            return `
            <div class="day-modal-entry day-modal-entry-${statusClass}"
                 data-entry-id="${e.id}"
                 data-entry-name="${e.customer_name.replace(/"/g, '&quot;')}"
                 data-source-date="${dateStr}"
                 ${svcBorder ? `style="border-left-color:${svcBorder};"` : ''}>
              <div class="day-modal-entry-info">
                <div class="day-modal-entry-name">${e.customer_name}</div>
                <div class="day-modal-entry-detail">${e.service_type || ''}${e.technician_name ? ' · ' + e.technician_name : ''}</div>
              </div>
              <span class="day-modal-entry-status day-modal-entry-status-${statusClass}">${statusLabel}</span>
            </div>`;
          }).join('')}
          ${entries.length > 0 ? '<div class="day-modal-drag-hint">Long-press to drag to another day</div>' : ''}
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    // Close on backdrop tap or close button
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    backdrop.querySelector('.day-modal-close').addEventListener('click', () => backdrop.remove());

    // Tap entry → navigate to daily view
    backdrop.querySelectorAll('.day-modal-entry').forEach(el => {
      el.addEventListener('click', (e) => {
        if (el.classList.contains('dragging-from-modal')) return;
        backdrop.remove();
        this._selectedDate = dateStr;
        App.navigate('scheduling');
      });
    });

    // Init drag from modal entries
    this._initModalDrag(backdrop, dateStr);
  },

  _initModalDrag(backdrop, modalDate) {
    const LONG_PRESS_MS = 300;
    const DRAG_THRESHOLD_PX = 5;
    const self = this;
    let pressTimer = null;
    let startX = 0, startY = 0;
    let isDragging = false;
    let dragEntry = null;
    let ghostEl = null;
    let currentDropTarget = null;

    const modalBody = backdrop.querySelector('.day-modal-body');
    if (!modalBody) return;

    modalBody.addEventListener('pointerdown', (e) => {
      const entryEl = e.target.closest('.day-modal-entry[data-entry-id]');
      if (!entryEl) return;

      startX = e.clientX;
      startY = e.clientY;
      dragEntry = entryEl;

      pressTimer = setTimeout(() => {
        isDragging = true;
        entryEl.classList.add('dragging-from-modal');

        // Fade the modal so calendar cells are visible
        backdrop.classList.add('drag-active');
        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';

        ghostEl = document.createElement('div');
        ghostEl.className = 'cal-drag-ghost';
        ghostEl.textContent = entryEl.dataset.entryName;
        ghostEl.style.left = e.clientX + 'px';
        ghostEl.style.top = e.clientY + 'px';
        ghostEl.style.zIndex = '1100';
        document.body.appendChild(ghostEl);

        if (navigator.vibrate) navigator.vibrate(50);
      }, LONG_PRESS_MS);
    });

    const onMove = (e) => {
      if (pressTimer && !isDragging) {
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
        return;
      }
      if (!isDragging || !ghostEl) return;
      e.preventDefault();

      ghostEl.style.left = e.clientX + 'px';
      ghostEl.style.top = (e.clientY - 20) + 'px';

      ghostEl.style.pointerEvents = 'none';
      const target = document.elementFromPoint(e.clientX, e.clientY);
      ghostEl.style.pointerEvents = '';

      const cellEl = target ? target.closest('.cal-cell[data-date]') : null;
      if (currentDropTarget && currentDropTarget !== cellEl) {
        currentDropTarget.classList.remove('cal-cell-drop-target');
      }
      if (cellEl) {
        cellEl.classList.add('cal-cell-drop-target');
        currentDropTarget = cellEl;
      } else {
        currentDropTarget = null;
      }
    };

    const endDrag = async (e) => {
      clearTimeout(pressTimer);
      pressTimer = null;

      if (!isDragging) {
        dragEntry = null;
        return;
      }
      isDragging = false;

      document.body.style.overflow = '';
      document.body.style.touchAction = '';

      if (ghostEl) { ghostEl.remove(); ghostEl = null; }
      if (dragEntry) dragEntry.classList.remove('dragging-from-modal');
      backdrop.classList.remove('drag-active');
      document.querySelectorAll('.cal-cell-drop-target').forEach(el =>
        el.classList.remove('cal-cell-drop-target')
      );

      if (currentDropTarget && dragEntry) {
        const entryId = dragEntry.dataset.entryId;
        const newDate = currentDropTarget.dataset.date;
        const entryName = dragEntry.dataset.entryName;
        const sourceDate = dragEntry.dataset.sourceDate;

        // Close the modal
        backdrop.remove();

        // Optimistic UI: move entry in calendar grid
        const sourceDateEntry = document.querySelector(`.cal-cell[data-date="${sourceDate}"] .cal-entry[data-entry-id="${entryId}"]`);
        if (sourceDateEntry) {
          sourceDateEntry.dataset.sourceDate = newDate;
          let targetEntries = currentDropTarget.querySelector('.cal-entries');
          if (!targetEntries) {
            targetEntries = document.createElement('div');
            targetEntries.className = 'cal-entries';
            currentDropTarget.appendChild(targetEntries);
          }
          targetEntries.appendChild(sourceDateEntry);
        }

        // Update count badges
        self._updateCellBadge(document.querySelector(`.cal-cell[data-date="${sourceDate}"]`));
        self._updateCellBadge(currentDropTarget);

        // Update grouped data
        if (self._calGrouped && self._calGrouped[sourceDate]) {
          const idx = self._calGrouped[sourceDate].findIndex(x => String(x.id) === String(entryId));
          if (idx >= 0) {
            const [moved] = self._calGrouped[sourceDate].splice(idx, 1);
            if (!self._calGrouped[newDate]) self._calGrouped[newDate] = [];
            self._calGrouped[newDate].push(moved);
          }
        }

        try {
          await Api.put(`/api/schedules/${entryId}/reschedule`, { new_date: newDate });
          App.toast(`Moved ${entryName} to ${self._shortDate(newDate)}`);
        } catch (err) {
          App.toast('Reschedule failed: ' + (err.message || 'Unknown error'), 'error');
          self.renderCalendar();
        }
      }

      dragEntry = null;
      currentDropTarget = null;
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);

    // Cleanup listeners when backdrop is removed
    const observer = new MutationObserver(() => {
      if (!document.body.contains(backdrop)) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', endDrag);
        document.removeEventListener('pointercancel', endDrag);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  },

  _updateCellBadge(cellEl) {
    if (!cellEl) return;
    const count = cellEl.querySelectorAll('.cal-entry[data-entry-id]').length;
    let badge = cellEl.querySelector('.cal-count-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'cal-count-badge';
        cellEl.appendChild(badge);
      }
      badge.textContent = count;
    } else if (badge) {
      badge.remove();
    }
  }
};
