/**
 * Session Management Service
 * Handles user session lifecycle, device tracking, and session security
 * Provides comprehensive session management with Redis storage
 */
import { Session, DeviceInfo, AuthConfig, ServiceDependencies } from "../types";
export declare class SessionService {
    private config;
    private deps;
    constructor(config: AuthConfig, deps: ServiceDependencies);
    /**
     * Create a new session for user
     */
    createSession(userId: string, deviceInfo?: DeviceInfo, ipAddress?: string, userAgent?: string): Promise<Session>;
    /**
     * Get session by ID
     */
    getSession(sessionId: string): Promise<Session | null>;
    /**
     * Update session activity
     */
    updateSessionActivity(sessionId: string): Promise<boolean>;
    /**
     * Delete session
     */
    deleteSession(sessionId: string): Promise<boolean>;
    /**
     * Delete all sessions for user
     */
    deleteUserSessions(userId: string): Promise<boolean>;
    /**
     * Get all active sessions for user
     */
    getUserSessions(userId: string): Promise<Session[]>;
    /**
     * Validate session and return user ID
     */
    validateSession(sessionId: string): Promise<string | null>;
    /**
     * Clean up expired sessions
     */
    cleanupExpiredSessions(): Promise<number>;
    /**
     * Get session statistics
     */
    getSessionStats(): Promise<{
        total: number;
        active: number;
        expired: number;
    }>;
    private storeSession;
}
/**
 * Create session service instance
 */
export declare function createSessionService(config: AuthConfig, deps: ServiceDependencies): SessionService;
/**
 * Parse device info from user agent
 */
export declare function parseDeviceInfo(userAgent?: string): DeviceInfo | undefined;
export default SessionService;
//# sourceMappingURL=session-service.d.ts.map