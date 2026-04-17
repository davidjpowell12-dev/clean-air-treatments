const DashboardPage = {
  async render() {
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <div class="page-header"><div class="skeleton skeleton-title"></div></div>
      <div class="stat-grid">
        <div class="skeleton skeleton-stat"></div>
        <div class="skeleton skeleton-stat"></div>
        <div class="skeleton skeleton-stat"></div>
        <div class="skeleton skeleton-stat"></div>
      </div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    `;

    try {
      const [products, inventory, applications, properties, financials, needsScheduling, billingStats, followUpCounts, followUpTop, msgCounts] = await Promise.all([
        Api.get('/api/products'),
        Api.get('/api/inventory'),
        Api.get('/api/applications?limit=5'),
        Api.get('/api/properties').catch(() => []),
        Api.get('/api/applications/stats').catch(() => ({ total_revenue: 0, total_cost: 0, total_margin: 0, margin_pct: 0 })),
        Api.get('/api/estimates/needs-scheduling').catch(() => []),
        Api.get('/api/payments/dashboard').catch(() => ({ failed_count: 0, scheduled_count: 0 })),
        Api.get('/api/follow-ups/counts').catch(() => ({ today: 0, this_week: 0, someday: 0, waiting_me: 0, waiting_customer: 0, total: 0 })),
        Api.get('/api/follow-ups?status=open&bucket=today').catch(() => []),
        Api.get('/api/messaging/drafts/counts').catch(() => ({ heads_up_ready: 0, completion_ready: 0, failed: 0 }))
      ]);

      const lowStock = inventory.filter(i => i.quantity <= i.reorder_threshold);
      const today = new Date().toISOString().split('T')[0];
      const todayApps = applications.filter(a => a.application_date === today);

      main.innerHTML = `
        <div class="page-header">
          <h2>Dashboard</h2>
        </div>

        <div class="stat-grid">
          <div class="stat-card stat-card-green">
            <div class="stat-value">${todayApps.length}</div>
            <div class="stat-label">Today's Apps</div>
          </div>
          <div class="stat-card stat-card-blue">
            <div class="stat-value">${properties.length}</div>
            <div class="stat-label">Properties</div>
          </div>
          <div class="stat-card stat-card-purple">
            <div class="stat-value">${products.length}</div>
            <div class="stat-label">Products</div>
          </div>
          <div class="stat-card stat-card-${lowStock.length > 0 ? 'red' : 'orange'}">
            <div class="stat-value">${lowStock.length}</div>
            <div class="stat-label">Low Stock</div>
          </div>
        </div>

        ${financials.total_revenue > 0 ? `
          <div class="stat-grid" style="margin-top:4px;">
            <div class="stat-card stat-card-green">
              <div class="stat-value" style="font-size:22px;color:var(--green-dark);">$${Number(financials.total_revenue).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})}</div>
              <div class="stat-label">YTD Revenue</div>
            </div>
            <div class="stat-card stat-card-orange">
              <div class="stat-value" style="font-size:22px;">$${Number(financials.total_cost).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})}</div>
              <div class="stat-label">YTD Costs</div>
            </div>
            <div class="stat-card stat-card-${financials.total_margin >= 0 ? 'teal' : 'red'}">
              <div class="stat-value" style="font-size:22px;color:${financials.total_margin >= 0 ? 'var(--green-dark)' : 'var(--red)'};">$${Number(financials.total_margin).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})}</div>
              <div class="stat-label">YTD Margin</div>
            </div>
            <div class="stat-card stat-card-${financials.margin_pct >= 0 ? 'blue' : 'red'}">
              <div class="stat-value" style="font-size:22px;color:${financials.margin_pct >= 0 ? 'var(--green-dark)' : 'var(--red)'};">${financials.margin_pct}%</div>
              <div class="stat-label">Margin %</div>
            </div>
          </div>
        ` : ''}

        <div class="card" style="margin-top:12px;border:2px solid var(--blue, #1d428a);border-left:6px solid var(--blue, #1d428a);">
          <div class="card-header" style="cursor:pointer;" onclick="App.navigate('follow-ups')">
            <h3 style="color:var(--blue, #1d428a);">📋 Follow-ups${followUpCounts.total > 0 ? ' (' + followUpCounts.total + ')' : ''}</h3>
            <span class="back-link">View All →</span>
          </div>
          ${followUpCounts.total === 0 ? `
            <div style="padding:20px 16px;text-align:center;">
              <p style="color:var(--gray-700);font-size:14px;margin-bottom:12px;">
                Capture client requests as they come up — additional services, things to check on, questions to follow up.
              </p>
              <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();FollowUpsPage.openCreate()">+ Capture your first follow-up</button>
            </div>
          ` : `
            <div class="fu-dash-widget">
              <div class="fu-dash-bucket today" onclick="App.navigate('follow-ups')">
                <div class="fu-dash-bucket-count">${followUpCounts.today}</div>
                <div class="fu-dash-bucket-label">🔥 Today</div>
              </div>
              <div class="fu-dash-bucket" onclick="App.navigate('follow-ups')">
                <div class="fu-dash-bucket-count">${followUpCounts.this_week}</div>
                <div class="fu-dash-bucket-label">📆 This Week</div>
              </div>
              <div class="fu-dash-bucket" onclick="App.navigate('follow-ups')">
                <div class="fu-dash-bucket-count">${followUpCounts.someday}</div>
                <div class="fu-dash-bucket-label">💭 Someday</div>
              </div>
            </div>
            <div class="fu-dash-split">
              <span><strong>${followUpCounts.waiting_me}</strong> on me</span>
              <span>·</span>
              <span><strong>${followUpCounts.waiting_customer}</strong> waiting on customer</span>
            </div>
            ${followUpTop.slice(0, 3).length > 0 ? `
              <div style="border-top:1px solid var(--gray-200);">
                ${followUpTop.slice(0, 3).map(f => `
                  <div class="data-row" style="cursor:pointer;" onclick="event.stopPropagation();FollowUpsPage.openEdit(${f.id})">
                    <div class="data-row-main">
                      <h4>${f.pinned ? '📌 ' : ''}${this.escapeHtml(f.title)}</h4>
                      ${f.customer_name ? `<p style="color:var(--blue);font-weight:600;font-size:12px;">${this.escapeHtml(f.customer_name)}</p>` : ''}
                    </div>
                    <div class="data-row-right">
                      <button class="btn-icon fu-done-btn" onclick="event.stopPropagation();FollowUpsPage.complete(${f.id})" title="Mark done">✓</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          `}
        </div>

        ${(msgCounts.heads_up_ready + msgCounts.completion_ready + msgCounts.failed) > 0 ? `
          <div class="card" style="margin-top:12px;border:2px solid #7c3aed;border-left:6px solid #7c3aed;cursor:pointer;" onclick="App.navigate('messaging')">
            <div class="card-header">
              <h3 style="color:#7c3aed;">📱 Messages to Send</h3>
              <span class="back-link">Review →</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:12px 16px;">
              <div style="text-align:center;">
                <div style="font-size:22px;font-weight:800;color:${msgCounts.heads_up_ready > 0 ? '#7c3aed' : 'var(--gray-400)'};">${msgCounts.heads_up_ready}</div>
                <div style="font-size:11px;color:var(--gray-600);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">🔔 Heads-ups</div>
              </div>
              <div style="text-align:center;">
                <div style="font-size:22px;font-weight:800;color:${msgCounts.completion_ready > 0 ? '#7c3aed' : 'var(--gray-400)'};">${msgCounts.completion_ready}</div>
                <div style="font-size:11px;color:var(--gray-600);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">✅ Completions</div>
              </div>
              <div style="text-align:center;">
                <div style="font-size:22px;font-weight:800;color:${msgCounts.failed > 0 ? 'var(--red)' : 'var(--gray-400)'};">${msgCounts.failed}</div>
                <div style="font-size:11px;color:var(--gray-600);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">⚠ Failed</div>
              </div>
            </div>
          </div>
        ` : ''}

        ${billingStats.failed_count > 0 ? `
          <div class="card" style="margin-top:12px;border:2px solid #dc2626;border-left:6px solid #dc2626;cursor:pointer;" onclick="App.navigate('invoicing');setTimeout(()=>{const t=document.querySelector('.est-tab[data-filter=failed]');if(t)t.click();},100);">
            <div class="card-header">
              <h3 style="color:#dc2626;">Failed Payments</h3>
              <span class="badge badge-red" style="font-size:14px;padding:6px 14px;">${billingStats.failed_count}</span>
            </div>
            <div class="card-body" style="padding:12px 16px;">
              <p style="font-size:14px;color:var(--gray-700);">${billingStats.failed_count} invoice${billingStats.failed_count > 1 ? 's have' : ' has'} failed payment. Click to review and retry.</p>
            </div>
          </div>
        ` : ''}

        ${needsScheduling.length > 0 ? `
          <div class="card" style="margin-top:12px;border:2px solid var(--green);border-left:6px solid var(--green);">
            <div class="card-header" style="cursor:pointer;" onclick="this.parentElement.querySelector('.card-body').style.display = this.parentElement.querySelector('.card-body').style.display === 'none' ? '' : 'none'">
              <h3 style="color:var(--green-dark, #2d5a0f);">📅 Needs Scheduling (${needsScheduling.length})</h3>
              <span class="badge badge-green" style="font-size:13px;">${needsScheduling.length} job${needsScheduling.length > 1 ? 's' : ''}</span>
            </div>
            <div class="card-body" style="padding:0;">
              ${needsScheduling.map(e => {
                const days = e.days_since_accepted || 0;
                const urgencyColor = days >= 5 ? 'var(--red, #e53e3e)' : days >= 2 ? 'var(--orange, #dd6b20)' : 'var(--green)';
                const urgencyLabel = days >= 5 ? 'Urgent' : days >= 2 ? `${days}d ago` : 'New';
                return `
                  <div class="data-row" onclick="App.navigate('estimates', 'view', ${e.id})" style="cursor:pointer;">
                    <div class="data-row-main">
                      <h4>${this.escapeHtml(e.customer_name)}</h4>
                      <p>${this.escapeHtml(e.address || '')}${e.city ? ', ' + this.escapeHtml(e.city) : ''} &middot; $${e.total_price.toFixed(0)}</p>
                    </div>
                    <div class="data-row-right">
                      <span class="badge" style="background:${urgencyColor};color:white;font-size:11px;">${urgencyLabel}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        ${lowStock.length > 0 ? `
          <div class="card card-accent">
            <div class="card-header">
              <h3>Low Inventory Alerts</h3>
            </div>
            <div class="card-body">
              ${lowStock.map(i => `
                <div class="data-row" onclick="App.navigate('inventory')">
                  <div class="data-row-main">
                    <h4>${this.escapeHtml(i.product_name)}</h4>
                    <p>${i.quantity} ${i.unit_of_measure} remaining</p>
                  </div>
                  <div class="data-row-right">
                    <span class="badge ${i.quantity <= 0 ? 'badge-red' : 'badge-orange'}">
                      ${i.quantity <= 0 ? 'OUT' : 'LOW'}
                    </span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="card">
          <div class="card-header">
            <h3>Quick Actions</h3>
          </div>
          <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <button class="btn btn-primary" onclick="App.navigate('applications', 'new')">Log Application</button>
            <button class="btn btn-secondary" onclick="App.navigate('properties', 'new')">Add Property</button>
            <button class="btn btn-outline" onclick="App.navigate('calculator')">Calculator</button>
            <button class="btn btn-outline" onclick="App.navigate('products')">Products</button>
          </div>
        </div>

        ${applications.length > 0 ? `
          <div class="card">
            <div class="card-header">
              <h3>Recent Applications</h3>
              <a href="#applications" class="back-link" onclick="App.navigate('applications');return false;">View All</a>
            </div>
            ${applications.slice(0, 5).map(a => `
              <div class="data-row" onclick="App.navigate('applications', 'view', ${a.id})">
                <div class="data-row-main">
                  <h4>${this.escapeHtml(a.product_name)}</h4>
                  <p>${this.escapeHtml(a.property_customer_name || a.address || '')} &middot; ${a.application_date}</p>
                </div>
                <div class="data-row-right">
                  <span class="badge badge-green">${this.escapeHtml(a.application_method || 'N/A')}</span>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      `;
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error loading dashboard</h3><p>${err.message}</p></div>`;
    }
  },

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
