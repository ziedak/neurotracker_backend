/**
 * User Authentication Service
 * Handles authentication flows: login, register, logout
 * Part of Phase 2 service refactoring for single responsibility principle
 */
import { AuthResult, LoginCredentials, RegisterData, ServiceDependencies } from "../types";
import { JWTService } from "./jwt-service";
import { KeycloakService } from "./keycloak-service";
import { SessionService } from "./session-service";
import { PasswordPolicyService } from "./password-policy-service";
/**
 * Interface for User Authentication Service
 */
export interface IUserAuthenticationService {
    /**
     * Authenticate user with credentials
     */
    login(credentials: LoginCredentials): Promise<AuthResult>;
    /**
     * Register new user account
     */
    register(data: RegisterData): Promise<AuthResult>;
    /**
     * Logout user and revoke tokens
     */
    logout(userId: string, token?: string): Promise<boolean>;
    /**
     * Validate login credentials
     */
    validateLoginCredentials(credentials: LoginCredentials): Promise<{
        valid: boolean;
        errors?: string[];
    }>;
}
/**
 * User Authentication Service Implementation
 *
 * Responsible for:
 * - User login with credentials validation
 * - New user registration
 * - User logout and token revocation
 * - Authentication flow coordination
 */
export declare class UserAuthenticationService implements IUserAuthenticationService {
    private deps;
    private jwtService;
    private keycloakService;
    private sessionService;
    private passwordPolicyService?;
    constructor(deps: ServiceDependencies, services: {
        jwtService: JWTService;
        keycloakService: KeycloakService;
        sessionService: SessionService;
        passwordPolicyService?: PasswordPolicyService;
    });
    /**
     * Authenticate user with email/username and password
     */
    login(credentials: LoginCredentials): Promise<AuthResult>;
    /**
     * Register new user account
     */
    register(data: RegisterData): Promise<AuthResult>;
    /**
     * Logout user and revoke tokens
     */
    logout(userId: string, token?: string): Promise<boolean>;
    /**
     * Validate login credentials format and password policy
     */
    validateLoginCredentials(credentials: LoginCredentials): Promise<{
        valid: boolean;
        errors?: string[];
    }>;
}
//# sourceMappingURL=user-authentication-service.d.ts.map