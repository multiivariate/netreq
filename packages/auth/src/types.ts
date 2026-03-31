/**
 * @fileoverview Core type definitions for @netreq/auth.
 * Defines interfaces for storage adapters, token management, and plugin configuration.
 */

/**
 * Token pair structure containing both access and refresh tokens.
 * Access token is used for API authentication.
 * Refresh token is used to obtain a new access token when it expires.
 */
export interface TokenPair {
  /** JWT access token for API authentication */
  accessToken: string;
  /** Refresh token to obtain new access token */
  refreshToken: string;
  /** Token expiration timestamp (Unix timestamp in milliseconds) */
  expiresAt?: number;
}

/**
 * Storage adapter interface for token persistence.
 * Implement this interface to create custom storage solutions
 * (e.g., encrypted storage, cookie-based storage).
 * 
 * @example
 * ```typescript
 * class SecureStorage implements TokenStorage {
 *   async getTokens(): Promise<TokenPair | null> {
 *     const encrypted = await decryptFromStorage();
 *     return encrypted;
 *   }
 *   // ... implement other methods
 * }
 * ```
 */
export interface TokenStorage {
  /**
   * Retrieves stored tokens from storage.
   * @returns Promise resolving to token pair or null if not found
   */
  getTokens(): Promise<TokenPair | null>;
  
  /**
   * Stores tokens in storage.
   * @param tokens - Token pair to store
   * @returns Promise that resolves when storage is complete
   */
  setTokens(tokens: TokenPair): Promise<void>;
  
  /**
   * Removes all tokens from storage (logout).
   * @returns Promise that resolves when removal is complete
   */
  clearTokens(): Promise<void>;
}

/**
 * Session state change event types.
 */
export type SessionEvent = 
  | 'login'      // User successfully logged in
  | 'logout'     // User logged out
  | 'refresh'    // Token refreshed successfully
  | 'expired';   // Session expired (refresh failed)

/**
 * Session state event listener callback type.
 */
export type SessionEventListener = (event: SessionEvent, tokens?: TokenPair) => void;

/**
 * Authentication plugin configuration options.
 */
export interface AuthPluginOptions {
  /**
   * Storage adapter for token persistence.
   * Defaults to MemoryStorage for Node.js/SSR, LocalStorage for browsers.
   */
  storage?: TokenStorage;
  
  /**
   * URL endpoint for token refresh.
   * This endpoint should accept refresh token and return new token pair.
   * @example '/auth/refresh' or 'https://api.example.com/auth/refresh'
   */
  refreshEndpoint: string;
  
  /**
   * HTTP method for refresh request.
   * @default 'POST'
   */
  refreshMethod?: 'POST' | 'GET' | 'PUT';
  
  /**
   * Function to extract token pair from refresh response.
   * Use this if your API returns tokens in a non-standard format.
   * 
   * @default (response) => response (assumes response is TokenPair)
   * @example
   * ```typescript
   * extractTokenPair: (response) => ({
   *   accessToken: response.data.access_token,
   *   refreshToken: response.data.refresh_token,
   *   expiresAt: Date.now() + response.data.expires_in * 1000
   * })
   * ```
   */
  extractTokenPair?: (response: unknown) => TokenPair;
  
  /**
   * Function to build refresh request body.
   * Use this if your API expects refresh token in a specific format.
   * 
   * @default (refreshToken) => ({ refreshToken })
   */
  buildRefreshBody?: (refreshToken: string) => unknown;
  
  /**
   * Request headers to include with refresh requests.
   * Useful for adding content-type or custom headers.
   * 
   * @default { 'Content-Type': 'application/json' }
   */
  refreshHeaders?: Record<string, string>;
  
  /**
   * Header name for authorization token.
   * @default 'Authorization'
   */
  authHeaderName?: string;
  
  /**
   * Token prefix for authorization header.
   * @default 'Bearer '
   */
  tokenPrefix?: string;
  
  /**
   * Called when user successfully logs in.
   */
  onLogin?: SessionEventListener;
  
  /**
   * Called when user logs out.
   */
  onLogout?: SessionEventListener;
  
  /**
   * Called when session expires and refresh fails.
   * Use this to redirect to login page.
   */
  onSessionExpired?: SessionEventListener;
  
  /**
   * Called when tokens are successfully refreshed.
   */
  onTokenRefreshed?: SessionEventListener;
  
  /**
   * Maximum number of refresh retry attempts.
   * @default 3
   */
  maxRefreshRetries?: number;
  
  /**
   * Timeout for refresh requests in milliseconds.
   * @default 10000
   */
  refreshTimeout?: number;
  
  /**
   * Custom fetch implementation for refresh requests.
   * Useful for testing or custom fetch wrappers.
   */
  fetch?: typeof fetch;
}

/**
 * Internal queue item for pending requests during token refresh.
 * @internal
 */
export interface QueuedRequest {
  /** Unique request identifier */
  id: string;
  /** Request configuration */
  config: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  /** Resolve function for the request promise */
  resolve: (value: unknown) => void;
  /** Reject function for the request promise */
  reject: (reason?: Error) => void;
}

/**
 * Authentication state managed by the plugin.
 * @internal
 */
export interface AuthState {
  /** Currently active access token */
  accessToken: string | null;
  /** Currently active refresh token */
  refreshToken: string | null;
  /** Whether a token refresh is currently in progress */
  isRefreshing: boolean;
  /** Queue of requests waiting for token refresh */
  refreshQueue: QueuedRequest[];
  /** Number of consecutive refresh failures */
  refreshRetryCount: number;
}

/**
 * Login credentials structure.
 */
export interface LoginCredentials {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Login function response.
 */
export interface LoginResult {
  success: boolean;
  error?: string;
  tokens?: TokenPair;
}

/**
 * Cookie storage configuration options.
 */
export interface CookieOptions {
  /** Cookie name */
  name: string;
  /** Cookie expiration in days */
  expires?: number;
  /** Cookie path */
  path?: string;
  /** Cookie domain */
  domain?: string;
  /** Whether cookie requires HTTPS */
  secure?: boolean;
  /** SameSite attribute */
  sameSite?: 'strict' | 'lax' | 'none';
}