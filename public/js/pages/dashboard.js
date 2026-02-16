const DashboardPage = {
  async render() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const [products, inventory, applications, properties] = await Promise.all([
        Api.get('/api/products'),
        Api.get('/api/inventory'),
        Api.get('/api/applications?limit=5'),
        Api.get('/api/properties').catch(() => [])
      ]);

      const lowStock = inventory.filter(i => i.quantity <= i.reorder_threshold);
      const today = new Date().toISOString().split('T')[0];
      const todayApps = applications.filter(a => a.application_date === today);

      main.innerHTML = `
        <div class="page-header">
          <h2>Dashboard</h2>
        </div>

        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-value">${todayApps.length}</div>
            <div class="stat-label">Today's Apps</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${properties.length}</div>
            <div class="stat-label">Properties</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${products.length}</div>
            <div class="stat-label">Products</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${lowStock.length}</div>
            <div class="stat-label">Low Stock</div>
          </div>
        </div>

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
