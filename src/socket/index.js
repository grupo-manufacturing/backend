const { Server } = require('socket.io');
const socketAuth = require('../middleware/wsAuth');
const { onConnect, onDisconnect } = require('./handlers/presence');
const { onMessageSend, onMessageRead } = require('./handlers/message');

const initSocket = (httpServer, allowedOrigins) => {
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
    path: process.env.WS_PATH || '/socket.io'
  });

  io.use(socketAuth);

  io.on('connection', async (socket) => {
    try {
      const { userId } = socket.user;
      socket.join(`user:${userId}`);

      onConnect(socket);

      socket.on('message:send', onMessageSend(io).bind(null, socket));
      socket.on('message:read', onMessageRead(io).bind(null, socket));
      socket.on('disconnect', () => onDisconnect(socket));
    } catch (err) {
      console.error('Socket connection error:', err);
      socket.disconnect(true);
    }
  });

  return io;
};

module.exports = { initSocket };