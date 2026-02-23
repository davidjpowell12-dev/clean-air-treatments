const InventoryPage = {
  async render() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const inventory = await Api.get('/api/inventory');

      main.innerHTML = `
        <div class="page-header">
          <h2>Inventory</h2>
          <button class="btn btn-primary btn-sm" onclick="InventoryPage.showReceiveModal()">+ Receive</button>
        </div>

        <div class="search-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="invSearch" placeholder="Search inventory...">
        </div>

        <div class="card">
          <div id="inventoryList">
            ${inventory.length === 0 ? `
              <div class="empty-state">
                <h3>No products in inventory</h3>
                <p>Add products first, then manage stock levels here</p>
              </div>
            ` : inventory.map(i => this.renderRow(i)).join('')}
          </div>
        </div>
      `;

      document.getElementById('invSearch').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('#inventoryList .data-row').forEach(row => {
          row.style.display = row.dataset.name.includes(q) ? '' : 'none';
        });
      });
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  renderRow(i) {
    let stockBadge = 'badge-green';
    let stockLabel = 'OK';

    if (i.quantity <= 0) {
      stockBadge = 'badge-red';
      stockLabel = 'OUT';
    } else if (i.reorder_threshold > 0 && i.quantity <= i.reorder_threshold) {
      stockBadge = 'badge-orange';
      stockLabel = 'LOW';
    }

    return `
      <div class="data-row" data-name="${this.esc(i.product_name).toLowerCase()}" data-product-id="${i.product_id}" onclick="InventoryPage.showHistory(${i.product_id}, '${this.esc(i.product_name).replace(/'/g, "\\'")}', '${this.esc(i.unit_of_measure).replace(/'/g, "\\'")}')" style="cursor:pointer;">
        <div class="data-row-main">
          <h4>${this.esc(i.product_name)}</h4>
          <p>${this.esc(i.product_type)} &middot; ${i.unit_of_measure}</p>
          ${i.reorder_threshold > 0 ? `<p style="font-size:11px;color:var(--gray-400);">Alert at: ${Number(i.reorder_threshold).toFixed(1)}</p>` : ''}
        </div>
        <div class="data-row-right" style="display:flex;align-items:center;gap:10px;">
          <div style="text-align:right;">
            <div style="font-size:18px;font-weight:700;">${Number(i.quantity).toFixed(1)}</div>
            <span class="badge ${stockBadge}" style="font-size:10px;">${stockLabel}</span>
          </div>
          <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();InventoryPage.showAdjustModal(${i.product_id}, '${this.esc(i.product_name).replace(/'/g, "\\'")}', ${i.quantity}, '${this.esc(i.unit_of_measure).replace(/'/g, "\\'")}', ${i.reorder_threshold || 0})">Adjust</button>
        </div>
      </div>
    `;
  },

  // --- Adjust Stock Modal (with threshold) ---
  showAdjustModal(productId, name, currentQty, unit, currentThreshold) {
    document.querySelector('.modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Adjust Stock</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').classList.remove('open');setTimeout(()=>this.closest('.modal-overlay').remove(),200)">&times;</button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom:16px;"><strong>${this.esc(name)}</strong> — Current: ${Number(currentQty).toFixed(1)} ${this.esc(unit)}</p>
          <form id="adjustForm" class="app-form">
            <div class="form-group">
              <label>Reason</label>
              <select name="reason" required>
                <option value="purchase">Purchase / Received</option>
                <option value="adjustment">Manual Adjustment</option>
                <option value="waste">Waste / Spillage</option>
              </select>
            </div>
            <div class="form-group">
              <label>Amount (+ to add, - to deduct)</label>
              <input type="number" step="any" name="change_amount" required placeholder="e.g. 2.5 or -1">
            </div>
            <div class="form-group">
              <label>Low Stock Alert Threshold</label>
              <input type="number" step="any" min="0" name="reorder_threshold" value="${currentThreshold}" placeholder="e.g. 2.0">
              <p class="form-hint">Status shows LOW when stock falls to this level</p>
            </div>
            <button type="submit" class="btn btn-primary btn-full">Apply</button>
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

    document.getElementById('adjustForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const changeAmount = Number(formData.get('change_amount'));
      const newThreshold = Number(formData.get('reorder_threshold'));

      try {
        if (changeAmount !== 0) {
          await Api.post('/api/inventory/adjust', {
            product_id: productId,
            change_amount: changeAmount,
            reason: formData.get('reason')
          });
        }

        if (newThreshold !== currentThreshold) {
          await Api.put('/api/inventory/' + productId + '/threshold', {
            reorder_threshold: newThreshold
          });
        }

        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
        App.toast('Stock updated', 'success');
        this.render();
      } catch (err) {
        App.toast(err.message, 'error');
      }
    });
  },

  // --- Receive Delivery Modal ---
  async showReceiveModal() {
    document.querySelector('.modal-overlay')?.remove();

    let products = [];
    try {
      products = await Api.get('/api/products');
    } catch (err) {
      App.toast('Failed to load products', 'error');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    this._receiveProductOptions = products.map(p =>
      '<option value="' + p.id + '">' + this.esc(p.name) + ' (' + this.esc(p.unit_of_measure) + ')</option>'
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-height:95vh;">
        <div class="modal-header">
          <h3>Receive Delivery</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').classList.remove('open');setTimeout(()=>this.closest('.modal-overlay').remove(),200)">&times;</button>
        </div>
        <div class="modal-body">
          <form id="receiveForm" class="app-form">
            <div class="form-row">
              <div class="form-group">
                <label>Date Received</label>
                <input type="date" name="received_date" value="${today}">
              </div>
              <div class="form-group">
                <label>PO # (optional)</label>
                <input type="text" name="po_number" placeholder="PO-2026-001">
              </div>
            </div>

            <h4 style="color:var(--blue);margin:16px 0 8px;font-size:14px;">Items</h4>
            <div id="receiveItems"></div>
            <button type="button" class="btn btn-outline btn-sm" style="margin:8px 0 16px;" onclick="InventoryPage.addReceiveItem()">+ Add Product</button>

            <button type="submit" class="btn btn-primary btn-full">Receive All Items</button>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    this.addReceiveItem();

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
      }
    });

    document.getElementById('receiveForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const rows = document.querySelectorAll('.receive-line');
      const items = [];
      for (const row of rows) {
        const product_id = Number(row.querySelector('[name="recv_product"]').value);
        const quantity = Number(row.querySelector('[name="recv_qty"]').value);
        if (product_id && quantity > 0) {
          items.push({ product_id, quantity });
        }
      }

      if (items.length === 0) {
        App.toast('Add at least one product with quantity', 'error');
        return;
      }

      const formData = new FormData(e.target);
      const payload = {
        items,
        po_number: formData.get('po_number') || null
      };

      try {
        await Api.post('/api/inventory/receive', payload);
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
        App.toast('Received ' + items.length + ' item' + (items.length > 1 ? 's' : ''), 'success');
        this.render();
      } catch (err) {
        App.toast(err.message, 'error');
      }
    });
  },

  addReceiveItem() {
    const container = document.getElementById('receiveItems');
    const div = document.createElement('div');
    div.className = 'receive-line';
    div.style.cssText = 'display:grid;grid-template-columns:1fr 80px 32px;gap:8px;align-items:end;margin-bottom:8px;';
    div.innerHTML = `
      <div class="form-group" style="margin:0;">
        <select name="recv_product" required style="width:100%;padding:10px;border:2px solid var(--gray-200);border-radius:6px;font-size:14px;">
          <option value="">Product...</option>
          ${this._receiveProductOptions}
        </select>
      </div>
      <div class="form-group" style="margin:0;">
        <input type="number" name="recv_qty" step="any" min="0.1" required placeholder="Qty" style="width:100%;padding:10px;border:2px solid var(--gray-200);border-radius:6px;font-size:14px;">
      </div>
      <button type="button" style="background:none;border:none;color:var(--red);font-size:20px;cursor:pointer;padding:8px;" onclick="this.closest('.receive-line').remove()">&times;</button>
    `;
    container.appendChild(div);
  },

  // --- Inventory History Modal ---
  async showHistory(productId, productName, unit) {
    document.querySelector('.modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-height:90vh;">
        <div class="modal-header">
          <h3>${this.esc(productName)}</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').classList.remove('open');setTimeout(()=>this.closest('.modal-overlay').remove(),200)">&times;</button>
        </div>
        <div class="modal-body">
          <div class="loading"><div class="spinner"></div></div>
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

    try {
      const [inv, logs] = await Promise.all([
        Api.get('/api/inventory/' + productId),
        Api.get('/api/inventory/' + productId + '/log')
      ]);

      const body = overlay.querySelector('.modal-body');

      body.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:2px solid var(--gray-100);margin-bottom:12px;">
          <div>
            <div style="font-size:13px;color:var(--gray-500);">Current Stock</div>
            <div style="font-size:24px;font-weight:700;">${Number(inv.quantity).toFixed(1)} <span style="font-size:14px;font-weight:400;color:var(--gray-500);">${this.esc(unit)}</span></div>
          </div>
          <button class="btn btn-sm btn-outline" onclick="document.querySelector('.modal-overlay').classList.remove('open');setTimeout(()=>document.querySelector('.modal-overlay')?.remove(),200);InventoryPage.showAdjustModal(${productId}, '${this.esc(productName).replace(/'/g, "\\'")}', ${inv.quantity}, '${this.esc(unit).replace(/'/g, "\\'")}', ${inv.reorder_threshold || 0})">Adjust</button>
        </div>

        ${logs.length === 0 ? '<div class="empty-state"><p>No history yet</p></div>' : `
          <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">Recent changes</p>
          ${logs.map(l => {
            const sign = l.change_amount >= 0 ? '+' : '';
            const color = l.change_amount >= 0 ? 'var(--green-dark)' : 'var(--red)';
            const reasonLabel = this.formatReason(l.reason);
            const date = new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const time = new Date(l.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

            return `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100);">
                <div>
                  <div style="font-size:14px;font-weight:600;">${reasonLabel}</div>
                  <div style="font-size:12px;color:var(--gray-500);">${date} ${time}${l.user_name ? ' &middot; ' + this.esc(l.user_name) : ''}${l.application_id ? ' &middot; App #' + l.application_id : ''}</div>
                </div>
                <div style="font-size:16px;font-weight:700;color:${color};white-space:nowrap;">${sign}${Number(l.change_amount).toFixed(1)}</div>
              </div>
            `;
          }).join('')}
        `}
      `;
    } catch (err) {
      overlay.querySelector('.modal-body').innerHTML = '<div class="empty-state"><p>Error: ' + err.message + '</p></div>';
    }
  },

  formatReason(reason) {
    if (!reason) return 'Adjustment';
    const map = {
      'purchase': 'Purchased / Received',
      'received': 'Delivery Received',
      'application': 'Used in Application',
      'application_edit': 'Application Edited',
      'application_edit_reversal': 'Edit Reversal',
      'application_edit_new': 'Edit (New Product)',
      'application_sync': 'Synced Application',
      'adjustment': 'Manual Adjustment',
      'waste': 'Waste / Spillage'
    };
    if (reason.startsWith('received')) return reason.replace('received', 'Delivery Received');
    return map[reason] || reason.charAt(0).toUpperCase() + reason.slice(1);
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
