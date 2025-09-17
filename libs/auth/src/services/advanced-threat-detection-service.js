/**
 * Advanced Threat Detection Service
 * Provides brute force protection, account lockout, and suspicious activity detection
 * Implements comprehensive security monitoring and automated responses
 */
// ===================================================================
// ADVANCED THREAT DETECTION SERVICE
// ===================================================================
export class AdvancedThreatDetectionService {
    deps;
    config;
    activeLockouts = new Map();
    bruteForceAttempts = new Map();
    blockedIPs = new Set();
    threatEvents = [];
    constructor(deps, config) {
        this.deps = deps;
        this.config = {
            maxFailedAttempts: 5,
            lockoutDuration: 15, // 15 minutes
            bruteForceWindow: 10, // 10 minutes
            suspiciousActivityThreshold: 10,
            ipBlockDuration: 60, // 1 hour
            enableAutoLockout: true,
            enableIPBlocking: true,
            notifyOnThreat: true,
            ...config,
        };
        // Start cleanup timer
        setInterval(() => this.cleanup(), 60000); // Clean up every minute
    }
    /**
     * Record failed authentication attempt
     */
    async recordFailedAttempt(userId, ipAddress, userAgent, metadata) {
        const now = new Date();
        // Record brute force attempt
        await this.recordBruteForceAttempt(ipAddress, userId, now);
        // Check for account lockout
        const lockout = this.activeLockouts.get(userId);
        if (lockout) {
            if (now < lockout.lockoutUntil) {
                // Account is already locked
                this.deps.monitoring.logger.warn("Failed login attempt on locked account", {
                    userId,
                    ipAddress,
                    lockoutUntil: lockout.lockoutUntil,
                });
                return;
            }
            else {
                // Lockout expired, remove it
                this.activeLockouts.delete(userId);
            }
        }
        // Update or create lockout record
        const existingLockout = this.activeLockouts.get(userId);
        if (existingLockout) {
            existingLockout.failedAttempts++;
            existingLockout.lastAttempt = now;
            existingLockout.ipAddresses.push(ipAddress);
            // Check if should lock account
            if (this.config.enableAutoLockout &&
                existingLockout.failedAttempts >= this.config.maxFailedAttempts) {
                await this.lockAccount(userId, "Too many failed attempts", existingLockout);
            }
        }
        else {
            this.activeLockouts.set(userId, {
                userId,
                reason: "Failed authentication attempts",
                lockoutUntil: new Date(now.getTime() + this.config.lockoutDuration * 60000),
                failedAttempts: 1,
                lastAttempt: now,
                ipAddresses: [ipAddress],
            });
        }
        // Create threat event
        const threatEvent = {
            id: this.generateEventId(),
            type: "brute_force",
            severity: "medium",
            userId,
            ipAddress,
            userAgent,
            metadata: {
                attemptCount: existingLockout ? existingLockout.failedAttempts + 1 : 1,
                ...metadata,
            },
            timestamp: now,
            resolved: false,
            actions: [],
        };
        this.threatEvents.push(threatEvent);
        // Log the event
        this.deps.monitoring.logger.warn("Failed authentication attempt", {
            userId,
            ipAddress,
            userAgent,
            attemptCount: threatEvent.metadata["attemptCount"],
        });
        // Check for IP blocking
        await this.checkIPBlocking(ipAddress, userId);
    }
    /**
     * Record successful authentication
     */
    async recordSuccessfulAuth(userId, ipAddress, userAgent) {
        // Clear failed attempts for user
        this.activeLockouts.delete(userId);
        // Clear brute force attempts for IP
        this.bruteForceAttempts.delete(ipAddress);
        // Clear any IP blocks for this IP
        this.blockedIPs.delete(ipAddress);
        this.deps.monitoring.logger.info("Successful authentication", {
            userId,
            ipAddress,
            userAgent,
        });
    }
    /**
     * Check if account is locked
     */
    isAccountLocked(userId) {
        const lockout = this.activeLockouts.get(userId);
        if (!lockout)
            return false;
        const now = new Date();
        if (now >= lockout.lockoutUntil) {
            // Lockout expired
            this.activeLockouts.delete(userId);
            return false;
        }
        return true;
    }
    /**
     * Check if IP is blocked
     */
    isIPBlocked(ipAddress) {
        return this.blockedIPs.has(ipAddress);
    }
    /**
     * Get account lockout status
     */
    getAccountLockoutStatus(userId) {
        const lockout = this.activeLockouts.get(userId);
        if (!lockout)
            return null;
        const now = new Date();
        if (now >= lockout.lockoutUntil) {
            this.activeLockouts.delete(userId);
            return null;
        }
        return lockout;
    }
    /**
     * Manually lock account
     */
    async lockAccount(userId, reason, existingLockout) {
        const now = new Date();
        const lockoutUntil = new Date(now.getTime() + this.config.lockoutDuration * 60000);
        const lockout = {
            userId,
            reason,
            lockoutUntil,
            failedAttempts: existingLockout?.failedAttempts || 0,
            lastAttempt: existingLockout?.lastAttempt || now,
            ipAddresses: existingLockout?.ipAddresses || [],
        };
        this.activeLockouts.set(userId, lockout);
        // Create threat event
        const threatEvent = {
            id: this.generateEventId(),
            type: "brute_force",
            severity: "high",
            userId,
            ipAddress: lockout.ipAddresses[0] || "unknown",
            metadata: {
                lockoutReason: reason,
                failedAttempts: lockout.failedAttempts,
                lockoutDuration: this.config.lockoutDuration,
            },
            timestamp: now,
            resolved: false,
            actions: [
                {
                    type: "lock_account",
                    timestamp: now,
                    duration: this.config.lockoutDuration,
                    reason,
                },
            ],
        };
        this.threatEvents.push(threatEvent);
        this.deps.monitoring.logger.warn("Account locked due to security threat", {
            userId,
            reason,
            lockoutUntil,
            failedAttempts: lockout.failedAttempts,
        });
        // Notify if enabled
        if (this.config.notifyOnThreat) {
            await this.notifyThreat(threatEvent);
        }
    }
    /**
     * Manually unlock account
     */
    unlockAccount(userId) {
        const wasLocked = this.activeLockouts.has(userId);
        this.activeLockouts.delete(userId);
        if (wasLocked) {
            this.deps.monitoring.logger.info("Account manually unlocked", { userId });
        }
        return wasLocked;
    }
    /**
     * Block IP address
     */
    async blockIP(ipAddress, reason, duration) {
        if (!this.config.enableIPBlocking)
            return;
        this.blockedIPs.add(ipAddress);
        const blockDuration = duration || this.config.ipBlockDuration;
        // Set expiry timer
        setTimeout(() => {
            this.blockedIPs.delete(ipAddress);
        }, blockDuration * 60000);
        // Create threat event
        const threatEvent = {
            id: this.generateEventId(),
            type: "brute_force",
            severity: "high",
            ipAddress,
            metadata: {
                blockReason: reason,
                blockDuration,
            },
            timestamp: new Date(),
            resolved: false,
            actions: [
                {
                    type: "block_ip",
                    timestamp: new Date(),
                    duration: blockDuration,
                    reason,
                },
            ],
        };
        this.threatEvents.push(threatEvent);
        this.deps.monitoring.logger.warn("IP address blocked", {
            ipAddress,
            reason,
            blockDuration,
        });
        // Notify if enabled
        if (this.config.notifyOnThreat) {
            await this.notifyThreat(threatEvent);
        }
    }
    /**
     * Unblock IP address
     */
    unblockIP(ipAddress) {
        const wasBlocked = this.blockedIPs.has(ipAddress);
        this.blockedIPs.delete(ipAddress);
        if (wasBlocked) {
            this.deps.monitoring.logger.info("IP address manually unblocked", {
                ipAddress,
            });
        }
        return wasBlocked;
    }
    /**
     * Get threat events
     */
    getThreatEvents(limit = 100, type, resolved) {
        let events = [...this.threatEvents];
        if (type) {
            events = events.filter((event) => event.type === type);
        }
        if (resolved !== undefined) {
            events = events.filter((event) => event.resolved === resolved);
        }
        return events.slice(-limit);
    }
    /**
     * Get active lockouts
     */
    getActiveLockouts() {
        const now = new Date();
        return Array.from(this.activeLockouts.values()).filter((lockout) => now < lockout.lockoutUntil);
    }
    /**
     * Get blocked IPs
     */
    getBlockedIPs() {
        return Array.from(this.blockedIPs);
    }
    /**
     * Resolve threat event
     */
    resolveThreatEvent(eventId, resolution) {
        const event = this.threatEvents.find((e) => e.id === eventId);
        if (event) {
            event.resolved = true;
            event.metadata["resolution"] = resolution;
            event.metadata["resolvedAt"] = new Date();
            this.deps.monitoring.logger.info("Threat event resolved", {
                eventId,
                type: event.type,
                resolution,
            });
            return true;
        }
        return false;
    }
    /**
     * Get service statistics
     */
    getStats() {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 3600000);
        return {
            activeLockouts: this.getActiveLockouts().length,
            blockedIPs: this.blockedIPs.size,
            totalThreatEvents: this.threatEvents.length,
            unresolvedThreats: this.threatEvents.filter((e) => !e.resolved).length,
            recentThreats: this.threatEvents.filter((e) => e.timestamp > oneHourAgo)
                .length,
        };
    }
    // ===================================================================
    // PRIVATE METHODS
    // ===================================================================
    async recordBruteForceAttempt(ipAddress, userId, timestamp) {
        const key = `${ipAddress}:${userId}`;
        const existing = this.bruteForceAttempts.get(key);
        if (existing) {
            existing.attempts++;
            existing.lastAttempt = timestamp;
            // Check if should block IP
            if (this.config.enableIPBlocking &&
                existing.attempts >= this.config.maxFailedAttempts * 2) {
                await this.blockIP(ipAddress, "Excessive brute force attempts");
                existing.blocked = true;
                existing.blockExpires = new Date(timestamp.getTime() + this.config.ipBlockDuration * 60000);
            }
        }
        else {
            this.bruteForceAttempts.set(key, {
                ipAddress,
                userId,
                attempts: 1,
                firstAttempt: timestamp,
                lastAttempt: timestamp,
                blocked: false,
            });
        }
    }
    async checkIPBlocking(ipAddress, userId) {
        if (!this.config.enableIPBlocking)
            return;
        const now = new Date();
        const windowStart = new Date(now.getTime() - this.config.bruteForceWindow * 60000);
        // Count recent attempts from this IP
        let recentAttempts = 0;
        for (const [key, attempt] of this.bruteForceAttempts.entries()) {
            if (key.startsWith(`${ipAddress}:`) &&
                attempt.lastAttempt > windowStart) {
                recentAttempts += attempt.attempts;
            }
        }
        if (recentAttempts >= this.config.suspiciousActivityThreshold) {
            await this.blockIP(ipAddress, "Suspicious activity threshold exceeded");
            // Create threat event
            const threatEvent = {
                id: this.generateEventId(),
                type: "suspicious_activity",
                severity: "high",
                userId,
                ipAddress,
                metadata: {
                    recentAttempts,
                    threshold: this.config.suspiciousActivityThreshold,
                    windowMinutes: this.config.bruteForceWindow,
                },
                timestamp: now,
                resolved: false,
                actions: [
                    {
                        type: "block_ip",
                        timestamp: now,
                        duration: this.config.ipBlockDuration,
                        reason: "Suspicious activity threshold exceeded",
                    },
                ],
            };
            this.threatEvents.push(threatEvent);
            if (this.config.notifyOnThreat) {
                await this.notifyThreat(threatEvent);
            }
        }
    }
    async notifyThreat(event) {
        // In a real implementation, this would send notifications via email, Slack, etc.
        this.deps.monitoring.logger.error("THREAT DETECTED", {
            eventId: event.id,
            type: event.type,
            severity: event.severity,
            userId: event.userId,
            ipAddress: event.ipAddress,
            metadata: event.metadata,
        });
    }
    generateEventId() {
        return `threat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    cleanup() {
        const now = new Date();
        // Clean up expired lockouts
        for (const [userId, lockout] of this.activeLockouts.entries()) {
            if (now >= lockout.lockoutUntil) {
                this.activeLockouts.delete(userId);
            }
        }
        // Clean up old threat events (keep last 1000)
        if (this.threatEvents.length > 1000) {
            this.threatEvents = this.threatEvents.slice(-1000);
        }
        // Clean up old brute force attempts
        for (const [key, attempt] of this.bruteForceAttempts.entries()) {
            const timeSinceLastAttempt = now.getTime() - attempt.lastAttempt.getTime();
            if (timeSinceLastAttempt > this.config.bruteForceWindow * 60000) {
                this.bruteForceAttempts.delete(key);
            }
        }
    }
}
// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================
/**
 * Create advanced threat detection service instance
 */
export function createAdvancedThreatDetectionService(deps, config) {
    return new AdvancedThreatDetectionService(deps, config);
}
/**
 * Quick threat assessment
 */
export function assessThreatLevel(service) {
    const stats = service.getStats();
    const blockedIPs = service.getBlockedIPs();
    let threatLevel = "low";
    const recommendations = [];
    if (stats.activeLockouts > 10) {
        threatLevel = "high";
        recommendations.push("High number of locked accounts - investigate potential coordinated attack");
    }
    else if (stats.activeLockouts > 5) {
        threatLevel = "medium";
        recommendations.push("Moderate number of locked accounts - monitor closely");
    }
    if (blockedIPs.length > 5) {
        threatLevel = threatLevel === "high" ? "critical" : "high";
        recommendations.push("Multiple IP addresses blocked - review blocking rules");
    }
    if (stats.unresolvedThreats > 20) {
        threatLevel = "high";
        recommendations.push("High number of unresolved threats - review threat response procedures");
    }
    if (threatLevel === "low" && stats.recentThreats > 0) {
        threatLevel = "low";
        recommendations.push("Monitor recent threat activity");
    }
    return { threatLevel, recommendations };
}
export default AdvancedThreatDetectionService;
//# sourceMappingURL=advanced-threat-detection-service.js.map