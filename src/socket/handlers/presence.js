const onlineCounts = new Map();

const onConnect = (socket) => {
  const { userId } = socket.user;
  const prev = onlineCounts.get(userId) || 0;
  onlineCounts.set(userId, prev + 1);
  socket.emit('presence', { userId, online: true });
};

const onDisconnect = (socket) => {
  const { userId } = socket.user;
  const current = onlineCounts.get(userId) || 0;
  if (current <= 1) {
    onlineCounts.delete(userId);
    socket.emit('presence', { userId, online: false });
  } else {
    onlineCounts.set(userId, current - 1);
  }
};

module.exports = { onConnect, onDisconnect };