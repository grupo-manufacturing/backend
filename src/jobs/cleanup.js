const authService = require('../services/authService');

const INTERVAL_MS = 5 * 60 * 1000;

const startCleanupJob = () => {
  setInterval(async () => {
    try {
      await authService.cleanupExpiredData();
    } catch (err) {
      console.error('Scheduled cleanup failed:', err);
    }
  }, INTERVAL_MS);
};

module.exports = { startCleanupJob };