/**
 * JWT Service Types and Interfaces
 * Basic JWT types for compatibility with existing services
 */

export interface JWTPayload {
  sub: string;
  email?: string;
  role?: string;
  permissions?: string[];
  iat?: number;
  exp?: number;
  jti?: string;
  iss?: string;
  aud?: string | string[];
  [key: string]: any;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenId?: string; // Made optional
  type: "refresh";
  iat?: number;
  exp?: number;
  jti?: string;
}
