// Scheduling Page — assign properties to dates, view daily schedule
const SchedulingPage = {
  _techs: [],
  _selectedDate: null,

  async render(action, id) {
    if (action === 'add') return this.renderAddProperties();
    return this.renderDaily();
  },

  _formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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

  async _loadTechs() {
    if (this._techs.length === 0) {
      try { this._techs = await Api.get('/api/schedules/meta/technicians'); } catch (e) { this._techs = []; }
    }
    return this._techs;
  },

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

    // Week bar
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

      <!-- Week overview -->
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

      <!-- Date nav -->
      <div class="schedule-date-nav">
        <button id="prevDay" class="btn btn-sm btn-outline">&larr;</button>
        <input type="date" id="schedDate" value="${date}" class="schedule-date-input">
        <button id="nextDay" class="btn btn-sm btn-outline">&rarr;</button>
      </div>

      <!-- Stats -->
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

      <!-- Actions -->
      <div style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
        <button id="addPropsBtn" class="btn btn-primary btn-sm">+ Add Properties</button>
        <div style="display: flex; align-items: center; gap: 6px;">
          <select id="bulkTech" class="form-select-sm">
            <option value="">Assign tech...</option>
            ${techOptions}
          </select>
          <button id="assignAllBtn" class="btn btn-outline btn-sm">Assign All</button>
        </div>
      </div>

      <!-- Schedule list -->
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
    `;

    // Event listeners
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

    document.getElementById('addPropsBtn').addEventListener('click', () => {
      App.navigate('scheduling', 'add');
    });
    const addEmpty = document.getElementById('addPropsEmpty');
    if (addEmpty) addEmpty.addEventListener('click', () => App.navigate('scheduling', 'add'));

    document.getElementById('assignAllBtn').addEventListener('click', async () => {
      const techId = document.getElementById('bulkTech').value;
      if (!techId) return App.toast('Select a technician first', 'error');
      await Api.put(`/api/schedules/assign-all/${date}`, { assigned_to: Number(techId) });
      App.toast('Technician assigned to all entries');
      this.renderDaily();
    });

    // Week day clicks
    document.querySelectorAll('.week-day').forEach(el => {
      el.addEventListener('click', () => {
        this._selectedDate = el.dataset.date;
        this.renderDaily();
      });
    });

    // Entry actions
    this._bindEntryActions(entries, date, techs);
  },

  _renderEntry(e, idx, techs) {
    const statusClass = e.status === 'completed' ? 'badge-green' : e.status === 'skipped' ? 'badge-gray' : 'badge-blue';
    const statusLabel = e.status.charAt(0).toUpperCase() + e.status.slice(1);
    const techOptions = techs.map(t =>
      `<option value="${t.id}" ${e.assigned_to === t.id ? 'selected' : ''}>${t.full_name}</option>`
    ).join('');

    return `
      <div class="schedule-entry ${e.status === 'completed' ? 'schedule-entry-done' : ''}" data-id="${e.id}">
        <div class="schedule-entry-main">
          <div class="schedule-entry-order">${idx + 1}</div>
          <div class="schedule-entry-info">
            <div class="schedule-entry-name">${e.customer_name}</div>
            <div class="schedule-entry-addr">${e.address}${e.city ? ', ' + e.city : ''}</div>
            ${e.sqft ? `<div class="schedule-entry-meta">${Number(e.sqft).toLocaleString()} sq ft</div>` : ''}
            ${e.phone ? `<div class="schedule-entry-meta"><a href="tel:${e.phone}">${e.phone}</a></div>` : ''}
            ${e.notes ? `<div class="schedule-entry-notes">${e.notes}</div>` : ''}
          </div>
        </div>
        <div class="schedule-entry-actions">
          <span class="badge ${statusClass}">${statusLabel}</span>
          <select class="tech-select form-select-sm" data-id="${e.id}">
            <option value="">No tech</option>
            ${techOptions}
          </select>
          <div class="schedule-entry-btns">
            ${e.status !== 'completed' ? `<button class="btn btn-sm btn-primary sched-complete" data-id="${e.id}" title="Complete">&#10003;</button>` : ''}
            ${e.status !== 'skipped' ? `<button class="btn btn-sm btn-outline sched-skip" data-id="${e.id}" title="Skip">Skip</button>` : ''}
            ${e.status !== 'scheduled' ? `<button class="btn btn-sm btn-outline sched-reset" data-id="${e.id}" title="Reset">Reset</button>` : ''}
            <button class="btn btn-sm btn-outline sched-remove" data-id="${e.id}" title="Remove">&times;</button>
          </div>
        </div>
      </div>
    `;
  },

  _bindEntryActions(entries, date, techs) {
    // Complete
    document.querySelectorAll('.sched-complete').forEach(btn => {
      btn.addEventListener('click', async () => {
        await Api.put(`/api/schedules/${btn.dataset.id}`, { status: 'completed' });
        this.renderDaily();
      });
    });

    // Skip
    document.querySelectorAll('.sched-skip').forEach(btn => {
      btn.addEventListener('click', async () => {
        await Api.put(`/api/schedules/${btn.dataset.id}`, { status: 'skipped' });
        this.renderDaily();
      });
    });

    // Reset
    document.querySelectorAll('.sched-reset').forEach(btn => {
      btn.addEventListener('click', async () => {
        await Api.put(`/api/schedules/${btn.dataset.id}`, { status: 'scheduled' });
        this.renderDaily();
      });
    });

    // Remove
    document.querySelectorAll('.sched-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this property from the schedule?')) return;
        await Api.delete(`/api/schedules/${btn.dataset.id}`);
        App.toast('Removed from schedule');
        this.renderDaily();
      });
    });

    // Tech select
    document.querySelectorAll('.tech-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        await Api.put(`/api/schedules/${sel.dataset.id}`, {
          assigned_to: sel.value ? Number(sel.value) : null
        });
      });
    });

    // Click entry name to view property
    document.querySelectorAll('.schedule-entry-name').forEach(el => {
      const entry = entries.find(e => e.id === Number(el.closest('.schedule-entry').dataset.id));
      if (entry) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => App.navigate('properties', 'view', entry.property_id));
      }
    });
  },

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
      try {
        allProperties = await Api.get(url);
      } catch (err) {
        allProperties = [];
      }
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

      // Checkbox change
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

    // Search with debounce
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
        App.toast('Error adding properties: ' + (err.message || 'Unknown error'), 'error');
      }
    });

    // Initial load
    loadProperties();
  }
};
