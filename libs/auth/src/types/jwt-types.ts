/**
 * JWT Service Types and Interfaces
 * Basic JWT types for compatibility with existing services
 */

export interface JWTPayload {
  sub: string;
  email?: string | undefined;
  role?: string | undefined;
  permissions?: string[] | undefined;
  iat?: number | undefined;
  exp?: number | undefined;
  jti?: string | undefined;
  iss?: string | undefined;
  aud?: string | string[] | undefined;
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
