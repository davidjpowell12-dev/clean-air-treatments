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

      const cronPaused = settings.cron_paused === 'true';
      main.innerHTML = `
        <div class="page-header">
          <h2>Settings</h2>
        </div>

        <div class="card" style="margin-bottom:16px;border:2px solid ${cronPaused ? '#dc2626' : '#10b981'};">
          <div class="card-header">
            <h3>${cronPaused ? '⏸ Auto-Charge PAUSED' : '▶️ Auto-Charge Active'}</h3>
          </div>
          <div class="card-body">
            <p style="font-size:13px;color:var(--gray-600);margin:0 0 12px;">
              ${cronPaused
                ? 'The daily 8 AM auto-charge cron is <strong>paused</strong>. No invoices will be charged automatically. Resume only after you have reviewed all pending invoices.'
                : 'The daily 8 AM cron is <strong>active</strong> — pending invoices with a saved card will be charged automatically.'}
            </p>
            <button class="btn btn-full ${cronPaused ? 'btn-primary' : 'btn-outline'}" style="${cronPaused ? '' : 'border-color:#dc2626;color:#dc2626;'}" onclick="SettingsPage.toggleCronPause(${cronPaused ? 'false' : 'true'})">
              ${cronPaused ? '▶️ Resume Auto-Charge' : '⏸ Pause Auto-Charge'}
            </button>
          </div>
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

            <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-200);">
            <p style="font-size:13px;color:var(--gray-700);font-weight:600;margin-bottom:8px;">Invoice payment instructions (for check-paying clients)</p>
            <p style="font-size:12px;color:var(--gray-500);margin-bottom:10px;">Shown on the invoice page so customers know who to make checks out to and where to mail them.</p>

            <div class="form-group">
              <label>Make checks payable to</label>
              <input type="text" id="msgPayableTo" value="${this.esc(settings.msg_payable_to || 'Evolved Lawn and Garden Services LLC')}">
            </div>

            <div class="form-group">
              <label>Mailing address for checks</label>
              <textarea id="msgMailingAddress" rows="3" placeholder="2309 Elmridge Dr. NW&#10;Grand Rapids, MI 49504">${this.esc(settings.msg_mailing_address || '')}</textarea>
            </div>

            <div class="form-group">
              <label>Payment notes (optional)</label>
              <input type="text" id="msgPaymentNotes" value="${this.esc(settings.msg_payment_notes || 'Please include the invoice number on the memo line.')}">
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
                    <div class="form-group" style="margin-bottom:8px;display:flex;align-items:flex-start;gap:8px;">
                      <input type="checkbox" data-field="requires_application" ${s.requires_application ? 'checked' : ''} style="margin-top:3px;">
                      <div>
                        <label style="font-size:12px;font-weight:600;">Requires pesticide application record</label>
                        <p style="font-size:11px;color:var(--gray-500);margin:2px 0 0;">Checked = completing a visit of this service opens the full MDARD-compliant application form (product, EPA#, rates, etc). Unchecked = simple "done" click. Uncheck for non-chemical services like Mowing, Clean-Ups, Aeration.</p>
                      </div>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="SettingsPage.saveServiceTemplate(${s.id})">Save</button>
                  </div>
                `).join('')}
              </div>
            </details>
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <div class="card-header"><h3>📒 QuickBooks Online</h3></div>
          <div class="card-body" id="qboCardBody">
            <p style="font-size:13px;color:var(--gray-500);">Loading…</p>
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
              <strong>Disabled.</strong> This tool applied one service label to every NULL-service entry in the database — no way to opt individual clients out. Now that you have pest-only clients who should never be labeled "Fert &amp; Weed Control," use the per-visit pencil button on the scheduling page instead.
            </p>
            <button class="btn btn-outline btn-full" disabled style="opacity:0.5;cursor:not-allowed;">Bulk Relabel — Disabled</button>

            <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-200);">

            <p style="font-size:14px;color:var(--gray-700);margin-bottom:4px;font-weight:600;">Merge Duplicate Service Names</p>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">
              If two slightly different service names refer to the same service (e.g. "Fert &amp; Weed Control" vs "Fertilization and Weed Control"), use this to merge them. Updates the services list, every schedule entry, and every estimate line item in one transaction. <strong>Click "Scan" first</strong> to see exactly what's in the database before merging.
            </p>
            <button class="btn btn-secondary btn-full" id="scanSvcVariantsBtn" onclick="SettingsPage.scanServiceTypeVariants()">Scan Service Type Variants</button>
            <div id="svcVariantsResults" style="margin-top:12px;"></div>

            <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-200);">

            <p style="font-size:14px;color:var(--gray-700);margin-bottom:4px;font-weight:600;">Multi-Service Programs (reschedule-bug audit)</p>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">
              Identifies clients whose accepted estimate created multiple services (e.g. Fert &amp; Weed + Mowing + Mosquito/Tick) under a single shared <code>program_id</code>. These are the clients potentially affected by the historical reschedule bug where "apply to all future visits in the series" would shift visits across service types. Read-only — shows each program's visits grouped by service so you can audit dates.
            </p>
            <button class="btn btn-secondary btn-full" id="scanMultiSvcBtn" onclick="SettingsPage.scanMultiServicePrograms()">Find Multi-Service Programs</button>
            <div id="multiSvcResults" style="margin-top:12px;"></div>

            <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-200);">

            <p style="font-size:14px;color:var(--gray-700);margin-bottom:4px;font-weight:600;">Missing Schedule Visits Audit</p>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">
              <strong>Most important diagnostic.</strong> For every accepted estimate, compares the expected rounds count (from the estimate's line items) against the actual number of schedule entries. Surfaces clients with missing or extra visits across <em>any</em> service. Read-only.
            </p>
            <button class="btn btn-secondary btn-full" id="scanMissingVisitsBtn" onclick="SettingsPage.scanMissingVisits()">Find Missing/Extra Visits</button>
            <div id="missingVisitsResults" style="margin-top:12px;"></div>

            <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-200);">

            <p style="font-size:14px;color:var(--gray-700);margin-bottom:4px;font-weight:600;">Attach Orphan Stripe Payment Method</p>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">
              When a card was saved on a proposal that had no email, Stripe stored it as an orphan PM with no Customer. Paste the <code>pm_…</code> ID and the estimate ID to create a Customer, attach the card, set it as default, and link it to every accepted estimate on that property.
            </p>
            <div style="display:grid;grid-template-columns:1fr 130px 100px;gap:8px;margin-bottom:12px;">
              <input type="text" id="orphanPmId" class="form-input" placeholder="pm_1TToOa...">
              <input type="number" id="orphanPmEstId" class="form-input" placeholder="Estimate ID">
              <button class="btn btn-secondary" onclick="SettingsPage.attachOrphanPm()">Attach</button>
            </div>
            <div id="orphanPmResults"></div>

            <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-200);">

            <p style="font-size:14px;color:var(--gray-700);margin-bottom:4px;font-weight:600;">Resync Billing to Estimate Items</p>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">
              When services are toggled off an estimate <em>after</em> acceptance, the existing invoices stay at the old amount. Enter the estimate ID — this recalculates the total from the current included items, voids unpaid invoices, and generates fresh ones at the corrected amount. Paid invoices are preserved.
            </p>
            <div style="display:grid;grid-template-columns:130px 100px 1fr;gap:8px;margin-bottom:12px;">
              <input type="number" id="resyncEstId" class="form-input" placeholder="Estimate ID">
              <button class="btn btn-secondary" onclick="SettingsPage.resyncBilling()">Resync</button>
              <span></span>
            </div>
            <div id="resyncBillingResults"></div>

            <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-200);">

            <p style="font-size:14px;color:var(--gray-700);margin-bottom:4px;font-weight:600;">Accepted Estimates Missing Invoices</p>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">
              Lists accepted estimates that have zero invoices in the system. Each can be fixed in place by setting a payment plan + method.
            </p>
            <button class="btn btn-secondary btn-full" id="scanMissingInvoicesBtn" onclick="SettingsPage.scanAcceptedNoInvoices()">Find Accepted Estimates Missing Invoices</button>
            <div id="missingInvoicesResults" style="margin-top:12px;"></div>

            <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-200);">

            <p style="font-size:14px;color:var(--gray-700);margin-bottom:4px;font-weight:600;">Customer Forensics</p>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">
              Look up a single customer by name and see everything: property record, every estimate (any status), every schedule entry, and every audit-log action against them. Use this when a customer's rounds appear to have vanished.
            </p>
            <div style="display:flex;gap:8px;margin-bottom:12px;">
              <input type="text" id="forensicsQ" class="form-input" style="flex:1;" placeholder="Customer name (partial match OK, e.g. 'Dalley')">
              <button class="btn btn-secondary" id="forensicsBtn" onclick="SettingsPage.runCustomerForensics()">Look Up</button>
            </div>
            <div id="forensicsResults"></div>

            <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-200);">

            <p style="font-size:14px;color:var(--gray-700);margin-bottom:4px;font-weight:600;">Series Reschedule History</p>
            <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">
              Shows the last 500 reschedule actions that used "apply to all future visits in the series". Use this to identify when the reshuffle bug actually fired and on which clients.
            </p>
            <button class="btn btn-secondary btn-full" id="scanReshuffleBtn" onclick="SettingsPage.scanReshuffleHistory()">Show Series Reshuffle History</button>
            <div id="reshuffleResults" style="margin-top:12px;"></div>

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
      this.loadQboStatus();
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

  // ─── Auto-charge cron pause/resume ─────────────────────
  // Sets the cron_paused setting to true/false; the daily auto-charge cron
  // checks this flag at the start of every run and bails out if paused.
  async toggleCronPause(pause) {
    const willPause = pause === true || pause === 'true';
    const verb = willPause ? 'PAUSE' : 'RESUME';
    if (!confirm(`${verb} the daily auto-charge cron?\n\n${willPause ? 'No invoices will be auto-charged until you resume.' : 'Pending invoices with saved cards will start charging at 8 AM tomorrow.'}`)) {
      return;
    }
    try {
      await Api.put('/api/settings/cron_paused', { value: willPause ? 'true' : 'false' });
      App.toast(willPause ? 'Auto-charge paused' : 'Auto-charge resumed', 'success');
      this.render();
    } catch (err) {
      App.toast('Save failed: ' + err.message, 'error');
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
      msg_opt_out:           document.getElementById('msgOptOut').value.trim(),
      msg_payable_to:        document.getElementById('msgPayableTo').value.trim(),
      msg_mailing_address:   document.getElementById('msgMailingAddress').value.trim(),
      msg_payment_notes:     document.getElementById('msgPaymentNotes').value.trim()
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
    const reqEl = row.querySelector('[data-field="requires_application"]');
    const body = {
      heads_up_text:   row.querySelector('[data-field="heads_up_text"]').value.trim() || null,
      completion_text: row.querySelector('[data-field="completion_text"]').value.trim() || null,
      client_action:   row.querySelector('[data-field="client_action"]').value.trim() || null,
      requires_application: reqEl ? (reqEl.checked ? 1 : 0) : undefined
    };
    try {
      await Api.put('/api/services/' + serviceId, body);
      App.toast('Service settings saved', 'success');
    } catch (err) {
      App.toast('Save failed: ' + err.message, 'error');
    }
  },

  // ─── QuickBooks Online ──────────────────────────────────────────────
  async loadQboStatus() {
    const box = document.getElementById('qboCardBody');
    if (!box) return;
    try {
      const s = await Api.get('/api/quickbooks/status');
      if (!s.connected) {
        box.innerHTML = `
          <p style="font-size:14px;color:var(--gray-700);margin-bottom:12px;">Not connected. Click below to authorize this app to push invoices and payments to your QuickBooks Online company.</p>
          <a href="/api/quickbooks/connect" class="btn btn-primary btn-full" style="text-decoration:none;text-align:center;">Connect to QuickBooks</a>
        `;
        return;
      }
      const env = s.environment === 'production' ? 'Production' : 'Sandbox';
      const connectedAgo = s.connected_at ? new Date(s.connected_at).toLocaleString() : '—';
      box.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--green);"></span>
          <strong style="font-size:14px;">Connected (${env})</strong>
        </div>
        <p style="font-size:12px;color:var(--gray-500);margin-bottom:4px;">Realm ID: <code>${this.esc(s.realm_id)}</code></p>
        <p style="font-size:12px;color:var(--gray-500);margin-bottom:12px;">Connected: ${connectedAgo}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <button class="btn btn-secondary btn-sm" onclick="SettingsPage.testQbo()">Test Connection</button>
          <button class="btn btn-outline btn-sm" onclick="SettingsPage.disconnectQbo()">Disconnect</button>
        </div>
        <div id="qboTestResult" style="margin-bottom:12px;"></div>

        <div style="border-top:1px solid var(--gray-200);padding-top:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
            <strong style="font-size:13px;">Invoice Sync</strong>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-secondary btn-sm" onclick="SettingsPage.loadQboSyncStatus()">Refresh</button>
              <button class="btn btn-primary btn-sm" onclick="SettingsPage.syncPendingQboInvoices()">Sync Pending →</button>
              <button class="btn btn-outline btn-sm" onclick="SettingsPage.reconcileQbo()">Reconcile</button>
            </div>
          </div>
          <div id="qboSyncResult" style="font-size:12px;color:var(--gray-600);margin-bottom:8px;"></div>
          <div id="qboSyncTable" style="font-size:12px;max-height:320px;overflow-y:auto;"></div>
        </div>
      `;
      this.loadQboSyncStatus();
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red);font-size:13px;">Could not load status: ${this.esc(err.message)}</p>`;
    }
  },

  async testQbo() {
    const box = document.getElementById('qboTestResult');
    if (box) box.innerHTML = '<p style="font-size:12px;color:var(--gray-500);">Testing…</p>';
    try {
      const r = await Api.get('/api/quickbooks/company-info');
      box.innerHTML = `
        <div style="background:#dcfce7;border:1px solid #86efac;padding:8px 10px;border-radius:6px;font-size:13px;">
          ✓ Connected. Company: <strong>${this.esc(r.company_name || '?')}</strong>
        </div>
      `;
    } catch (err) {
      box.innerHTML = `<div style="background:#fee2e2;border:1px solid #fca5a5;padding:8px 10px;border-radius:6px;font-size:13px;color:var(--red);">✗ ${this.esc(err.message)}</div>`;
    }
  },

  async disconnectQbo() {
    if (!confirm('Disconnect QuickBooks? This stops invoice/payment syncing. You can reconnect anytime.')) return;
    try {
      await Api.post('/api/quickbooks/disconnect');
      App.toast('QuickBooks disconnected', 'success');
      this.loadQboStatus();
    } catch (err) {
      App.toast('Disconnect failed: ' + err.message, 'error');
    }
  },

  async loadQboSyncStatus() {
    const table = document.getElementById('qboSyncTable');
    if (!table) return;
    table.innerHTML = '<p style="color:var(--gray-500);">Loading…</p>';
    try {
      const r = await Api.get('/api/quickbooks/sync-status');
      const invoices = r.invoices || [];
      const synced = invoices.filter(i => i.qbo_invoice_id).length;
      const errored = invoices.filter(i => i.qbo_sync_error).length;
      const unsynced = invoices.length - synced;

      const summary = document.getElementById('qboSyncResult');
      if (summary) {
        summary.innerHTML = `<strong>${invoices.length}</strong> invoices in scope (pending/paid) — <span style="color:var(--green);">${synced} synced</span>, <span style="color:var(--gray-700);">${unsynced} unsynced</span>${errored ? `, <span style="color:var(--red);">${errored} with errors</span>` : ''}`;
      }

      if (invoices.length === 0) {
        table.innerHTML = '<p style="color:var(--gray-500);">No invoices to sync yet.</p>';
        return;
      }

      const rows = invoices.map(i => {
        const dollars = (i.amount_cents / 100).toFixed(2);
        let statusCell;
        if (i.qbo_invoice_id) {
          statusCell = `<span style="color:var(--green);">✓ QBO #${this.esc(i.qbo_invoice_id)}</span>`;
        } else if (i.qbo_sync_error) {
          statusCell = `<span style="color:var(--red);" title="${this.esc(i.qbo_sync_error)}">⚠ Error</span>`;
        } else {
          statusCell = '<span style="color:var(--gray-500);">—</span>';
        }
        const action = i.qbo_invoice_id
          ? ''
          : `<button class="btn btn-outline btn-xs" onclick="SettingsPage.syncSingleQboInvoice(${i.id})">Push</button>`;
        return `
          <tr>
            <td style="padding:4px 8px;"><code>${this.esc(i.invoice_number)}</code></td>
            <td style="padding:4px 8px;">${this.esc(i.customer_name || '—')}</td>
            <td style="padding:4px 8px;text-align:right;">$${dollars}</td>
            <td style="padding:4px 8px;">${this.esc(i.status)}</td>
            <td style="padding:4px 8px;">${statusCell}</td>
            <td style="padding:4px 8px;">${action}</td>
          </tr>
        `;
      }).join('');

      table.innerHTML = `
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--gray-100);text-align:left;">
            <th style="padding:4px 8px;">Invoice</th>
            <th style="padding:4px 8px;">Customer</th>
            <th style="padding:4px 8px;text-align:right;">Amount</th>
            <th style="padding:4px 8px;">Status</th>
            <th style="padding:4px 8px;">QBO</th>
            <th style="padding:4px 8px;"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } catch (err) {
      table.innerHTML = `<p style="color:var(--red);">${this.esc(err.message)}</p>`;
    }
  },

  async syncSingleQboInvoice(id) {
    try {
      const r = await Api.post(`/api/quickbooks/sync-invoice/${id}`);
      App.toast(`Pushed to QBO (#${r.qbo_invoice_id})`, 'success');
      this.loadQboSyncStatus();
    } catch (err) {
      App.toast('Push failed: ' + err.message, 'error');
      this.loadQboSyncStatus();
    }
  },

  async syncPendingQboInvoices() {
    if (!confirm('Push all unsynced pending/paid invoices to QuickBooks?')) return;
    const summary = document.getElementById('qboSyncResult');
    if (summary) summary.innerHTML = '<em>Syncing…</em>';
    try {
      const r = await Api.post('/api/quickbooks/sync-pending');
      App.toast(`Synced ${r.succeeded}/${r.total} invoices${r.failed ? ` (${r.failed} failed)` : ''}`, r.failed ? 'warning' : 'success');
      this.loadQboSyncStatus();
    } catch (err) {
      App.toast('Bulk sync failed: ' + err.message, 'error');
    }
  },

  async reconcileQbo() {
    const table = document.getElementById('qboSyncTable');
    const summary = document.getElementById('qboSyncResult');
    if (table) table.innerHTML = '<p style="color:var(--gray-500);">Reconciling against QBO… (this can take a moment)</p>';
    try {
      const r = await Api.get('/api/quickbooks/reconcile');
      if (summary) {
        const drift = r.with_drift || 0;
        const errs = r.errors || 0;
        summary.innerHTML = `Reconciled <strong>${r.checked}</strong> invoices — ${drift ? `<span style="color:var(--red);">${drift} with drift</span>` : '<span style="color:var(--green);">all match ✓</span>'}${errs ? `, <span style="color:var(--red);">${errs} errors</span>` : ''}`;
      }
      const problematic = (r.rows || []).filter(row => row.error || (row.drift_cents && row.drift_cents !== 0));
      if (problematic.length === 0) {
        table.innerHTML = '<p style="color:var(--green);padding:8px;">All synced invoices match QBO totals. ✓</p>';
        return;
      }
      const rows = problematic.map(row => `
        <tr>
          <td style="padding:4px 8px;"><code>${this.esc(row.invoice_number)}</code></td>
          <td style="padding:4px 8px;text-align:right;">$${(row.cat_amount || 0).toFixed(2)}</td>
          <td style="padding:4px 8px;text-align:right;">${row.qbo_amount != null ? '$' + row.qbo_amount.toFixed(2) : '—'}</td>
          <td style="padding:4px 8px;text-align:right;color:var(--red);">${row.drift_cents != null ? '$' + (row.drift_cents / 100).toFixed(2) : ''}</td>
          <td style="padding:4px 8px;color:var(--red);">${this.esc(row.error || '')}</td>
        </tr>
      `).join('');
      table.innerHTML = `
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--gray-100);text-align:left;">
            <th style="padding:4px 8px;">Invoice</th>
            <th style="padding:4px 8px;text-align:right;">CAT</th>
            <th style="padding:4px 8px;text-align:right;">QBO</th>
            <th style="padding:4px 8px;text-align:right;">Drift</th>
            <th style="padding:4px 8px;">Error</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } catch (err) {
      if (summary) summary.innerHTML = `<span style="color:var(--red);">${this.esc(err.message)}</span>`;
      if (table) table.innerHTML = '';
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

  async scanServiceTypeVariants() {
    const btn = document.getElementById('scanSvcVariantsBtn');
    const box = document.getElementById('svcVariantsResults');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
    try {
      const r = await Api.get('/api/admin/diag/service-type-variants');
      const masterRows = r.services_table.map(s =>
        `<tr><td>${s.id}</td><td>${this.esc(s.name)}</td><td>${s.is_active ? '✓' : '—'}</td><td>${s.rounds || 1}</td><td style="color:${s.requires_application === 0 ? 'var(--red)' : 'var(--green)'};font-weight:600;">${s.requires_application === 0 ? 'No' : 'Yes'}</td></tr>`
      ).join('');
      const schedRows = r.schedule_service_types.map(v =>
        `<tr><td>${this.esc(v.service_type)}</td><td style="text-align:right;">${v.count}</td><td><button class="btn btn-sm btn-outline" onclick="SettingsPage.promptMergeServiceType('${this.esc(v.service_type).replace(/'/g, '\\\'')}')">Merge…</button></td></tr>`
      ).join('');
      const itemRows = r.estimate_item_service_names.map(v =>
        `<tr><td>${this.esc(v.service_name)}</td><td style="text-align:right;">${v.count}</td></tr>`
      ).join('');
      box.innerHTML = `
        <div style="font-size:13px;color:var(--gray-700);margin-top:8px;">
          <p style="font-weight:600;margin:8px 0 4px;">Master <code>services</code> table</p>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr style="background:var(--gray-100);"><th style="text-align:left;padding:4px;">ID</th><th style="text-align:left;padding:4px;">Name</th><th style="padding:4px;">Active</th><th style="padding:4px;">Rounds</th><th style="padding:4px;">Chemical Application?</th></tr></thead>
            <tbody>${masterRows || '<tr><td colspan="5" style="padding:6px;font-style:italic;">(empty)</td></tr>'}</tbody>
          </table>
          <p style="font-weight:600;margin:14px 0 4px;">Schedule entries by <code>service_type</code></p>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr style="background:var(--gray-100);"><th style="text-align:left;padding:4px;">Service Type</th><th style="padding:4px;">Count</th><th style="padding:4px;">Action</th></tr></thead>
            <tbody>${schedRows}</tbody>
          </table>
          <p style="font-weight:600;margin:14px 0 4px;">Estimate line items by <code>service_name</code></p>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr style="background:var(--gray-100);"><th style="text-align:left;padding:4px;">Service Name</th><th style="padding:4px;">Count</th></tr></thead>
            <tbody>${itemRows}</tbody>
          </table>
        </div>
      `;
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red);font-size:13px;">Error: ${this.esc(err.message)}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Scan Service Type Variants'; }
    }
  },

  promptMergeServiceType(fromValue) {
    const to = prompt(`Merge "${fromValue}" INTO which canonical service name?\n\nThis will update every schedule entry, every estimate line item, and the master services list. This cannot be undone — but you can always run another merge in the opposite direction.`, 'Fert & Weed Control');
    if (!to || to === fromValue || to.trim() === '') return;
    if (!confirm(`Merge "${fromValue}" → "${to}"?\n\nAll records with the old name will be updated atomically.`)) return;
    this._doMergeServiceType(fromValue, to.trim());
  },

  async _doMergeServiceType(from, to) {
    try {
      const r = await Api.post('/api/admin/fix/merge-service-type', { from, to });
      App.toast(`Merged: ${r.schedules_updated} schedules, ${r.estimate_items_updated} line items, services: ${r.services_action}`, 'success');
      this.scanServiceTypeVariants();
    } catch (err) {
      App.toast('Merge failed: ' + err.message, 'error');
    }
  },

  async scanMultiServicePrograms() {
    const btn = document.getElementById('scanMultiSvcBtn');
    const box = document.getElementById('multiSvcResults');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
    try {
      const r = await Api.get('/api/admin/diag/multi-service-programs');
      if (r.affected_programs === 0) {
        box.innerHTML = `<p style="font-size:13px;color:var(--green);font-weight:600;">No multi-service programs found. Nothing was affected by the reschedule bug.</p>`;
        return;
      }
      const programCards = r.programs.map(p => {
        const serviceBlocks = Object.entries(p.services).map(([svc, visits]) => {
          const visitRows = visits.map(v =>
            `<tr><td>${v.scheduled_date}</td><td>${v.round_number}/${v.total_rounds}</td><td><span class="badge badge-${v.status === 'completed' ? 'green' : v.status === 'cancelled' ? 'gray' : 'blue'}">${v.status}</span></td></tr>`
          ).join('');
          return `
            <div style="margin:10px 0;padding:10px;background:var(--gray-50);border-radius:6px;">
              <p style="font-weight:600;font-size:13px;color:var(--navy);margin-bottom:6px;">${this.esc(svc)} <span style="color:var(--gray-500);font-weight:400;">(${visits.length} visits)</span></p>
              <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead><tr style="background:var(--gray-100);"><th style="text-align:left;padding:4px;">Date</th><th style="text-align:left;padding:4px;">Round</th><th style="text-align:left;padding:4px;">Status</th></tr></thead>
                <tbody>${visitRows}</tbody>
              </table>
            </div>
          `;
        }).join('');
        return `
          <div style="margin:14px 0;padding:14px;background:white;border:1px solid var(--gray-200);border-radius:8px;">
            <p style="font-weight:700;font-size:15px;color:var(--navy);margin-bottom:4px;">${this.esc(p.customer_name)}</p>
            <p style="font-size:12px;color:var(--gray-500);margin-bottom:8px;">${this.esc(p.address)} &middot; ${p.service_count} services &middot; ${p.total_visits} total visits</p>
            ${serviceBlocks}
          </div>
        `;
      }).join('');
      box.innerHTML = `
        <p style="font-size:13px;color:var(--orange);font-weight:600;margin-bottom:8px;">
          ${r.affected_programs} multi-service program${r.affected_programs === 1 ? '' : 's'} across ${r.affected_customers} customer${r.affected_customers === 1 ? '' : 's'}.
        </p>
        <p style="font-size:12px;color:var(--gray-600);margin-bottom:12px;font-style:italic;">
          These clients are potentially affected by the historical reschedule bug. Look for service-type rounds with dates that don't fit the expected cadence (e.g. a fert/weed round on the same day as a mosquito/tick round, or rounds spaced &lt;3 weeks apart).
        </p>
        ${programCards}
      `;
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red);font-size:13px;">Error: ${this.esc(err.message)}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Find Multi-Service Programs'; }
    }
  },

  async scanMissingVisits() {
    const btn = document.getElementById('scanMissingVisitsBtn');
    const box = document.getElementById('missingVisitsResults');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
    try {
      const r = await Api.get('/api/admin/diag/schedule-vs-estimate-counts');
      if (r.mismatch_count === 0) {
        box.innerHTML = `<p style="font-size:13px;color:var(--green);font-weight:600;">No mismatches across ${r.total_recurring_items_checked} recurring service line items checked. Schedule matches estimate everywhere.</p>`;
        return;
      }
      const rows = r.mismatches.map(m => {
        const diffColor = m.diff < 0 ? 'var(--red)' : 'var(--orange)';
        const diffLabel = m.diff < 0 ? `${Math.abs(m.diff)} MISSING` : `${m.diff} extra`;
        return `
          <tr>
            <td style="padding:6px;">${this.esc(m.customer_name)}</td>
            <td style="padding:6px;font-size:12px;">${this.esc(m.service_name)}</td>
            <td style="padding:6px;text-align:center;">${m.expected_rounds}</td>
            <td style="padding:6px;text-align:center;">${m.actual_visits}</td>
            <td style="padding:6px;text-align:center;font-weight:700;color:${diffColor};">${diffLabel}</td>
            <td style="padding:6px;font-size:11px;color:var(--gray-500);">${m.first_visit || '—'} &rarr; ${m.last_visit || '—'}</td>
          </tr>
        `;
      }).join('');
      box.innerHTML = `
        <p style="font-size:13px;color:var(--red);font-weight:600;margin-bottom:8px;">
          ${r.mismatch_count} mismatch${r.mismatch_count === 1 ? '' : 'es'} found across ${r.total_recurring_items_checked} recurring service line items.
        </p>
        <p style="font-size:12px;color:var(--gray-600);margin-bottom:12px;font-style:italic;">
          Sorted by severity. <strong style="color:var(--red);">MISSING</strong> = the schedule has fewer visits than the estimate promises (lost work). <strong style="color:var(--orange);">extra</strong> = the schedule has more visits than expected (over-scheduled).
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="background:var(--gray-100);">
            <th style="text-align:left;padding:6px;">Customer</th>
            <th style="text-align:left;padding:6px;">Service</th>
            <th style="padding:6px;">Expected</th>
            <th style="padding:6px;">Actual</th>
            <th style="padding:6px;">Diff</th>
            <th style="text-align:left;padding:6px;">Date Range</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red);font-size:13px;">Error: ${this.esc(err.message)}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Find Missing/Extra Visits'; }
    }
  },

  async attachOrphanPm() {
    const pm = (document.getElementById('orphanPmId').value || '').trim();
    const estId = (document.getElementById('orphanPmEstId').value || '').trim();
    const box = document.getElementById('orphanPmResults');
    if (!pm.startsWith('pm_')) { App.toast('Payment method ID must start with pm_', 'error'); return; }
    if (!estId) { App.toast('Estimate ID required', 'error'); return; }
    if (!confirm(`Attach payment method ${pm} to estimate #${estId} (and its siblings)?\n\nThis will create or update a Stripe Customer and set this card as default.`)) return;
    box.innerHTML = '<p style="font-size:13px;color:var(--gray-500);">Working...</p>';
    try {
      const r = await Api.post(`/api/admin/fix/attach-orphan-pm/${estId}`, { payment_method_id: pm });
      box.innerHTML = `
        <div style="background:#dcfce7;border:1px solid #86efac;padding:10px;border-radius:6px;font-size:13px;">
          ✓ Attached. Stripe customer: <code>${this.esc(r.stripe_customer_id)}</code><br>
          Linked to estimates: ${r.estimates_updated.map(id => '#' + id).join(', ')}
        </div>
      `;
      App.toast('Card attached — refresh Invoicing to see Charge button', 'success');
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red);font-size:13px;">Error: ${this.esc(err.message)}</p>`;
    }
  },

  async resyncBilling() {
    const estId = (document.getElementById('resyncEstId').value || '').trim();
    const box = document.getElementById('resyncBillingResults');
    if (!estId) { App.toast('Estimate ID required', 'error'); return; }
    if (!confirm(`Resync billing for estimate #${estId}?\n\nThis voids any unpaid invoices and creates new ones based on the estimate's current included items. Paid invoices are preserved. Cannot be undone.`)) return;
    box.innerHTML = '<p style="font-size:13px;color:var(--gray-500);">Working...</p>';
    try {
      const r = await Api.post(`/api/admin/fix/resync-billing-to-items/${estId}`);
      box.innerHTML = `
        <div style="background:#dcfce7;border:1px solid #86efac;padding:10px;border-radius:6px;font-size:13px;">
          ✓ Resynced.<br>
          New total: <strong>$${r.new_total.toFixed(2)}</strong> (monthly: $${r.new_monthly.toFixed(2)})<br>
          Voided ${r.voided_count} unpaid invoice(s), created ${r.created_count} new, preserved ${r.paid_preserved} paid.
        </div>
      `;
      App.toast('Billing resynced', 'success');
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red);font-size:13px;">Error: ${this.esc(err.message)}</p>`;
    }
  },

  async scanAcceptedNoInvoices() {
    const btn = document.getElementById('scanMissingInvoicesBtn');
    const box = document.getElementById('missingInvoicesResults');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
    try {
      const r = await Api.get('/api/admin/diag/accepted-no-invoices');
      if (r.count === 0) {
        box.innerHTML = `<p style="font-size:13px;color:var(--green);font-weight:600;">No accepted estimates missing invoices.</p>`;
        return;
      }
      const rows = r.estimates.map(e => `
        <tr>
          <td style="padding:6px;">#${e.id}</td>
          <td style="padding:6px;">${this.esc(e.customer_name)}</td>
          <td style="padding:6px;font-size:11px;">${this.esc(e.address || '')}</td>
          <td style="padding:6px;text-align:right;">$${e.total_price || 0}</td>
          <td style="padding:6px;text-align:right;">$${e.monthly_price || 0}/mo</td>
          <td style="padding:6px;font-size:11px;color:${e.payment_plan ? 'var(--gray-700)' : 'var(--red)'};">${e.payment_plan || 'NULL'}</td>
          <td style="padding:6px;"><button class="btn btn-sm btn-primary" onclick="SettingsPage.fixEstimateMissingInvoices(${e.id}, '${this.esc(e.customer_name).replace(/'/g, '\\\'')}', ${e.monthly_price || 0})">Fix</button></td>
        </tr>
      `).join('');
      box.innerHTML = `
        <p style="font-size:13px;color:var(--orange);font-weight:600;margin-bottom:8px;">${r.count} accepted estimate${r.count === 1 ? '' : 's'} with no invoices.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="background:var(--gray-100);">
            <th style="padding:6px;text-align:left;">ID</th>
            <th style="padding:6px;text-align:left;">Customer</th>
            <th style="padding:6px;text-align:left;">Address</th>
            <th style="padding:6px;">Total</th>
            <th style="padding:6px;">Monthly</th>
            <th style="padding:6px;">Plan</th>
            <th style="padding:6px;"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red);font-size:13px;">Error: ${this.esc(err.message)}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Find Accepted Estimates Missing Invoices'; }
    }
  },

  async fixEstimateMissingInvoices(estimateId, customerName, monthlyPrice) {
    const plan = prompt(`Fix invoices for ${customerName}.\n\nPayment plan: monthly, full, or per_service`, 'monthly');
    if (!plan || !['monthly', 'full', 'per_service'].includes(plan.trim())) return;
    const method = prompt('Payment method: card or check', 'card');
    if (!method || !['card', 'check'].includes(method.trim())) return;
    if (!confirm(`Set plan=${plan}, method=${method} and generate invoices for ${customerName}?`)) return;
    try {
      const r = await Api.post(`/api/admin/fix/set-plan-and-regen/${estimateId}`, {
        payment_plan: plan.trim(),
        payment_method_preference: method.trim()
      });
      App.toast(`Fixed — ${r.invoices_created} invoice${r.invoices_created === 1 ? '' : 's'} generated`, 'success');
      this.scanAcceptedNoInvoices();
    } catch (err) {
      App.toast('Fix failed: ' + err.message, 'error');
    }
  },

  async runCustomerForensics() {
    const q = (document.getElementById('forensicsQ').value || '').trim();
    if (!q) { App.toast('Enter a customer name first', 'error'); return; }
    const btn = document.getElementById('forensicsBtn');
    const box = document.getElementById('forensicsResults');
    if (btn) { btn.disabled = true; btn.textContent = 'Looking up...'; }
    box.innerHTML = '<p style="font-size:13px;color:var(--gray-500);">Searching...</p>';
    try {
      const r = await Api.get('/api/admin/diag/customer-forensics?q=' + encodeURIComponent(q));
      if (r.properties_found === 0) {
        box.innerHTML = `<p style="font-size:13px;color:var(--red);">No properties found matching "${this.esc(q)}". Try a shorter or different search.</p>`;
        return;
      }
      const cards = r.results.map(rec => {
        const estRows = rec.estimates.map(e => {
          const propIdMismatch = e.property_id && e.property_id !== rec.property.id;
          const propIdMissing = !e.property_id;
          const propLabel = propIdMissing ? '<span style="color:var(--red);font-weight:700;">NULL</span>' :
                            propIdMismatch ? `<span style="color:var(--orange);font-weight:700;">#${e.property_id}</span>` :
                            `#${e.property_id}`;
          return `
            <tr${propIdMismatch || propIdMissing ? ' style="background:#fef3c7;"' : ''}>
              <td style="padding:4px;">#${e.id}</td>
              <td style="padding:4px;font-size:12px;">${this.esc(e.address || '')}</td>
              <td style="padding:4px;font-size:11px;">${propLabel}</td>
              <td style="padding:4px;"><span class="badge badge-${e.status === 'accepted' ? 'green' : e.status === 'declined' ? 'red' : 'gray'}">${e.status}</span></td>
              <td style="padding:4px;font-size:11px;font-weight:700;color:${e.payment_plan === 'per_service' ? 'var(--orange)' : e.payment_plan === 'monthly' ? 'var(--green-dark)' : 'var(--gray-700)'};">${this.esc(e.payment_plan || '—')}</td>
              <td style="padding:4px;font-size:11px;">${this.esc(e.payment_method_preference || '—')}</td>
              <td style="padding:4px;font-size:11px;color:${e.stripe_customer_id ? 'var(--green-dark)' : 'var(--red)'};font-weight:${e.stripe_customer_id ? '700' : '400'};">${e.stripe_customer_id ? '✓ ' + e.stripe_customer_id.slice(0,15) + '…' : 'NONE'}</td>
              <td style="padding:4px;font-size:11px;color:var(--gray-500);">${e.created_at ? e.created_at.slice(0,10) : ''}</td>
              <td style="padding:4px;font-size:11px;color:var(--gray-500);">$${e.total_price || 0}</td>
            </tr>
          `;
        }).join('');
        const svcBlocks = Object.entries(rec.schedules_by_service).map(([svc, visits]) => {
          const visitChips = visits.map(v => {
            const color = v.status === 'completed' ? 'badge-green' : v.status === 'cancelled' ? 'badge-gray' : v.status === 'skipped' ? 'badge-gray' : 'badge-blue';
            return `<span class="${color}" style="padding:2px 6px;border-radius:4px;font-size:11px;margin:1px;display:inline-block;">R${v.round_number || '?'}/${v.total_rounds || '?'} ${v.scheduled_date} (${v.status})</span>`;
          }).join(' ');
          return `<div style="margin:6px 0;"><strong style="font-size:13px;color:var(--navy);">${this.esc(svc)} (${visits.length} visits)</strong><div style="margin-top:4px;">${visitChips}</div></div>`;
        }).join('');
        const auditRows = rec.audit_entries.map(a => `
          <tr>
            <td style="padding:3px;font-size:11px;color:var(--gray-500);">${a.created_at ? a.created_at.slice(0,16) : ''}</td>
            <td style="padding:3px;font-size:11px;">${this.esc(a.user_name || '—')}</td>
            <td style="padding:3px;font-size:11px;">${a.record_type}#${a.record_id}</td>
            <td style="padding:3px;font-size:11px;font-weight:600;color:${a.action.includes('delete') || a.action.includes('cancel') ? 'var(--red)' : 'var(--gray-700)'};">${a.action}</td>
          </tr>
        `).join('');
        const cancelRows = rec.possibly_related_cancel_events.map(e => `
          <tr style="background:#fef2f2;">
            <td style="padding:3px;font-size:11px;color:var(--gray-500);">${e.created_at ? e.created_at.slice(0,16) : ''}</td>
            <td style="padding:3px;font-size:11px;font-weight:700;color:var(--red);">${e.action}</td>
            <td style="padding:3px;font-size:10px;font-family:monospace;color:var(--gray-700);">${this.esc(e.changes_json || '')}</td>
          </tr>
        `).join('');
        return `
          <div style="margin:14px 0;padding:14px;background:white;border:1px solid var(--gray-200);border-radius:8px;">
            <p style="font-weight:700;font-size:15px;color:var(--navy);">${this.esc(rec.property.customer_name)} <span style="color:var(--gray-500);font-size:12px;font-weight:400;">(property #${rec.property.id})</span></p>
            <p style="font-size:12px;color:var(--gray-500);margin-bottom:10px;">${this.esc(rec.property.address || '')} · created ${rec.property.created_at ? rec.property.created_at.slice(0,10) : '?'}</p>

            <p style="font-size:12px;font-weight:600;margin-top:10px;color:var(--gray-700);">Estimates (${rec.estimates.length})</p>
            ${rec.estimates.length === 0 ? '<p style="font-size:12px;color:var(--gray-500);font-style:italic;">None</p>' : `
              <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead><tr style="background:var(--gray-100);"><th style="text-align:left;padding:4px;">ID</th><th style="text-align:left;padding:4px;">Address</th><th style="padding:4px;">property_id</th><th style="padding:4px;">Status</th><th style="padding:4px;">Plan</th><th style="padding:4px;">Method</th><th style="padding:4px;">Stripe Cust</th><th style="padding:4px;">Created</th><th style="padding:4px;">Total</th></tr></thead>
                <tbody>${estRows}</tbody>
              </table>
            `}

            <p style="font-size:12px;font-weight:600;margin-top:14px;color:var(--gray-700);">Schedule entries (${rec.schedule_total} total)</p>
            ${rec.schedule_total === 0 ? '<p style="font-size:12px;color:var(--red);font-style:italic;">No schedule entries currently in the database for this property.</p>' : svcBlocks}

            <p style="font-size:12px;font-weight:600;margin-top:14px;color:var(--gray-700);">Audit log (${rec.audit_entries.length})</p>
            ${rec.audit_entries.length === 0 ? '<p style="font-size:12px;color:var(--gray-500);font-style:italic;">None</p>' : `
              <table style="width:100%;border-collapse:collapse;font-size:11px;">
                <thead><tr style="background:var(--gray-100);"><th style="text-align:left;padding:3px;">When</th><th style="text-align:left;padding:3px;">By</th><th style="text-align:left;padding:3px;">Target</th><th style="text-align:left;padding:3px;">Action</th></tr></thead>
                <tbody>${auditRows}</tbody>
              </table>
            `}

            ${rec.possibly_related_cancel_events.length > 0 ? `
              <p style="font-size:12px;font-weight:700;margin-top:14px;color:var(--red);">⚠ Possible cancel events (program_id match)</p>
              <table style="width:100%;border-collapse:collapse;font-size:11px;">
                <tbody>${cancelRows}</tbody>
              </table>
            ` : ''}
          </div>
        `;
      }).join('');
      box.innerHTML = `<p style="font-size:13px;color:var(--gray-700);margin-bottom:8px;"><strong>${r.properties_found}</strong> propert${r.properties_found === 1 ? 'y' : 'ies'} found matching "${this.esc(q)}"</p>${cards}`;
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red);font-size:13px;">Error: ${this.esc(err.message)}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Look Up'; }
    }
  },

  async scanReshuffleHistory() {
    const btn = document.getElementById('scanReshuffleBtn');
    const box = document.getElementById('reshuffleResults');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
    try {
      const r = await Api.get('/api/admin/diag/series-shift-history');
      if (r.count === 0) {
        box.innerHTML = `<p style="font-size:13px;color:var(--green);font-weight:600;">No series-reshuffle actions in the audit log.</p>`;
        return;
      }
      const rows = r.actions.map(a => `
        <tr>
          <td style="padding:4px;font-size:11px;color:var(--gray-500);">${new Date(a.timestamp).toLocaleString()}</td>
          <td style="padding:4px;">${this.esc(a.customer_name)}</td>
          <td style="padding:4px;font-size:12px;">${this.esc(a.service_type_of_moved_visit || '(none)')}</td>
          <td style="padding:4px;font-size:12px;">${a.old_date} → ${a.new_date}</td>
          <td style="padding:4px;text-align:right;font-weight:700;color:${a.series_shifted > 8 ? 'var(--red)' : a.series_shifted > 4 ? 'var(--orange)' : 'var(--gray-700)'};">${a.series_shifted}</td>
        </tr>
      `).join('');
      box.innerHTML = `
        <p style="font-size:13px;color:var(--gray-700);margin-bottom:8px;">
          ${r.count} series-reshuffle action${r.count === 1 ? '' : 's'} in audit log. Counts in red/orange are the largest reshuffle events — most likely to have moved visits across service types.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:var(--gray-100);">
            <th style="text-align:left;padding:4px;">When</th>
            <th style="text-align:left;padding:4px;">Customer</th>
            <th style="text-align:left;padding:4px;">Service Moved</th>
            <th style="text-align:left;padding:4px;">Date Change</th>
            <th style="text-align:right;padding:4px;">Others Shifted</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red);font-size:13px;">Error: ${this.esc(err.message)}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Show Series Reshuffle History'; }
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
