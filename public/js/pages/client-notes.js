// Dedicated staff screen for authoring client notes (observations &
// recommendations) shown in the customer portal. Pick a customer, write a
// note, publish when ready. Drafts stay hidden from the client.
const ClientNotesPage = {
  _clientId: null,
  _clientName: '',

  _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); },

  async render() {
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <div class="page-header"><h1>Client Notes</h1>
        <p class="page-sub">Share observations &amp; recommendations with customers in their portal.</p></div>
      <div class="card"><div class="card-body">
        <input id="cnSearch" class="input" type="search" style="width:100%;" placeholder="Search customers by name or email…" autocomplete="off">
        <div id="cnClientList" style="margin-top:12px;"></div>
      </div></div>
      <div id="cnDetail"></div>`;
    const search = document.getElementById('cnSearch');
    let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this._loadClients(search.value), 200); });
    this._loadClients('');
  },

  async _loadClients(search) {
    const box = document.getElementById('cnClientList');
    try {
      const res = await Api.get('/api/client-notes/clients?search=' + encodeURIComponent(search || ''));
      const clients = res.clients || [];
      box.innerHTML = clients.length ? clients.map(c => `
        <div class="cn-client" onclick="ClientNotesPage._selectClient(${c.id}, '${this._esc(c.name || c.email).replace(/'/g, "\\'")}')"
          style="display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid var(--gray-200);border-radius:8px;margin-bottom:8px;cursor:pointer;">
          <div><div style="font-weight:600;">${this._esc(c.name || '—')}</div>
            <div style="font-size:13px;color:var(--gray-500);">${this._esc(c.email || c.phone || '')}</div></div>
          <div style="font-size:12px;color:var(--gray-500);white-space:nowrap;">${c.note_count} note${c.note_count === 1 ? '' : 's'}${c.published_count ? ` · ${c.published_count} live` : ''}</div>
        </div>`).join('') : '<p style="color:var(--gray-500);font-size:14px;padding:8px;">No matching customers.</p>';
    } catch (e) { box.innerHTML = `<p style="color:var(--red);font-size:14px;">Could not load customers: ${this._esc(e.message)}</p>`; }
  },

  async _selectClient(id, name) {
    this._clientId = id; this._clientName = name;
    await this._renderDetail();
    document.getElementById('cnDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  async _renderDetail() {
    const box = document.getElementById('cnDetail');
    const res = await Api.get('/api/client-notes?client_id=' + this._clientId);
    const notes = res.notes || [];
    box.innerHTML = `
      <div class="card"><div class="card-header"><h3>Notes for ${this._esc(this._clientName)}</h3></div>
        <div class="card-body">
          <div style="display:grid;gap:8px;margin-bottom:16px;">
            <input id="cnTitle" class="input" placeholder="Title (optional) — e.g. Spring observations">
            <textarea id="cnBody" class="input" rows="3" placeholder="What we observed…"></textarea>
            <textarea id="cnRec" class="input" rows="2" placeholder="Our recommendation (optional)…"></textarea>
            <label style="font-size:14px;display:flex;align-items:center;gap:8px;">
              <input id="cnPub" type="checkbox"> Publish now (visible to the customer immediately)</label>
            <button class="btn btn-primary" onclick="ClientNotesPage._addNote()">Add note</button>
          </div>
          <div id="cnNotes">${this._notesHtml(notes)}</div>
        </div></div>`;
  },

  _notesHtml(notes) {
    if (!notes.length) return '<p style="color:var(--gray-500);font-size:14px;">No notes yet for this customer.</p>';
    return notes.map(n => `
      <div style="border:1px solid var(--gray-200);border-radius:8px;padding:12px;margin-bottom:10px;${n.published ? '' : 'background:var(--gray-50);'}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
          <strong>${this._esc(n.title || 'Visit note')}</strong>
          <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;${n.published ? 'background:var(--green-light);color:var(--green-dark);' : 'background:var(--gray-200);color:var(--gray-700);'}">${n.published ? 'PUBLISHED' : 'DRAFT'}</span>
        </div>
        <div style="font-size:14px;color:var(--gray-900);margin-top:4px;">${this._esc(n.body)}</div>
        ${n.recommendation ? `<div style="font-size:14px;margin-top:6px;color:var(--green-dark);"><b>Recommendation:</b> ${this._esc(n.recommendation)}</div>` : ''}
        <div style="margin-top:10px;display:flex;gap:8px;">
          <button class="btn btn-outline btn-sm" onclick="ClientNotesPage._togglePublish(${n.id}, ${n.published ? 0 : 1})">${n.published ? 'Unpublish' : 'Publish'}</button>
          <button class="btn btn-outline btn-sm" style="color:var(--red);" onclick="ClientNotesPage._deleteNote(${n.id})">Delete</button>
        </div>
      </div>`).join('');
  },

  async _addNote() {
    const body = document.getElementById('cnBody').value.trim();
    if (!body) { App.toast('Please write an observation first', 'error'); return; }
    try {
      await Api.post('/api/client-notes', {
        client_id: this._clientId,
        title: document.getElementById('cnTitle').value.trim() || null,
        body,
        recommendation: document.getElementById('cnRec').value.trim() || null,
        published: document.getElementById('cnPub').checked,
      });
      App.toast('Note added', 'success');
      await this._renderDetail();
      this._loadClients(document.getElementById('cnSearch').value);
    } catch (e) { App.toast('Could not add note: ' + e.message, 'error'); }
  },

  async _togglePublish(id, pub) {
    try { await Api.put('/api/client-notes/' + id, { published: pub }); await this._renderDetail();
      this._loadClients(document.getElementById('cnSearch').value); }
    catch (e) { App.toast('Could not update: ' + e.message, 'error'); }
  },

  async _deleteNote(id) {
    if (!confirm('Delete this note? This cannot be undone.')) return;
    try { await Api.delete('/api/client-notes/' + id); App.toast('Note deleted', 'success'); await this._renderDetail();
      this._loadClients(document.getElementById('cnSearch').value); }
    catch (e) { App.toast('Could not delete: ' + e.message, 'error'); }
  },
};
window.ClientNotesPage = ClientNotesPage;
