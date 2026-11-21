// ============================================================================
// VIN-15: Rate Limiting Middleware (express-rate-limit)
// ============================================================================
// Provides two rate limiters:
//   - standardLimiter: 100 requests per minute per IP (general API endpoints)
//   - authLimiter: 10 requests per 15 minutes per IP (login brute-force protection)
// ============================================================================

import rateLimit from "express-rate-limit";

/**
 * Standard API rate limiter.
 * Enforces 100 requests per minute per IP address across all general API routes.
 */
export const standardLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many requests",
    message: "Rate limit exceeded. Maximum 100 requests per minute. Please try again later.",
  },
});

/**
 * Authentication endpoint rate limiter.
 * Enforces 10 requests per 15 minutes per IP address on login endpoints
 * to prevent credential brute-force attacks.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many login attempts",
    message: "Rate limit exceeded. Maximum 10 login attempts per 15 minutes. Please try again later.",
  },
});
