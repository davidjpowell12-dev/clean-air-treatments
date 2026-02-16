const CalculatorPage = {
  products: [],

  async render() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      this.products = await Api.get('/api/products');

      main.innerHTML = `
        <div class="page-header">
          <h2>Treatment Calculator</h2>
        </div>

        <div class="card">
          <div class="card-body">
            <form id="calcForm" class="app-form">
              <div class="form-group">
                <label>Property Size (sq ft) *</label>
                <input type="number" id="calcSqft" step="1" min="1" required placeholder="e.g. 8000">
              </div>

              <div class="form-group">
                <label>Select Product *</label>
                <select id="calcProduct" required>
                  <option value="">Choose a product...</option>
                  ${this.products.map(p => `<option value="${p.id}">${this.esc(p.name)} (${p.app_rate_low || '?'}–${p.app_rate_high || '?'} ${this.esc(p.app_rate_unit || '')})</option>`).join('')}
                </select>
              </div>

              <div class="form-group">
                <label>Application Rate</label>
                <div class="form-row">
                  <input type="number" id="calcRate" step="any" placeholder="Rate">
                  <input type="text" id="calcRateUnit" readonly placeholder="Unit">
                </div>
                <p class="form-hint" id="rateHint">Select a product to see label rates</p>
              </div>

              <div class="form-group">
                <label>Application Method</label>
                <select id="calcMethod">
                  <option value="broadcast">Broadcast (full lawn)</option>
                  <option value="spot_treat">Spot Treat</option>
                </select>
              </div>

              <div class="form-group" id="spotPctGroup" style="display:none;">
                <label>% of Lawn to Treat</label>
                <input type="number" id="spotPct" min="1" max="100" value="25" step="1">
              </div>

              <button type="submit" class="btn btn-primary btn-full">Calculate</button>
            </form>
          </div>
        </div>

        <div id="calcResults"></div>
      `;

      // Update rate when product selected
      document.getElementById('calcProduct').addEventListener('change', (e) => {
        const p = this.products.find(p => p.id === Number(e.target.value));
        if (p) {
          document.getElementById('calcRate').value = p.app_rate_high || p.app_rate_low || '';
          document.getElementById('calcRateUnit').value = p.app_rate_unit || '';
          document.getElementById('rateHint').textContent = `Label range: ${p.app_rate_low || '?'} – ${p.app_rate_high || '?'} ${p.app_rate_unit || ''}`;
        }
      });

      // Show/hide spot treat %
      document.getElementById('calcMethod').addEventListener('change', (e) => {
        document.getElementById('spotPctGroup').style.display = e.target.value === 'spot_treat' ? '' : 'none';
      });

      // Calculate
      document.getElementById('calcForm').addEventListener('submit', (e) => {
        e.preventDefault();
        this.calculate();
      });
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  calculate() {
    const sqft = Number(document.getElementById('calcSqft').value);
    const productId = Number(document.getElementById('calcProduct').value);
    const rate = Number(document.getElementById('calcRate').value);
    const method = document.getElementById('calcMethod').value;
    const spotPct = Number(document.getElementById('spotPct').value) / 100;

    const product = this.products.find(p => p.id === productId);
    if (!product || !sqft || !rate) {
      App.toast('Please fill in all required fields', 'error');
      return;
    }

    const treatedArea = method === 'spot_treat' ? sqft * spotPct : sqft;
    const rateUnit = product.app_rate_unit || '';

    // Calculate product needed
    let productNeeded = 0;
    let productUnit = product.unit_of_measure;

    if (rateUnit.includes('/1000sqft')) {
      productNeeded = (treatedArea / 1000) * rate;
    } else if (rateUnit.includes('/acre')) {
      productNeeded = (treatedArea / 43560) * rate;
    } else {
      productNeeded = (treatedArea / 1000) * rate;
    }

    // Calculate mix details for liquids
    let mixDetails = null;
    if (product.formulation === 'liquid' && product.spray_volume_gal_per_1000) {
      const totalWaterGal = (treatedArea / 1000) * product.spray_volume_gal_per_1000;
      mixDetails = {
        totalWater: totalWaterGal,
        ozPerGal: product.mix_rate_oz_per_gal,
        totalProduct: productNeeded
      };
    }

    // Cost estimate
    const costEstimate = product.cost_per_unit && product.package_size
      ? (productNeeded / product.package_size) * product.cost_per_unit
      : null;

    const results = document.getElementById('calcResults');
    results.innerHTML = `
      <div class="calc-result">
        <h4>${this.esc(product.name)}</h4>
        <div class="calc-line"><span>Treated Area</span><span>${treatedArea.toLocaleString()} sq ft</span></div>
        <div class="calc-line"><span>Application Rate</span><span>${rate} ${this.esc(rateUnit)}</span></div>
        <div class="calc-line"><span>Method</span><span>${method === 'spot_treat' ? 'Spot Treat (' + (spotPct * 100) + '%)' : 'Broadcast'}</span></div>
        <div class="calc-line highlight"><span>Product Needed</span><span>${productNeeded.toFixed(2)} ${this.esc(productUnit)}</span></div>

        ${mixDetails ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--gray-200);">
            <div class="calc-line"><span>Water Needed</span><span>${mixDetails.totalWater.toFixed(1)} gal</span></div>
            ${mixDetails.ozPerGal ? `<div class="calc-line"><span>Mix Rate</span><span>${mixDetails.ozPerGal} oz per gallon</span></div>` : ''}
          </div>
        ` : ''}

        ${costEstimate !== null ? `
          <div class="calc-line" style="margin-top:8px;"><span>Est. Cost</span><span>$${costEstimate.toFixed(2)}</span></div>
        ` : ''}

        ${product.rei_hours ? `<p style="margin-top:12px;font-size:13px;color:var(--red);"><strong>REI: ${product.rei_hours} hours</strong> — Do not enter treated area during this time.</p>` : ''}
      </div>

      <button class="btn btn-secondary btn-full" onclick="App.navigate('applications', 'new', null, {productId:${product.id}, sqft:${treatedArea}, rate:${rate}, method:'${method}', productUsed:${productNeeded.toFixed(2)}})">
        Log This Application
      </button>
    `;
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
