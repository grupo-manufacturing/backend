const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { shipOrder, confirmDelivery, getReadyToShip } = require('../controllers/orderController');

const router = express.Router();

router.get('/ready-to-ship', authenticateToken, getReadyToShip);
router.post('/ship/:responseId', authenticateToken, shipOrder);
router.post('/confirm-delivery/:responseId', authenticateToken, confirmDelivery);

module.exports = router;