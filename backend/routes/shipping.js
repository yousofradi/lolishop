const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Shipping = require('../models/Shipping');
const adminAuth = require('../middleware/adminAuth');

const redis = require('../utils/redis');
const SHIPPING_CACHE_KEY = 'storefront:shipping:list';

async function refreshShippingCache() {
  try {
    const fees = await Shipping.find({}, 'city cityOtherName fee');
    
    // Resolve active fees dynamically from shipping_options setting
    const Setting = require('../models/Setting');
    const shippingOptionsRecord = await Setting.findOne({ key: 'shipping_options' });
    const shippingOptions = shippingOptionsRecord ? shippingOptionsRecord.value : [];
    const postOption = (shippingOptions && shippingOptions.length > 0)
      ? (shippingOptions.find(o => o.active !== false) || shippingOptions[0])
      : null;

    const isCityEqual = (a, b) => {
      if (!a || !b) return false;
      const norm = (s) => String(s).replace(/[أإآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '').toLowerCase().trim();
      return norm(a) === norm(b);
    };

    const finalFees = fees.map(record => {
      const cityObj = postOption ? (postOption.cities || []).find(c => 
        isCityEqual(c.city, record.city) || isCityEqual(c.city, record.cityOtherName)
      ) : null;
      
      const resolvedFee = cityObj ? Number(cityObj.fee) : record.fee;
      
      return {
        _id: record._id,
        city: record.city,
        cityOtherName: record.cityOtherName,
        fee: isNaN(resolvedFee) ? record.fee : resolvedFee
      };
    });

    shippingOptions.forEach(opt => {
      if (opt && opt.cities) {
        opt.cities.forEach(c => {
          const exists = finalFees.find(f => isCityEqual(f.city, c.city) || isCityEqual(f.cityOtherName, c.city));
          if (!exists) {
            finalFees.push({
              _id: new mongoose.Types.ObjectId(),
              city: c.city,
              cityOtherName: '',
              fee: Number(c.fee) || opt.cost || 0
            });
          }
        });
      }
    });

    await redis.set(SHIPPING_CACHE_KEY, JSON.stringify(finalFees));
  } catch (err) {
    console.error('[Redis] Shipping cache refresh failed:', err.message);
  }
}

// GET /api/shipping — return all governorates
router.get('/', async (req, res) => {
  try {
    // 1. Try Cache
    try {
      const cached = await redis.get(SHIPPING_CACHE_KEY);
      if (cached) {
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
        return res.json(JSON.parse(cached));
      }
    } catch (err) {
      console.error('[Redis] Shipping cache get failed:', err.message);
    }

    // 2. Fetch from DB
    const fees = await Shipping.find({}, 'city cityOtherName fee');

    // 3. Resolve active fees dynamically from shipping_options setting
    const Setting = require('../models/Setting');
    const shippingOptionsRecord = await Setting.findOne({ key: 'shipping_options' });
    const shippingOptions = shippingOptionsRecord ? shippingOptionsRecord.value : [];
    const postOption = (shippingOptions && shippingOptions.length > 0)
      ? (shippingOptions.find(o => o.active !== false) || shippingOptions[0])
      : null;

    const isCityEqual = (a, b) => {
      if (!a || !b) return false;
      const norm = (s) => String(s).replace(/[أإآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '').toLowerCase().trim();
      return norm(a) === norm(b);
    };

    const finalFees = fees.map(record => {
      const cityObj = postOption ? (postOption.cities || []).find(c => 
        isCityEqual(c.city, record.city) || isCityEqual(c.city, record.cityOtherName)
      ) : null;
      
      const resolvedFee = cityObj ? Number(cityObj.fee) : record.fee;
      
      return {
        _id: record._id,
        city: record.city,
        cityOtherName: record.cityOtherName,
        fee: isNaN(resolvedFee) ? record.fee : resolvedFee
      };
    });

    shippingOptions.forEach(opt => {
      if (opt && opt.cities) {
        opt.cities.forEach(c => {
          const exists = finalFees.find(f => isCityEqual(f.city, c.city) || isCityEqual(f.cityOtherName, c.city));
          if (!exists) {
            finalFees.push({
              _id: new mongoose.Types.ObjectId(),
              city: c.city,
              cityOtherName: '',
              fee: Number(c.fee) || opt.cost || 0
            });
          }
        });
      }
    });
    
    // 4. Set Cache (24 hour TTL for persistent feel)
    try {
      await redis.set(SHIPPING_CACHE_KEY, JSON.stringify(finalFees));
    } catch (err) {
      console.error('[Redis] Shipping cache set failed:', err.message);
    }

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    res.json(finalFees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/shipping/egyptpost — return all Egypt Post governorates & fees
router.get('/egyptpost', async (req, res) => {
  try {
    const Setting = require('../models/Setting');
    const Shipping = require('../models/Shipping');
    
    // 1. Fetch governorates from DB
    const fees = await Shipping.find({}, 'city cityOtherName fee');

    // 2. Resolve Egypt Post options
    const shippingOptionsRecord = await Setting.findOne({ key: 'shipping_options' });
    const shippingOptions = shippingOptionsRecord ? shippingOptionsRecord.value : [];
    const postOption = (shippingOptions && shippingOptions.length > 0)
      ? (shippingOptions.find(o => o.active !== false) || shippingOptions[0])
      : null;

    const isCityEqual = (a, b) => {
      if (!a || !b) return false;
      const norm = (s) => String(s).replace(/[أإآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '').toLowerCase().trim();
      return norm(a) === norm(b);
    };

    const egyptPostFees = fees.map(record => {
      const cityObj = postOption ? (postOption.cities || []).find(c => 
        isCityEqual(c.city, record.city) || isCityEqual(c.city, record.cityOtherName)
      ) : null;
      
      const resolvedFee = cityObj ? Number(cityObj.fee) : (postOption ? postOption.cost : 80);
      
      return {
        _id: record._id,
        city: record.city,
        cityOtherName: record.cityOtherName,
        fee: isNaN(resolvedFee) ? 80 : resolvedFee
      };
    });

    if (postOption && postOption.cities) {
      postOption.cities.forEach(c => {
        const exists = egyptPostFees.find(f => isCityEqual(f.city, c.city) || isCityEqual(f.cityOtherName, c.city));
        if (!exists) {
          egyptPostFees.push({
            _id: new mongoose.Types.ObjectId(),
            city: c.city,
            cityOtherName: '',
            fee: Number(c.fee) || postOption.cost || 80
          });
        }
      });
    }

    res.json(egyptPostFees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/shipping/zones/:cityId — return empty zones
router.get('/zones/:cityId', (req, res) => {
  res.json([]);
});

// Admin: Get raw DB objects
router.get('/list', adminAuth, async (req, res) => {
  try {
    const fees = await Shipping.find().sort({ city: 1 });
    res.json(fees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Update fee
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const { city, cityOtherName, bostaCityId, fee } = req.body;
    const updateData = {};
    if (city !== undefined) updateData.city = city;
    if (cityOtherName !== undefined) updateData.cityOtherName = cityOtherName;
    if (bostaCityId !== undefined) updateData.bostaCityId = bostaCityId;
    if (fee !== undefined) updateData.fee = fee;

    const shipping = await Shipping.findByIdAndUpdate(req.params.id, updateData, { new: true });
    
    // Write-Through: Refresh the list cache
    await refreshShippingCache();
    
    res.json(shipping);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Add new city
router.post('/', adminAuth, async (req, res) => {
  try {
    const shipping = new Shipping(req.body);
    await shipping.save();
    
    // Write-Through: Refresh the list cache
    await refreshShippingCache();
    
    res.json(shipping);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Delete city
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await Shipping.findByIdAndDelete(req.params.id);
    
    // Write-Through: Refresh the list cache
    await refreshShippingCache();
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Bulk update all to a single fee
router.post('/bulk-update', adminAuth, async (req, res) => {
  try {
    const { fee } = req.body;
    if (fee == null || isNaN(fee)) return res.status(400).json({ error: 'Valid fee is required' });

    await Shipping.updateMany({}, { $set: { fee } });
    
    // Write-Through: Refresh the list cache
    await refreshShippingCache();
    
    res.json({ success: true, message: 'All shipping fees updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
