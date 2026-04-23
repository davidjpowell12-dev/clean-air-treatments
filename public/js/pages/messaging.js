// Messaging page: review + edit + send SMS drafts (heads-ups and completions)
const MessagingPage = {
  currentTab: 'heads_up',
  twilioStatus: null,

  async render() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const isSentView = this.currentTab === 'sent';
      const draftsUrl = isSentView
        ? '/api/messaging/drafts?status=sent'
        : '/api/messaging/drafts?type=' + this.currentTab + '&status=draft';
      const [drafts, counts, status] = await Promise.all([
        Api.get(draftsUrl),
        Api.get('/api/messaging/drafts/counts').catch(() => ({})),
        Api.get('/api/messaging/status').catch(() => ({ twilio_configured: false, mode: 'dry-run' }))
      ]);
      this.twilioStatus = status;

      const tomorrowDate = this.tomorrowDate();
      const prettyTomorrow = new Date(tomorrowDate + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric'
      });

      main.innerHTML = `
        <div class="page-header">
          <h2>Messaging</h2>
        </div>

        ${!status.twilio_configured ? `
          <div class="card" style="border-left:4px solid var(--orange);margin-bottom:12px;">
            <div class="card-body" style="padding:10px 14px;font-size:13px;">
              <strong style="color:var(--orange);">DRY-RUN MODE</strong> — Twilio isn't configured yet.
              Drafts can be created, edited, and "sent" to test the flow, but nothing will actually leave the building.
              Add <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, and <code>TWILIO_PHONE_NUMBER</code> to Railway once A2P is approved.
            </div>
          </div>
        ` : `
          <div class="card" style="border-left:4px solid var(--green);margin-bottom:12px;">
            <div class="card-body" style="padding:10px 14px;font-size:13px;">
              <strong style="color:var(--green-dark,#2d6a1e);">LIVE</strong> — Twilio is configured. Messages will be sent for real.
            </div>
          </div>
        `}

        <div class="fu-tabs">
          <button class="fu-tab ${this.currentTab === 'heads_up' ? 'active' : ''}" data-tab="heads_up">
            🔔 Heads-ups <span class="fu-tab-count">${counts.heads_up_ready || 0}</span>
          </button>
          <button class="fu-tab ${this.currentTab === 'completion' ? 'active' : ''}" data-tab="completion">
            ✅ Completions <span class="fu-tab-count">${counts.completion_ready || 0}</span>
          </button>
          <button class="fu-tab ${this.currentTab === 'receipt' ? 'active' : ''}" data-tab="receipt">
            🧾 Receipts <span class="fu-tab-count">${counts.receipt_ready || 0}</span>
          </button>
          <button class="fu-tab ${this.currentTab === 'sent' ? 'active' : ''}" data-tab="sent">
            📨 Sent
          </button>
        </div>

        ${this.currentTab === 'heads_up' ? `
          <div class="card">
            <div class="card-header">
              <h3 style="font-size:15px;">Compose for ${prettyTomorrow}</h3>
              <button class="btn btn-primary btn-sm" onclick="MessagingPage.composeHeadsUps('${tomorrowDate}')">+ Generate drafts</button>
            </div>
            <div class="card-body" style="font-size:13px;color:var(--gray-600);padding:10px 16px;">
              Pulls tomorrow's scheduled visits and pre-composes a heads-up text for each opted-in customer with a phone number.
              Already-composed drafts won't be duplicated. You can also pick a different date:
              <input type="date" id="msgComposeDate" value="${tomorrowDate}" style="margin-left:8px;padding:6px 10px;border:1px solid var(--gray-300);border-radius:6px;">
              <button class="btn btn-outline btn-sm" onclick="MessagingPage.composeHeadsUps(document.getElementById('msgComposeDate').value)">Generate</button>
            </div>
          </div>
        ` : ''}

        ${drafts.length === 0 ? `
          <div class="empty-state">
            <h3>No ${this.currentTab === 'heads_up' ? 'heads-up' : this.currentTab === 'completion' ? 'completion' : 'sent'} drafts</h3>
            <p>${this.currentTab === 'heads_up' ? 'Click "Generate drafts" above to create tomorrow\'s heads-up messages.' : this.currentTab === 'completion' ? 'Completion drafts are queued automatically when a tech logs an application.' : 'Sent messages will appear here.'}</p>
          </div>
        ` : `
          ${this.currentTab !== 'sent' && drafts.length > 1 ? `
            <div class="card" style="margin-bottom:12px;padding:12px 16px;background:var(--gray-50);display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:14px;font-weight:600;">${drafts.length} drafts ready</span>
              <button class="btn btn-primary btn-sm" onclick="MessagingPage.sendAll('${this.currentTab}')">Send All ${drafts.length}</button>
            </div>
          ` : ''}
          <div>
            ${drafts.map(d => this.renderDraft(d)).join('')}
          </div>
        `}
      `;

      document.querySelectorAll('.fu-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          this.currentTab = tab.dataset.tab;
          this.render();
        });
      });

      // When they change a text, save on blur
      document.querySelectorAll('.msg-draft-text').forEach(ta => {
        ta.addEventListener('blur', () => this.autoSaveDraft(ta));
      });
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  renderDraft(d) {
    const text = d.edited_text != null ? d.edited_text : d.composed_text;
    const segments = Math.ceil(text.length / 160);
    const isSent = d.status === 'sent';
    const isFailed = d.status === 'failed';
    const dateLabel = d.service_date
      ? new Date(d.service_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';

    let statusBadge = '';
    if (isSent) {
      const sendResult = d.send_result ? JSON.parse(d.send_result) : {};
      statusBadge = sendResult.dry_run
        ? `<span class="badge badge-gray" style="font-size:10px;">sent (dry-run)</span>`
        : `<span class="badge badge-green" style="font-size:10px;">sent</span>`;
    } else if (isFailed) {
      statusBadge = `<span class="badge badge-red" style="font-size:10px;">failed</span>`;
    }

    return `
      <div class="card" style="margin-bottom:10px;" data-draft-id="${d.id}">
        <div class="card-header" style="padding:10px 14px;">
          <div style="flex:1;">
            <h4 style="font-size:15px;margin:0;">${this.esc(d.customer_name || 'Unknown')}</h4>
            <p style="font-size:12px;color:var(--gray-500);margin:2px 0 0;">
              ${this.esc(d.address || '')} · ${this.esc(d.service_summary || '')}
              ${dateLabel ? ' · ' + dateLabel : ''}
            </p>
          </div>
          ${statusBadge}
        </div>
        <div class="card-body" style="padding:10px 14px;">
          <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
            <label style="font-size:12px;color:var(--gray-600);margin:0;">To:</label>
            <input type="tel" class="msg-draft-phone" data-draft-id="${d.id}" value="${this.esc(d.to_phone || '')}" ${isSent ? 'readonly' : ''} style="flex:1;padding:6px 10px;border:1px solid var(--gray-300);border-radius:6px;font-size:13px;">
          </div>
          <textarea class="msg-draft-text" data-draft-id="${d.id}" rows="8" ${isSent ? 'readonly' : ''} style="width:100%;padding:10px;border:1px solid var(--gray-300);border-radius:6px;font-family:inherit;font-size:14px;resize:vertical;">${this.esc(text)}</textarea>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:11px;color:var(--gray-500);">
            <span>${text.length} chars · ${segments} SMS segment${segments > 1 ? 's' : ''}</span>
            ${!isSent ? `
              <div style="display:flex;gap:6px;">
                <button class="btn btn-outline btn-sm" onclick="MessagingPage.discardDraft(${d.id})">Skip</button>
                <button class="btn btn-primary btn-sm" onclick="MessagingPage.sendOne(${d.id})">Send</button>
              </div>
            ` : ''}
          </div>
          ${isFailed && d.send_result ? `
            <p style="color:var(--red);font-size:12px;margin-top:6px;">Error: ${this.esc(JSON.parse(d.send_result).error || 'unknown')}</p>
          ` : ''}
        </div>
      </div>
    `;
  },

  async composeHeadsUps(date) {
    try {
      const result = await Api.post('/api/messaging/compose/heads-ups', { date });
      const msg = `Created ${result.created} draft${result.created === 1 ? '' : 's'}` +
        (result.skipped_existing ? ` · ${result.skipped_existing} already existed` : '') +
        (result.skipped_no_phone ? ` · ${result.skipped_no_phone} skipped (no phone)` : '') +
        (result.skipped_opted_out ? ` · ${result.skipped_opted_out} opted out` : '');
      App.toast(msg, 'success');
      this.render();
    } catch (err) {
      App.toast('Compose failed: ' + err.message, 'error');
    }
  },

  async autoSaveDraft(textarea) {
    const id = textarea.dataset.draftId;
    const edited_text = textarea.value;
    const phoneInput = document.querySelector(`.msg-draft-phone[data-draft-id="${id}"]`);
    const to_phone = phoneInput ? phoneInput.value : undefined;
    try {
      await Api.put('/api/messaging/drafts/' + id, { edited_text, to_phone });
    } catch (e) { /* silent autosave */ }
  },

  async sendOne(id) {
    const textarea = document.querySelector(`.msg-draft-text[data-draft-id="${id}"]`);
    const phone = document.querySelector(`.msg-draft-phone[data-draft-id="${id}"]`);
    if (textarea) {
      await this.autoSaveDraft(textarea);
    }
    try {
      const r = await Api.post(`/api/messaging/drafts/${id}/send`, {});
      if (r.success) {
        App.toast(r.dry_run ? 'Dry-run sent (no actual SMS)' : 'Sent ✓', 'success');
        this.render();
      } else {
        App.toast('Send failed: ' + (r.error || 'unknown'), 'error');
      }
    } catch (err) {
      App.toast('Send failed: ' + err.message, 'error');
    }
  },

  async sendAll(type) {
    const drafts = document.querySelectorAll('.msg-draft-text');
    // Save any pending edits first
    await Promise.all(Array.from(drafts).map(ta => this.autoSaveDraft(ta)));

    const confirmed = confirm(`Send ${drafts.length} message${drafts.length === 1 ? '' : 's'} now?`);
    if (!confirmed) return;

    try {
      const r = await Api.post('/api/messaging/drafts/send-all', { type });
      const msg = `${r.sent} sent${r.failed ? ', ' + r.failed + ' failed' : ''}${r.dry_run ? ' (dry-run)' : ''}`;
      App.toast(msg, r.failed ? 'error' : 'success');
      this.render();
    } catch (err) {
      App.toast('Batch send failed: ' + err.message, 'error');
    }
  },

  async discardDraft(id) {
    if (!confirm('Skip this draft? It won\'t be sent.')) return;
    try {
      await Api.delete('/api/messaging/drafts/' + id);
      App.toast('Skipped', 'success');
      this.render();
    } catch (err) {
      App.toast('Failed: ' + err.message, 'error');
    }
  },

  tomorrowDate() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  },

  esc(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }
};
