const defaultOrigins = [
    'https://grupo.in',
    'https://www.grupo.in',
    'http://localhost:3000'
  ];
  
  const allowedOrigins = (() => {
    const fromEnv = (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);
    return fromEnv.length > 0 ? fromEnv : defaultOrigins;
  })();
  
  const corsOptions = {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      console.warn(`[CORS] Blocked: ${origin}`);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Authorization']
  };
  
  module.exports = { corsOptions, allowedOrigins };