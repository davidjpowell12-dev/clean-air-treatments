// Follow-ups: client request capture system
// Buckets: today, this_week, someday
// Waiting on: me (action required), customer (waiting for response)
const FollowUpsPage = {
  currentFilter: 'all', // all | waiting_me | waiting_customer | done

  async render(action, id) {
    if (action === 'view' && id) return this.renderDetail(id);
    return this.renderList();
  },

  async renderList() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const status = this.currentFilter === 'done' ? 'done' : 'open';
      const qs = new URLSearchParams({ status });
      if (this.currentFilter === 'waiting_me') qs.set('waiting_on', 'me');
      if (this.currentFilter === 'waiting_customer') qs.set('waiting_on', 'customer');

      const items = await Api.get('/api/follow-ups?' + qs.toString());
      const counts = await Api.get('/api/follow-ups/counts').catch(() => ({}));

      // Group by bucket
      const byBucket = { today: [], this_week: [], someday: [] };
      items.forEach(it => {
        const b = it.bucket || 'today';
        (byBucket[b] = byBucket[b] || []).push(it);
      });

      // Sort pinned first, then by created_at desc
      ['today', 'this_week', 'someday'].forEach(b => {
        byBucket[b].sort((a, c) => {
          if (a.pinned !== c.pinned) return c.pinned - a.pinned;
          return (c.created_at || '').localeCompare(a.created_at || '');
        });
      });

      const todayCount = byBucket.today.length;
      const todayWarning = todayCount > 7
        ? `<p style="font-size:12px;color:var(--orange);margin-top:4px;">Today list is getting long — consider moving some to This Week.</p>`
        : '';

      main.innerHTML = `
        <div class="page-header">
          <h2>Follow-ups</h2>
          <button class="btn btn-primary btn-sm" onclick="FollowUpsPage.openCreate()">+ New</button>
        </div>

        <div class="fu-tabs">
          <button class="fu-tab ${this.currentFilter === 'all' ? 'active' : ''}" data-filter="all">
            All <span class="fu-tab-count">${counts.total || 0}</span>
          </button>
          <button class="fu-tab ${this.currentFilter === 'waiting_me' ? 'active' : ''}" data-filter="waiting_me">
            On me <span class="fu-tab-count">${counts.waiting_me || 0}</span>
          </button>
          <button class="fu-tab ${this.currentFilter === 'waiting_customer' ? 'active' : ''}" data-filter="waiting_customer">
            Waiting <span class="fu-tab-count">${counts.waiting_customer || 0}</span>
          </button>
          <button class="fu-tab ${this.currentFilter === 'done' ? 'active' : ''}" data-filter="done">
            Done
          </button>
        </div>

        ${items.length === 0 ? `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            <h3>Nothing here ${this.currentFilter === 'done' ? 'yet' : '— great job!'}</h3>
            <p>${this.currentFilter === 'done' ? 'Completed follow-ups will show up here.' : 'Tap + New to capture a client request.'}</p>
            ${this.currentFilter !== 'done' ? `<button class="btn btn-primary" onclick="FollowUpsPage.openCreate()">+ New Follow-up</button>` : ''}
          </div>
        ` : this.currentFilter === 'done' ? `
          <div class="card">
            ${items.map(it => this.renderRow(it, true)).join('')}
          </div>
        ` : `
          ${this.renderBucketSection('Today', 'today', byBucket.today, todayWarning)}
          ${this.renderBucketSection('This Week', 'this_week', byBucket.this_week)}
          ${this.renderBucketSection('Someday', 'someday', byBucket.someday)}
        `}
      `;

      // Wire up tab clicks
      document.querySelectorAll('.fu-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          this.currentFilter = tab.dataset.filter;
          this.renderList();
        });
      });
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  renderBucketSection(label, bucket, items, extraHtml) {
    const icon = bucket === 'today' ? '🔥' : bucket === 'this_week' ? '📆' : '💭';
    return `
      <div class="card fu-bucket" data-bucket="${bucket}">
        <div class="card-header">
          <h3>${icon} ${label} <span style="color:var(--gray-500);font-weight:500;font-size:14px;">(${items.length})</span></h3>
        </div>
        <div class="card-body" style="padding:0;">
          ${items.length === 0
            ? `<p style="padding:16px;color:var(--gray-500);font-size:14px;text-align:center;">Nothing in ${label.toLowerCase()}.</p>`
            : items.map(it => this.renderRow(it, false)).join('')}
          ${extraHtml || ''}
        </div>
      </div>
    `;
  },

  renderRow(it, isDone) {
    const ageDays = this.daysSince(it.created_at);
    const ageColor = ageDays >= 7 ? 'var(--red)' : ageDays >= 3 ? 'var(--orange)' : 'var(--gray-500)';
    const ageLabel = ageDays === 0 ? 'today' : ageDays === 1 ? '1d ago' : `${ageDays}d ago`;
    const waitingBadge = it.waiting_on === 'customer'
      ? `<span class="badge badge-blue" style="font-size:10px;">Waiting</span>`
      : `<span class="badge badge-orange" style="font-size:10px;">On me</span>`;
    const customerLine = it.customer_name
      ? `<p style="font-size:12px;color:var(--blue);font-weight:600;margin-top:2px;">${this.esc(it.customer_name)}</p>`
      : '';
    const pinIcon = it.pinned ? '📌 ' : '';

    return `
      <div class="data-row fu-row ${isDone ? 'fu-row-done' : ''}" data-id="${it.id}">
        <div class="data-row-main" onclick="FollowUpsPage.openEdit(${it.id})">
          <h4 style="${isDone ? 'text-decoration:line-through;color:var(--gray-500);' : ''}">${pinIcon}${this.esc(it.title)}</h4>
          ${customerLine}
          ${it.notes ? `<p style="font-size:13px;color:var(--gray-700);margin-top:4px;">${this.esc(this.truncate(it.notes, 120))}</p>` : ''}
          <div style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap;">
            ${isDone ? '' : waitingBadge}
            <span style="font-size:11px;color:${ageColor};">${ageLabel}</span>
          </div>
        </div>
        <div class="data-row-right" style="display:flex;gap:6px;align-items:center;">
          ${isDone
            ? `<button class="btn-icon" style="background:var(--gray-100);color:var(--gray-700);" onclick="event.stopPropagation();FollowUpsPage.reopen(${it.id})" title="Reopen">↻</button>`
            : `<button class="btn-icon fu-done-btn" onclick="event.stopPropagation();FollowUpsPage.complete(${it.id})" title="Mark done">✓</button>`}
        </div>
      </div>
    `;
  },

  openCreate(prefillPropertyId) {
    this.openModal({
      id: null,
      title: '',
      notes: '',
      bucket: 'today',
      waiting_on: 'me',
      pinned: 0,
      property_id: prefillPropertyId || null,
      customer_name: ''
    });
  },

  async openEdit(id) {
    try {
      const it = await Api.get(`/api/follow-ups/${id}`);
      this.openModal(it);
    } catch (err) {
      App.toast('Could not load follow-up: ' + err.message, 'error');
    }
  },

  openModal(fu) {
    const isEdit = !!fu.id;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'fuModal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${isEdit ? 'Edit Follow-up' : 'New Follow-up'}</h3>
          <button class="modal-close" onclick="FollowUpsPage.closeModal()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>What needs to happen?</label>
            <div style="display:flex;gap:6px;align-items:stretch;">
              <input type="text" id="fuTitle" placeholder="e.g. Check back yard drainage for the Smiths" value="${this.esc(fu.title || '')}" autofocus>
              <button type="button" id="fuVoiceBtn" class="btn btn-outline btn-sm" style="min-width:44px;" title="Voice input">🎤</button>
            </div>
          </div>

          <div class="form-group">
            <label>Customer (optional)</label>
            <input type="text" id="fuPropertySearch" placeholder="Search customer..." value="${this.esc(fu.customer_name || '')}" autocomplete="off">
            <input type="hidden" id="fuPropertyId" value="${fu.property_id || ''}">
            <div id="fuPropertyResults" class="fu-autocomplete"></div>
          </div>

          <div class="form-group">
            <label>Bucket</label>
            <div class="fu-segments">
              <button type="button" class="fu-seg ${fu.bucket === 'today' ? 'active' : ''}" data-bucket="today">🔥 Today</button>
              <button type="button" class="fu-seg ${fu.bucket === 'this_week' ? 'active' : ''}" data-bucket="this_week">📆 Week</button>
              <button type="button" class="fu-seg ${fu.bucket === 'someday' ? 'active' : ''}" data-bucket="someday">💭 Someday</button>
            </div>
            <input type="hidden" id="fuBucket" value="${fu.bucket || 'today'}">
          </div>

          <div class="form-group">
            <label>Waiting on</label>
            <div class="fu-segments">
              <button type="button" class="fu-seg-w ${fu.waiting_on === 'me' ? 'active' : ''}" data-waiting="me">Me (my action)</button>
              <button type="button" class="fu-seg-w ${fu.waiting_on === 'customer' ? 'active' : ''}" data-waiting="customer">Customer (reply)</button>
            </div>
            <input type="hidden" id="fuWaitingOn" value="${fu.waiting_on || 'me'}">
          </div>

          <div class="form-group">
            <label>Notes (optional)</label>
            <textarea id="fuNotes" rows="3" placeholder="Any details, context, or next step...">${this.esc(fu.notes || '')}</textarea>
          </div>

          <div class="form-group" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="fuPinned" ${fu.pinned ? 'checked' : ''} style="width:20px;height:20px;">
            <label for="fuPinned" style="margin:0;cursor:pointer;">📌 Pin to top (VIPs, urgent)</label>
          </div>
        </div>
        <div class="modal-footer">
          ${isEdit ? `<button class="btn btn-danger btn-sm" onclick="FollowUpsPage.remove(${fu.id})">Delete</button>` : ''}
          <button class="btn btn-outline" onclick="FollowUpsPage.closeModal()" style="margin-left:auto;">Cancel</button>
          <button class="btn btn-primary" onclick="FollowUpsPage.save(${fu.id || 'null'})">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    // Segmented controls
    overlay.querySelectorAll('.fu-seg').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.fu-seg').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('fuBucket').value = btn.dataset.bucket;
      });
    });
    overlay.querySelectorAll('.fu-seg-w').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.fu-seg-w').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('fuWaitingOn').value = btn.dataset.waiting;
      });
    });

    // Voice input
    const voiceBtn = document.getElementById('fuVoiceBtn');
    if (voiceBtn) {
      voiceBtn.addEventListener('click', () => this.startVoiceInput());
    }

    // Customer autocomplete
    const searchInput = document.getElementById('fuPropertySearch');
    const resultsDiv = document.getElementById('fuPropertyResults');
    const propIdInput = document.getElementById('fuPropertyId');
    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      propIdInput.value = ''; // clear selection when user types
      if (!q) { resultsDiv.innerHTML = ''; return; }
      searchTimer = setTimeout(async () => {
        try {
          const props = await Api.get('/api/properties?search=' + encodeURIComponent(q) + '&limit=8');
          resultsDiv.innerHTML = props.map(p => `
            <div class="fu-ac-item" data-id="${p.id}" data-name="${this.esc(p.customer_name)}">
              <strong>${this.esc(p.customer_name)}</strong>
              <span style="color:var(--gray-500);font-size:12px;">${this.esc(p.address || '')}</span>
            </div>
          `).join('');
          resultsDiv.querySelectorAll('.fu-ac-item').forEach(item => {
            item.addEventListener('click', () => {
              searchInput.value = item.dataset.name;
              propIdInput.value = item.dataset.id;
              resultsDiv.innerHTML = '';
            });
          });
        } catch (e) { /* ignore */ }
      }, 200);
    });
    // Clicking outside closes autocomplete
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
        resultsDiv.innerHTML = '';
      }
    });
  },

  closeModal() {
    const m = document.getElementById('fuModal');
    if (m) {
      m.classList.remove('open');
      setTimeout(() => m.remove(), 300);
    }
  },

  async save(id) {
    const title = document.getElementById('fuTitle').value.trim();
    if (!title) return App.toast('Please enter a title', 'error');

    const body = {
      title,
      notes: document.getElementById('fuNotes').value.trim() || null,
      bucket: document.getElementById('fuBucket').value,
      waiting_on: document.getElementById('fuWaitingOn').value,
      pinned: document.getElementById('fuPinned').checked ? 1 : 0,
      property_id: document.getElementById('fuPropertyId').value || null
    };

    try {
      if (id && id !== 'null') {
        await Api.put('/api/follow-ups/' + id, body);
      } else {
        await Api.post('/api/follow-ups', body);
      }
      this.closeModal();
      App.toast(id && id !== 'null' ? 'Updated' : 'Added', 'success');
      // Refresh whatever page we're on
      if (App.currentPage === 'follow-ups') this.renderList();
      else if (App.currentPage === 'dashboard' && window.DashboardPage) DashboardPage.render();
      else if (App.currentPage === 'properties' && window.PropertiesPage && PropertiesPage.currentDetailId) {
        PropertiesPage.renderDetail(PropertiesPage.currentDetailId);
      }
    } catch (err) {
      App.toast('Save failed: ' + err.message, 'error');
    }
  },

  async complete(id) {
    try {
      await Api.post('/api/follow-ups/' + id + '/complete', {});
      App.toast('Marked done', 'success');
      if (App.currentPage === 'follow-ups') this.renderList();
      else if (App.currentPage === 'dashboard' && window.DashboardPage) DashboardPage.render();
      else if (App.currentPage === 'properties' && window.PropertiesPage && PropertiesPage.currentDetailId) {
        PropertiesPage.renderDetail(PropertiesPage.currentDetailId);
      }
    } catch (err) {
      App.toast('Failed: ' + err.message, 'error');
    }
  },

  async reopen(id) {
    try {
      await Api.post('/api/follow-ups/' + id + '/reopen', {});
      App.toast('Reopened', 'success');
      if (App.currentPage === 'follow-ups') this.renderList();
    } catch (err) {
      App.toast('Failed: ' + err.message, 'error');
    }
  },

  async remove(id) {
    if (!confirm('Delete this follow-up?')) return;
    try {
      await Api.delete('/api/follow-ups/' + id);
      this.closeModal();
      App.toast('Deleted', 'success');
      if (App.currentPage === 'follow-ups') this.renderList();
      else if (App.currentPage === 'dashboard' && window.DashboardPage) DashboardPage.render();
    } catch (err) {
      App.toast('Delete failed: ' + err.message, 'error');
    }
  },

  // Web Speech API voice capture
  startVoiceInput() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      App.toast('Voice input not supported on this device', 'error');
      return;
    }
    const voiceBtn = document.getElementById('fuVoiceBtn');
    const titleInput = document.getElementById('fuTitle');
    const notesInput = document.getElementById('fuNotes');

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';

    voiceBtn.textContent = '🔴';
    voiceBtn.style.background = 'var(--red)';
    voiceBtn.style.color = 'white';

    let finalText = '';
    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      // Put first sentence into title, rest into notes
      const combined = (finalText + interim).trim();
      if (!titleInput.value || titleInput.dataset.fromVoice) {
        titleInput.value = combined.slice(0, 120);
        titleInput.dataset.fromVoice = '1';
        if (combined.length > 120) {
          notesInput.value = combined.slice(120);
          notesInput.dataset.fromVoice = '1';
        }
      }
    };
    rec.onerror = (e) => {
      App.toast('Voice error: ' + (e.error || 'unknown'), 'error');
      stop();
    };
    rec.onend = () => stop();

    const stop = () => {
      voiceBtn.textContent = '🎤';
      voiceBtn.style.background = '';
      voiceBtn.style.color = '';
    };

    rec.start();
  },

  // ─── Floating quick-capture button (global) ─────────────────────
  mountFab() {
    if (document.getElementById('fuFab')) return;
    const fab = document.createElement('button');
    fab.id = 'fuFab';
    fab.className = 'fu-fab';
    fab.innerHTML = '+';
    fab.title = 'Quick capture follow-up';
    fab.addEventListener('click', () => this.openCreate());
    document.body.appendChild(fab);
  },

  // Helpers
  esc(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  },
  truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  },
  daysSince(iso) {
    if (!iso) return 0;
    const then = new Date(iso.replace(' ', 'T') + 'Z');
    const now = new Date();
    return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
  }
};
