const router = require('express').Router();
const dashboard = require('../services/dashboard');
const { STATUS_LABEL } = require('../services/inventory');
const { today } = require('../util');

router.get('/', async (req, res) => {
  res.render('dashboard', { title: 'Dashboard', d: await dashboard.build(today()), STATUS_LABEL });
});

module.exports = router;
