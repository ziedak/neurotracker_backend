/**
 * Advanced Threat Detection Service
 * Provides brute force protection, account lockout, and suspicious activity detection
 * Implements comprehensive security monitoring and automated responses
 */
import { ServiceDependencies } from "../types";
export interface ThreatEvent {
    id: string;
    type: "brute_force" | "suspicious_activity" | "unusual_location" | "rapid_requests";
    severity: "low" | "medium" | "high" | "critical";
    userId?: string | undefined;
    ipAddress: string;
    userAgent?: string | undefined;
    metadata: Record<string, any>;
    timestamp: Date;
    resolved: boolean;
    actions: ThreatAction[];
}
export interface ThreatAction {
    type: "block_ip" | "lock_account" | "require_mfa" | "log_only" | "notify_admin";
    timestamp: Date;
    duration?: number;
    reason: string;
}
export interface AccountLockout {
    userId: string;
    reason: string;
    lockoutUntil: Date;
    failedAttempts: number;
    lastAttempt: Date;
    ipAddresses: string[];
}
export interface BruteForceAttempt {
    ipAddress: string;
    userId?: string;
    attempts: number;
    firstAttempt: Date;
    lastAttempt: Date;
    blocked: boolean;
    blockExpires?: Date;
}
export interface ThreatDetectionConfig {
    maxFailedAttempts: number;
    lockoutDuration: number;
    bruteForceWindow: number;
    suspiciousActivityThreshold: number;
    ipBlockDuration: number;
    enableAutoLockout: boolean;
    enableIPBlocking: boolean;
    notifyOnThreat: boolean;
}
export declare class AdvancedThreatDetectionService {
    private deps;
    private config;
    private activeLockouts;
    private bruteForceAttempts;
    private blockedIPs;
    private threatEvents;
    constructor(deps: ServiceDependencies, config?: Partial<ThreatDetectionConfig>);
    /**
     * Record failed authentication attempt
     */
    recordFailedAttempt(userId: string, ipAddress: string, userAgent?: string, metadata?: Record<string, any>): Promise<void>;
    /**
     * Record successful authentication
     */
    recordSuccessfulAuth(userId: string, ipAddress: string, userAgent?: string): Promise<void>;
    /**
     * Check if account is locked
     */
    isAccountLocked(userId: string): boolean;
    /**
     * Check if IP is blocked
     */
    isIPBlocked(ipAddress: string): boolean;
    /**
     * Get account lockout status
     */
    getAccountLockoutStatus(userId: string): AccountLockout | null;
    /**
     * Manually lock account
     */
    lockAccount(userId: string, reason: string, existingLockout?: AccountLockout): Promise<void>;
    /**
     * Manually unlock account
     */
    unlockAccount(userId: string): boolean;
    /**
     * Block IP address
     */
    blockIP(ipAddress: string, reason: string, duration?: number): Promise<void>;
    /**
     * Unblock IP address
     */
    unblockIP(ipAddress: string): boolean;
    /**
     * Get threat events
     */
    getThreatEvents(limit?: number, type?: ThreatEvent["type"], resolved?: boolean): ThreatEvent[];
    /**
     * Get active lockouts
     */
    getActiveLockouts(): AccountLockout[];
    /**
     * Get blocked IPs
     */
    getBlockedIPs(): string[];
    /**
     * Resolve threat event
     */
    resolveThreatEvent(eventId: string, resolution: string): boolean;
    /**
     * Get service statistics
     */
    getStats(): {
        activeLockouts: number;
        blockedIPs: number;
        totalThreatEvents: number;
        unresolvedThreats: number;
        recentThreats: number;
    };
    private recordBruteForceAttempt;
    private checkIPBlocking;
    private notifyThreat;
    private generateEventId;
    private cleanup;
}
/**
 * Create advanced threat detection service instance
 */
export declare function createAdvancedThreatDetectionService(deps: ServiceDependencies, config?: Partial<ThreatDetectionConfig>): AdvancedThreatDetectionService;
/**
 * Quick threat assessment
 */
export declare function assessThreatLevel(service: AdvancedThreatDetectionService): {
    threatLevel: "low" | "medium" | "high" | "critical";
    recommendations: string[];
};
export default AdvancedThreatDetectionService;
//# sourceMappingURL=advanced-threat-detection-service.d.ts.map