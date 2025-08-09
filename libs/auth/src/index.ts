// Enhanced JWT Service: Proper token generation, verification, and refresh capabilities
// Flexible Guards: Works with any framework that provides headers and set objects
// Password Security: Industry-standard password hashing and validation
// Role-Based Access: Support for roles and granular permissions
// Refresh Tokens: Secure token refresh mechanism

// JWT Service
// const jwtService = JWTService.getInstance();
// const tokens = await jwtService.generateTokens({
//   sub: 'user123',
//   email: 'user@example.com',
//   role: 'customer',
//   permissions: ['read:profile']
// });

//  Password Service
// const hashedPassword = await PasswordService.hash('plaintext');
// const isValid = await PasswordService.verify('plaintext', hashedPassword);

//  Guards
// const payload = await requireAuth(context);
// const adminPayload = await requireRole(context, 'admin');

export {
  JWTService,
  createJWTPlugin,
  createRefreshJWTPlugin,
  jwtConfig,
  refreshTokenConfig,
} from "./jwt";
export type { JWTPayload, RefreshTokenPayload } from "./jwt";
export {
  AuthGuard,
  authGuard,
  requireAuth,
  requireRole,
  requirePermission,
  optionalAuth,
} from "./guards";
export type { AuthContext } from "./guards";
export { PasswordService } from "./password";
