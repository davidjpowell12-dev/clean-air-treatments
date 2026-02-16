const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Get products with rate data for calculator
router.get('/products', requireAuth, (req, res) => {
  const db = getDb();
  const products = db.prepare(`
    SELECT id, name, product_type, formulation, unit_of_measure,
           app_rate_low, app_rate_high, app_rate_unit,
           mix_rate_oz_per_gal, spray_volume_gal_per_1000,
           package_size, cost_per_unit, rei_hours
    FROM products
    ORDER BY name
  `).all();
  res.json(products);
});

// Calculate treatment amounts
router.post('/calculate', requireAuth, (req, res) => {
  const { product_id, sqft, rate, method, spot_pct } = req.body;

  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const treatedArea = method === 'spot_treat' ? sqft * (spot_pct / 100) : sqft;
  const rateUnit = product.app_rate_unit || '';

  let productNeeded = 0;
  if (rateUnit.includes('/1000sqft')) {
    productNeeded = (treatedArea / 1000) * rate;
  } else if (rateUnit.includes('/acre')) {
    productNeeded = (treatedArea / 43560) * rate;
  } else {
    productNeeded = (treatedArea / 1000) * rate;
  }

  let mixDetails = null;
  if (product.formulation === 'liquid' && product.spray_volume_gal_per_1000) {
    const totalWater = (treatedArea / 1000) * product.spray_volume_gal_per_1000;
    mixDetails = {
      total_water_gal: Math.round(totalWater * 10) / 10,
      oz_per_gal: product.mix_rate_oz_per_gal
    };
  }

  const costEstimate = product.cost_per_unit && product.package_size
    ? (productNeeded / product.package_size) * product.cost_per_unit
    : null;

  res.json({
    product_name: product.name,
    treated_area_sqft: treatedArea,
    rate_applied: rate,
    rate_unit: rateUnit,
    product_needed: Math.round(productNeeded * 100) / 100,
    product_unit: product.unit_of_measure,
    mix_details: mixDetails,
    cost_estimate: costEstimate ? Math.round(costEstimate * 100) / 100 : null,
    rei_hours: product.rei_hours
  });
});

module.exports = router;
