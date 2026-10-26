const router = require('express').Router();
const { all } = require('../db');
const { allow } = require('../auth');

router.get('/logs', allow(), (req, res) => {
  const rows = all(
    `SELECT l.*, u.name AS user_name, u.role FROM activity_logs l LEFT JOIN users u ON u.id=l.user_id
      ORDER BY l.id DESC LIMIT 300`
  );
  res.render('logs', { title: 'Log Aktivitas', rows });
});

module.exports = router;
