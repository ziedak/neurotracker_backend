import {
  IAuthConfig,
  IElysiaAuthPlugin,
  IAuthUser,
  IAuthToken,
  IAuthResponse,
  AuthMethod,
  AuthErrorHandler,
} from "./types/index.js";
import { AuthService } from "./services/index.js";

/**
 * ElysiaJS Authentication Plugin for AuthV2
 * Provides comprehensive authentication and authorization for ElysiaJS applications
 */
export class AuthV2Plugin implements IElysiaAuthPlugin {
  public name = "authv2";
  public config: IAuthConfig;
  private authService: AuthService;

  constructor(config: IAuthConfig) {
    this.config = config;
    this.authService = new AuthService(config);
  }

  /**
   * Authenticate a request using specified methods
   */
  async authenticate(
    request: Request,
    methods: AuthMethod[] = [AuthMethod.JWT]
  ): Promise<IAuthResponse> {
    try {
      const authHeader = request.headers.get("authorization");
      const apiKey = request.headers.get(this.config.apiKey.headerName);

      // Try API Key first if present
      if (apiKey && methods.includes(AuthMethod.API_KEY)) {
        return await this.authService.authenticateApiKey(apiKey);
      }

      // Try JWT if authorization header present
      if (authHeader && methods.includes(AuthMethod.JWT)) {
        const token = this.extractBearerToken(authHeader);
        if (token) {
          return await this.authService.authenticateJWT(token);
        }
      }

      // Try Basic Auth if authorization header present
      if (authHeader && methods.includes(AuthMethod.BASIC)) {
        const credentials = this.extractBasicCredentials(authHeader);
        if (credentials) {
          return await this.authService.authenticateBasic(
            credentials.username,
            credentials.password
          );
        }
      }

      return {
        success: false,
        error: AuthErrorHandler.handle(
          new Error("No valid authentication method provided")
        ),
      };
    } catch (error) {
      return {
        success: false,
        error: AuthErrorHandler.handle(error),
      };
    }
  }

  /**
   * Authorize user against required permissions
   */
  authorize(context: any, permissions: string[]): boolean {
    if (!context.user) return false;

    const userPermissions = context.user.permissions || [];
    return permissions.every((permission) =>
      userPermissions.includes(permission)
    );
  }

  /**
   * Get user by token
   */
  async getUser(token: string): Promise<IAuthUser | null> {
    try {
      const result = await this.authService.authenticateJWT(token);
      return result.success ? result.user! : null;
    } catch {
      return null;
    }
  }

  /**
   * Refresh authentication token
   */
  async refreshToken(refreshToken: string): Promise<IAuthToken | null> {
    try {
      return await this.authService.refreshToken(refreshToken);
    } catch {
      return null;
    }
  }

  /**
   * Extract Bearer token from Authorization header
   */
  private extractBearerToken(authHeader: string): string | null {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match && match[1] ? match[1] : null;
  }

  /**
   * Extract Basic Auth credentials from Authorization header
   */
  private extractBasicCredentials(
    authHeader: string
  ): { username: string; password: string } | null {
    const match = authHeader.match(/^Basic\s+(.+)$/i);
    if (!match || !match[1]) return null;

    try {
      const decoded = Buffer.from(match[1], "base64").toString("utf-8");
      const [username, password] = decoded.split(":");
      return username && password ? { username, password } : null;
    } catch {
      return null;
    }
  }
}

/**
 * Create ElysiaJS plugin instance
 * Note: This is a placeholder implementation. Full ElysiaJS integration
 * will be implemented once ElysiaJS is properly configured in the project.
 */
export const createAuthPlugin = (config: IAuthConfig) => {
  const authPlugin = new AuthV2Plugin(config);

  // Placeholder for ElysiaJS plugin - will be implemented when ElysiaJS is available
  return {
    name: "authv2",
    plugin: authPlugin,
    config,

    // Basic middleware functions that can be used with any framework
    authenticate: (req: any) => authPlugin.authenticate(req),
    authorize: (context: any, permissions: string[]) =>
      authPlugin.authorize(context, permissions),
    getUser: (token: string) => authPlugin.getUser(token),
    refreshToken: (refreshToken: string) =>
      authPlugin.refreshToken(refreshToken),
  };
};

/**
 * Default export for ElysiaJS plugin
 */
export default createAuthPlugin;
