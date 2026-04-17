// middleware/security.js
// Rate limiting, CORS, and security middleware

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

/**
 * Rate limiter for chat endpoints
 */
const chatRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX) || 30,
  message: {
    success: false,
    error: 'Bahut messages aa rahe hain. Please thodi der baad try karo. 🙏'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Per-IP limiting
  keyGenerator: (req) => {
    return req.ip || req.headers['x-forwarded-for'] || 'unknown';
  }
});

/**
 * Stricter rate limit for session creation
 */
const sessionRateLimit = rateLimit({
  windowMs: 300000, // 5 minutes
  max: 10,
  message: {
    success: false,
    error: 'Too many sessions. Please try again later.'
  }
});

/**
 * CORS configuration
 */
function getCorsOptions() {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  
  // In development, allow all
  if (process.env.NODE_ENV !== 'production') {
    return {
      origin: '*',
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization']
    };
  }
  
  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    credentials: false
  };
}

/**
 * Security headers (helmet config for chat API)
 */
const securityHeaders = helmet({
  contentSecurityPolicy: false, // Disable for API
  crossOriginEmbedderPolicy: false
});

/**
 * Request logger middleware
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const log = `[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`;
    console.log(log);
  });
  next();
}

/**
 * Input sanitization
 */
function sanitizeInput(req, res, next) {
  if (req.body && req.body.message) {
    // Remove any HTML/script injection attempts
    req.body.message = req.body.message
      .replace(/<[^>]*>/g, '') // Strip HTML tags
      .replace(/javascript:/gi, '') // Remove JS protocol
      .substring(0, 500); // Hard length limit
  }
  next();
}

module.exports = {
  chatRateLimit,
  sessionRateLimit,
  getCorsOptions,
  securityHeaders,
  requestLogger,
  sanitizeInput
};
