const InventoryPage = {
  async render() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const inventory = await Api.get('/api/inventory');

      main.innerHTML = `
        <div class="page-header">
          <h2>Inventory</h2>
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
    let stockClass = 'stock-ok';
    let stockBadge = 'badge-green';
    let stockLabel = 'OK';

    if (i.quantity <= 0) {
      stockClass = 'stock-out';
      stockBadge = 'badge-red';
      stockLabel = 'OUT';
    } else if (i.quantity <= i.reorder_threshold) {
      stockClass = 'stock-low';
      stockBadge = 'badge-orange';
      stockLabel = 'LOW';
    }

    return `
      <div class="data-row" data-name="${this.esc(i.product_name).toLowerCase()}" data-product-id="${i.product_id}">
        <div class="data-row-main">
          <h4>${this.esc(i.product_name)}</h4>
          <p>${this.esc(i.product_type)} &middot; ${i.unit_of_measure}</p>
        </div>
        <div class="data-row-right" style="display:flex;align-items:center;gap:10px;">
          <div style="text-align:right;">
            <div class="${stockClass}" style="font-size:18px;font-weight:700;">${Number(i.quantity).toFixed(1)}</div>
            <div style="font-size:11px;color:var(--gray-500);">${this.esc(i.unit_of_measure)}</div>
          </div>
          <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();InventoryPage.showAdjustModal(${i.product_id}, '${this.esc(i.product_name)}', ${i.quantity}, '${this.esc(i.unit_of_measure)}')">Adjust</button>
        </div>
      </div>
    `;
  },

  showAdjustModal(productId, name, currentQty, unit) {
    // Remove existing modal if any
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
            <button type="submit" class="btn btn-primary btn-full">Apply Adjustment</button>
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
      const data = {
        product_id: productId,
        change_amount: Number(formData.get('change_amount')),
        reason: formData.get('reason')
      };

      try {
        await Api.post('/api/inventory/adjust', data);
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
        App.toast('Stock updated', 'success');
        this.render();
      } catch (err) {
        App.toast(err.message, 'error');
      }
    });
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
