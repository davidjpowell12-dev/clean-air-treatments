const ProductsPage = {
  async render(action, id) {
    if (action === 'new' || action === 'edit') return this.renderForm(action === 'edit' ? id : null);
    if (action === 'view' && id) return this.renderDetail(id);
    return this.renderList();
  },

  async renderList() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const products = await Api.get('/api/products');
      const isAdmin = App.user.role === 'admin';

      main.innerHTML = `
        <div class="page-header">
          <h2>Products</h2>
          ${isAdmin ? '<button class="btn btn-primary btn-sm" onclick="App.navigate(\'products\', \'new\')">+ Add Product</button>' : ''}
        </div>

        <div class="search-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="productSearch" placeholder="Search products...">
        </div>

        <div class="filter-pills">
          <span class="pill active" data-filter="all">All</span>
          <span class="pill" data-filter="herbicide">Herbicide</span>
          <span class="pill" data-filter="pesticide">Pesticide</span>
          <span class="pill" data-filter="fertilizer">Fertilizer</span>
          <span class="pill" data-filter="adjuvant">Adjuvant</span>
        </div>

        <div class="card">
          <div id="productList">
            ${products.length === 0 ? `
              <div class="empty-state">
                <h3>No products yet</h3>
                <p>Add your first product to get started</p>
                ${isAdmin ? '<button class="btn btn-primary" onclick="App.navigate(\'products\', \'new\')">Add Product</button>' : ''}
              </div>
            ` : products.map(p => this.renderRow(p)).join('')}
          </div>
        </div>
      `;

      this._products = products;

      // Search
      document.getElementById('productSearch').addEventListener('input', (e) => {
        this.filterProducts(e.target.value);
      });

      // Filter pills
      document.querySelectorAll('.filter-pills .pill').forEach(pill => {
        pill.addEventListener('click', () => {
          document.querySelectorAll('.filter-pills .pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          this.filterProducts(document.getElementById('productSearch').value, pill.dataset.filter);
        });
      });
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  renderRow(p) {
    const typeColors = { herbicide: 'badge-green', pesticide: 'badge-red', fertilizer: 'badge-blue', adjuvant: 'badge-gray' };
    return `
      <div class="data-row" data-type="${p.product_type}" data-name="${this.esc(p.name).toLowerCase()}" onclick="App.navigate('products', 'view', ${p.id})">
        <div class="data-row-main">
          <h4>${this.esc(p.name)}</h4>
          <p>${p.epa_reg_number ? 'EPA# ' + this.esc(p.epa_reg_number) : p.formulation || ''} &middot; ${p.app_rate_low || '?'}–${p.app_rate_high || '?'} ${this.esc(p.app_rate_unit || '')}</p>
        </div>
        <div class="data-row-right">
          <span class="badge ${typeColors[p.product_type] || 'badge-gray'}">${this.esc(p.product_type)}</span>
        </div>
      </div>
    `;
  },

  filterProducts(query, type) {
    const q = (query || '').toLowerCase();
    const activeType = type || document.querySelector('.filter-pills .pill.active')?.dataset.filter || 'all';
    document.querySelectorAll('#productList .data-row').forEach(row => {
      const matchesType = activeType === 'all' || row.dataset.type === activeType;
      const matchesSearch = !q || row.dataset.name.includes(q);
      row.style.display = matchesType && matchesSearch ? '' : 'none';
    });
  },

  async renderDetail(id) {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const p = await Api.get(`/api/products/${id}`);
      const isAdmin = App.user.role === 'admin';

      main.innerHTML = `
        <span class="back-link" onclick="App.navigate('products')">&larr; Products</span>

        <div class="card">
          <div class="card-header">
            <h3>${this.esc(p.name)}</h3>
            ${isAdmin ? `
              <div style="display:flex;gap:8px;">
                <button class="btn btn-sm btn-outline" onclick="App.navigate('products', 'edit', ${p.id})">Edit</button>
                <button class="btn btn-sm btn-danger" onclick="ProductsPage.deleteProduct(${p.id})">Delete</button>
              </div>
            ` : ''}
          </div>
          <div class="card-body">
            <div class="detail-section">
              <h3>Product Info</h3>
              <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${this.esc(p.product_type)}</span></div>
              <div class="detail-row"><span class="detail-label">EPA Reg #</span><span class="detail-value">${this.esc(p.epa_reg_number || 'N/A')}</span></div>
              <div class="detail-row"><span class="detail-label">Active Ingredients</span><span class="detail-value">${this.esc(p.active_ingredients || 'N/A')}</span></div>
              <div class="detail-row"><span class="detail-label">Formulation</span><span class="detail-value">${this.esc(p.formulation || 'N/A')}</span></div>
              <div class="detail-row"><span class="detail-label">Signal Word</span><span class="detail-value">${this.esc(p.signal_word || 'N/A')}</span></div>
              <div class="detail-row"><span class="detail-label">Restricted Use</span><span class="detail-value">${p.is_restricted_use ? 'Yes' : 'No'}</span></div>
              <div class="detail-row"><span class="detail-label">REI</span><span class="detail-value">${p.rei_hours ? p.rei_hours + ' hours' : 'N/A'}</span></div>
            </div>

            <div class="detail-section">
              <h3>Application Rates</h3>
              <div class="detail-row"><span class="detail-label">Low Rate</span><span class="detail-value">${p.app_rate_low || 'N/A'} ${this.esc(p.app_rate_unit || '')}</span></div>
              <div class="detail-row"><span class="detail-label">High Rate</span><span class="detail-value">${p.app_rate_high || 'N/A'} ${this.esc(p.app_rate_unit || '')}</span></div>
              ${p.mix_rate_oz_per_gal ? `<div class="detail-row"><span class="detail-label">Mix Rate</span><span class="detail-value">${p.mix_rate_oz_per_gal} oz/gal</span></div>` : ''}
              ${p.spray_volume_gal_per_1000 ? `<div class="detail-row"><span class="detail-label">Spray Volume</span><span class="detail-value">${p.spray_volume_gal_per_1000} gal/1000sqft</span></div>` : ''}
            </div>

            <div class="detail-section">
              <h3>Packaging & Cost</h3>
              <div class="detail-row"><span class="detail-label">Unit</span><span class="detail-value">${this.esc(p.unit_of_measure)}</span></div>
              <div class="detail-row"><span class="detail-label">Package Size</span><span class="detail-value">${p.package_size || 'N/A'} ${this.esc(p.unit_of_measure)}</span></div>
              <div class="detail-row"><span class="detail-label">Cost/Unit</span><span class="detail-value">${p.cost_per_unit ? '$' + Number(p.cost_per_unit).toFixed(2) : 'N/A'}</span></div>
            </div>

            ${p.data_sheet_url ? `<a href="${this.esc(p.data_sheet_url)}" target="_blank" class="btn btn-outline btn-full" style="margin-top:10px;">View SDS / Label</a>` : ''}
            ${p.notes ? `<div class="detail-section"><h3>Notes</h3><p style="font-size:14px;color:var(--gray-700);">${this.esc(p.notes)}</p></div>` : ''}
          </div>
        </div>
      `;
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  async renderForm(editId) {
    const main = document.getElementById('mainContent');
    let product = {};

    if (editId) {
      main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      product = await Api.get(`/api/products/${editId}`);
    }

    main.innerHTML = `
      <span class="back-link" onclick="App.navigate('products')">&larr; Products</span>
      <div class="card">
        <div class="card-header"><h3>${editId ? 'Edit' : 'Add'} Product</h3></div>
        <div class="card-body">
          <form id="productForm" class="app-form">
            <div class="form-group">
              <label>Product Name *</label>
              <input type="text" name="name" value="${this.esc(product.name || '')}" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Type *</label>
                <select name="product_type" required>
                  <option value="">Select...</option>
                  <option value="herbicide" ${product.product_type === 'herbicide' ? 'selected' : ''}>Herbicide</option>
                  <option value="pesticide" ${product.product_type === 'pesticide' ? 'selected' : ''}>Pesticide</option>
                  <option value="fertilizer" ${product.product_type === 'fertilizer' ? 'selected' : ''}>Fertilizer</option>
                  <option value="adjuvant" ${product.product_type === 'adjuvant' ? 'selected' : ''}>Adjuvant</option>
                </select>
              </div>
              <div class="form-group">
                <label>Formulation</label>
                <select name="formulation">
                  <option value="">Select...</option>
                  <option value="liquid" ${product.formulation === 'liquid' ? 'selected' : ''}>Liquid</option>
                  <option value="granular" ${product.formulation === 'granular' ? 'selected' : ''}>Granular</option>
                  <option value="wettable_powder" ${product.formulation === 'wettable_powder' ? 'selected' : ''}>Wettable Powder</option>
                  <option value="dry_flowable" ${product.formulation === 'dry_flowable' ? 'selected' : ''}>Dry Flowable</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>EPA Registration #</label>
              <input type="text" name="epa_reg_number" value="${this.esc(product.epa_reg_number || '')}">
            </div>
            <div class="form-group">
              <label>Active Ingredients</label>
              <input type="text" name="active_ingredients" value="${this.esc(product.active_ingredients || '')}" placeholder="e.g. 2,4-D 28.57%, Mecoprop 2.77%">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Unit of Measure *</label>
                <select name="unit_of_measure" required>
                  <option value="">Select...</option>
                  <option value="oz" ${product.unit_of_measure === 'oz' ? 'selected' : ''}>oz</option>
                  <option value="lb" ${product.unit_of_measure === 'lb' ? 'selected' : ''}>lb</option>
                  <option value="gal" ${product.unit_of_measure === 'gal' ? 'selected' : ''}>gal</option>
                  <option value="bag" ${product.unit_of_measure === 'bag' ? 'selected' : ''}>bag</option>
                </select>
              </div>
              <div class="form-group">
                <label>Package Size</label>
                <input type="number" step="any" name="package_size" value="${product.package_size || ''}">
              </div>
            </div>
            <div class="form-group">
              <label>Cost per Unit ($)</label>
              <input type="number" step="0.01" name="cost_per_unit" value="${product.cost_per_unit || ''}">
            </div>

            <h3 style="color:var(--blue);margin:20px 0 12px;font-size:16px;">Application Rates</h3>
            <div class="form-row">
              <div class="form-group">
                <label>Low Rate</label>
                <input type="number" step="any" name="app_rate_low" value="${product.app_rate_low || ''}">
              </div>
              <div class="form-group">
                <label>High Rate</label>
                <input type="number" step="any" name="app_rate_high" value="${product.app_rate_high || ''}">
              </div>
            </div>
            <div class="form-group">
              <label>Rate Unit</label>
              <select name="app_rate_unit">
                <option value="">Select...</option>
                <option value="oz/1000sqft" ${product.app_rate_unit === 'oz/1000sqft' ? 'selected' : ''}>oz / 1,000 sq ft</option>
                <option value="lb/1000sqft" ${product.app_rate_unit === 'lb/1000sqft' ? 'selected' : ''}>lb / 1,000 sq ft</option>
                <option value="fl oz/1000sqft" ${product.app_rate_unit === 'fl oz/1000sqft' ? 'selected' : ''}>fl oz / 1,000 sq ft</option>
                <option value="gal/acre" ${product.app_rate_unit === 'gal/acre' ? 'selected' : ''}>gal / acre</option>
              </select>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Mix Rate (oz/gal)</label>
                <input type="number" step="any" name="mix_rate_oz_per_gal" value="${product.mix_rate_oz_per_gal || ''}" placeholder="For liquids">
              </div>
              <div class="form-group">
                <label>Spray Vol (gal/1000sqft)</label>
                <input type="number" step="any" name="spray_volume_gal_per_1000" value="${product.spray_volume_gal_per_1000 || ''}">
              </div>
            </div>

            <h3 style="color:var(--blue);margin:20px 0 12px;font-size:16px;">Safety & Restrictions</h3>
            <div class="form-row">
              <div class="form-group">
                <label>Signal Word</label>
                <select name="signal_word">
                  <option value="">None</option>
                  <option value="CAUTION" ${product.signal_word === 'CAUTION' ? 'selected' : ''}>CAUTION</option>
                  <option value="WARNING" ${product.signal_word === 'WARNING' ? 'selected' : ''}>WARNING</option>
                  <option value="DANGER" ${product.signal_word === 'DANGER' ? 'selected' : ''}>DANGER</option>
                </select>
              </div>
              <div class="form-group">
                <label>REI (hours)</label>
                <input type="number" step="any" name="rei_hours" value="${product.rei_hours || ''}">
              </div>
            </div>
            <div class="checkbox-group">
              <input type="checkbox" id="isRestricted" name="is_restricted_use" ${product.is_restricted_use ? 'checked' : ''}>
              <label for="isRestricted">Restricted Use Pesticide (RUP)</label>
            </div>
            <div class="form-group">
              <label>SDS / Label URL</label>
              <input type="url" name="data_sheet_url" value="${this.esc(product.data_sheet_url || '')}" placeholder="https://...">
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea name="notes" rows="3">${this.esc(product.notes || '')}</textarea>
            </div>

            <button type="submit" class="btn btn-primary btn-full">${editId ? 'Save Changes' : 'Add Product'}</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('productForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData.entries());
      data.is_restricted_use = document.getElementById('isRestricted').checked ? 1 : 0;

      // Convert numeric fields
      ['package_size', 'cost_per_unit', 'app_rate_low', 'app_rate_high', 'mix_rate_oz_per_gal', 'spray_volume_gal_per_1000', 'rei_hours'].forEach(f => {
        data[f] = data[f] ? Number(data[f]) : null;
      });

      try {
        if (editId) {
          await Api.put(`/api/products/${editId}`, data);
          App.toast('Product updated', 'success');
        } else {
          await Api.post('/api/products', data);
          App.toast('Product added', 'success');
        }
        App.navigate('products');
      } catch (err) {
        App.toast(err.message, 'error');
      }
    });
  },

  async deleteProduct(id) {
    if (!confirm('Delete this product? This cannot be undone.')) return;
    try {
      await Api.delete(`/api/products/${id}`);
      App.toast('Product deleted', 'success');
      App.navigate('products');
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
