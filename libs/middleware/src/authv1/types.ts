/**
 * Authentication result interface for JWT authentication
 */
export interface AuthResult {
  authenticated: boolean;
  error?: string;
  user?: {
    id?: string;
    email?: string;
    roles?: string[];
    permissions?: string[];
    storeId?: string;
    anonymous?: boolean;
    metadata?: Record<string, any>;
    apiKey?: string;
    authMethod?: string;
    tokenIssued?: Date;
  };
  session?: {
    sessionId: string;
    expiresAt: Date;
    userId: string;
    metadata?: Record<string, any>;
  };
}
