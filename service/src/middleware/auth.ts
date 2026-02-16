/**
 * ─────────────────────────────────────────────────────────
 * Authentication & Authorization Middleware
 *
 * When AUTH_ENABLED=true: validates JWT tokens from Entra ID (Azure AD).
 * When AUTH_ENABLED=false: uses a default dev user context.
 *
 * Extracts UserContext and attaches to req.user.
 * ─────────────────────────────────────────────────────────
 */

import { Request, Response, NextFunction } from "express";
import { UserContext, Role } from "../types";
import { getConfig } from "../config";
import { createLogger } from "./logger";

const logger = createLogger("auth");

// Extend Express Request to include user context
declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
    }
  }
}

/**
 * Default dev user (used when AUTH_ENABLED=false).
 * Has admin+provisioner roles for convenient local development.
 */
const DEV_USER: UserContext = {
  user_id: "dev-user-001",
  email: "developer@deloitte.com",
  roles: ["admin", "provisioner"],
  team_ids: ["team-cpg", "team-automotive"],
  display_name: "Dev User (local)",
};

/**
 * Authentication middleware.
 * If auth is disabled, attaches a default dev user.
 * If auth is enabled, validates the JWT bearer token.
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const config = getConfig();

  if (!config.authEnabled) {
    // Dev mode: use default user
    req.user = DEV_USER;
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid Authorization header. Expected: Bearer <token>",
      },
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = decodeAndValidateToken(token, config);
    req.user = decoded;
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token validation failed";
    logger.error("Token validation failed", { error: message });
    res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or expired token",
      },
    });
  }
}

/**
 * Role-based authorization middleware factory.
 * Use after authMiddleware to require specific roles.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      });
      return;
    }

    const hasRole = roles.some((r) => req.user?.roles.includes(r));
    if (!hasRole) {
      logger.warn("Access denied", {
        user: req.user.email,
        required_roles: roles,
        user_roles: req.user.roles,
      });
      res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: `Requires one of roles: [${roles.join(", ")}]`,
        },
      });
      return;
    }

    next();
  };
}

/**
 * Token validation.
 *
 * IMPORTANT: This is a STUB implementation that must be replaced before
 * deploying with AUTH_ENABLED=true in any non-development environment.
 *
 * To implement real JWT validation:
 *  1. npm install jsonwebtoken jwks-rsa
 *  2. Use jwks-rsa to fetch Entra ID signing keys from config.authJwksUri
 *  3. Use jsonwebtoken.verify() with the key, config.authIssuer, config.authAudience
 *  4. Map claims to UserContext
 *
 * Expected JWT claims (from Entra ID):
 *  - sub: user ID
 *  - preferred_username: email
 *  - roles: array of app roles
 *  - groups: array of group IDs (mapped to team_ids)
 */
function decodeAndValidateToken(token: string, config: { nodeEnv: string; authIssuer: string; authJwksUri: string }): UserContext {
  // SAFETY: Block stub usage in production
  if (config.nodeEnv === "production") {
    // In production, you MUST replace this stub with real JWT validation.
    // Failing hard here prevents accidentally running without auth.
    if (!config.authIssuer || !config.authJwksUri) {
      throw new Error(
        "AUTH_ENABLED=true in production but AUTH_ISSUER/AUTH_JWKS_URI are not configured. " +
        "Cannot validate tokens. Deploy with real OIDC configuration."
      );
    }

    // TODO: Replace this block with real JWT validation:
    // const jwksClient = jwksRsa({ jwksUri: config.authJwksUri });
    // const decoded = jwt.verify(token, getKey, { issuer: config.authIssuer, audience: config.authAudience });
    // return mapClaimsToUserContext(decoded);
    throw new Error(
      "JWT validation stub is active. Replace decodeAndValidateToken() with real " +
      "jsonwebtoken + jwks-rsa implementation before deploying to production."
    );
  }

  // Non-production: warn but allow (for staging/testing with auth enabled)
  logger.warn(
    "Using TOKEN STUB for authentication. This is NOT secure. " +
    "Replace with real JWT validation before deploying to any shared environment."
  );

  void token;
  return {
    user_id: "jwt-user-001",
    email: "authenticated@deloitte.com",
    roles: ["provisioner"],
    team_ids: ["team-cpg"],
    display_name: "JWT Stub User",
  };
}
