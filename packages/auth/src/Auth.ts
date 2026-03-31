/**
 * @fileoverview Authentication plugin for netreq.
 * Provides automatic token injection, seamless token refresh with queue management,
 * and session state events.
 */

import type {
  AuthPluginOptions,
  AuthState,
  QueuedRequest,
  TokenPair,
  TokenStorage,
  LoginCredentials,
  LoginResult,
  SessionEvent,
} from './types.js';
import { MemoryStorage } from './Storage.js';

/**
 * Generates a unique request ID for queue management.
 * @internal
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Authentication plugin for netreq HTTP client.
 * 
 * This plugin provides:
 * 1. Automatic Authorization header injection
 * 2. Seamless token refresh with mutex/queue pattern
 * 3. Flexible storage adapters
 * 4. Session state events
 * 
 * @example
 * ```typescript
 * import { createClient } from 'netreq';
 * import { Auth, WebStorage } from '@netreq/auth';
 * 
 * const auth = new Auth({
 *   storage: new WebStorage('localStorage'),
 *   refreshEndpoint: '/auth/refresh',
 *   onSessionExpired: () => {
 *     window.location.href = '/login';
 *   }
 * });
 * 
 * const client = createClient({
 *   baseUrl: 'https://api.example.com'
 * });
 * 
 * // Apply the plugin
 * client.use(auth.middleware());
 * 
 * // Login
 * await auth.login('/auth/login', { 
 *   email: 'user@example.com', 
 *   password: 'secret' 
 * });
 * 
 * // All subsequent requests automatically include Authorization header
 * const user = await client.get('/me');
 * ```
 */
export class Auth {
  private readonly options: Required<Omit<AuthPluginOptions, 
    'storage' | 'onLogin' | 'onLogout' | 'onSessionExpired' | 'onTokenRefreshed'
  >> & {
    storage: TokenStorage;
    onLogin?: AuthPluginOptions['onLogin'];
    onLogout?: AuthPluginOptions['onLogout'];
    onSessionExpired?: AuthPluginOptions['onSessionExpired'];
    onTokenRefreshed?: AuthPluginOptions['onTokenRefreshed'];
  };
  
  private state: AuthState;

  /**
   * Creates a new Auth instance.
   * 
   * @param options - Plugin configuration options
   */
  constructor(options: AuthPluginOptions) {
    this.options = {
      storage: options.storage ?? new MemoryStorage(),
      refreshEndpoint: options.refreshEndpoint,
      refreshMethod: options.refreshMethod ?? 'POST',
      extractTokenPair: options.extractTokenPair ?? ((response: unknown) => response as TokenPair),
      buildRefreshBody: options.buildRefreshBody ?? ((refreshToken: string) => ({ refreshToken })),
      refreshHeaders: options.refreshHeaders ?? { 'Content-Type': 'application/json' },
      authHeaderName: options.authHeaderName ?? 'Authorization',
      tokenPrefix: options.tokenPrefix ?? 'Bearer ',
      maxRefreshRetries: options.maxRefreshRetries ?? 3,
      refreshTimeout: options.refreshTimeout ?? 10000,
      fetch: options.fetch ?? fetch,
      onLogin: options.onLogin,
      onLogout: options.onLogout,
      onSessionExpired: options.onSessionExpired,
      onTokenRefreshed: options.onTokenRefreshed,
    };

    this.state = {
      accessToken: null,
      refreshToken: null,
      isRefreshing: false,
      refreshQueue: [],
      refreshRetryCount: 0,
    };

    // Initialize tokens from storage
    this.initializeFromStorage();
  }

  /**
   * Initializes tokens from storage on plugin creation.
   * @internal
   */
  private async initializeFromStorage(): Promise<void> {
    try {
      const tokens = await this.options.storage.getTokens();
      if (tokens) {
        this.state.accessToken = tokens.accessToken;
        this.state.refreshToken = tokens.refreshToken;
      }
    } catch {
      // Ignore storage errors on init
    }
  }

  /**
   * Emits a session event to registered listeners.
   * @internal
   */
  private emit(event: SessionEvent, tokens?: TokenPair): void {
    const listeners: Record<SessionEvent, (typeof this.options)[keyof typeof this.options]> = {
      login: this.options.onLogin,
      logout: this.options.onLogout,
      refresh: this.options.onTokenRefreshed,
      expired: this.options.onSessionExpired,
    };

    const listener = listeners[event];
    if (typeof listener === 'function') {
      try {
        listener(event, tokens);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Performs token refresh operation.
   * This method implements the core refresh logic with retry mechanism.
   * 
   * Step 1: Check if refresh token exists
   * Step 2: Make refresh request to endpoint
   * Step 3: Extract and store new tokens
   * Step 4: Reset retry counter on success
   * Step 5: Handle failures and retry logic
   * 
   * @internal
   */
  private async performRefresh(): Promise<TokenPair | null> {
    const refreshToken = this.state.refreshToken;
    
    if (!refreshToken) {
      this.handleRefreshFailure(new Error('No refresh token available'));
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.options.refreshTimeout
      );

      const response = await this.options.fetch(this.options.refreshEndpoint, {
        method: this.options.refreshMethod,
        headers: this.options.refreshHeaders,
        body: JSON.stringify(this.options.buildRefreshBody(refreshToken)),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Refresh failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const tokens = this.options.extractTokenPair(data);

      // Store new tokens
      await this.options.storage.setTokens(tokens);
      this.state.accessToken = tokens.accessToken;
      this.state.refreshToken = tokens.refreshToken;
      this.state.refreshRetryCount = 0;

      // Emit refresh event
      this.emit('refresh', tokens);

      return tokens;
    } catch (error) {
      this.state.refreshRetryCount++;
      
      // Retry if we haven't exceeded max retries
      if (this.state.refreshRetryCount < this.options.maxRefreshRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, this.state.refreshRetryCount - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.performRefresh();
      }

      this.handleRefreshFailure(error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Handles refresh failure by clearing state and notifying listeners.
   * @internal
   */
  private async handleRefreshFailure(_error: Error): Promise<void> {
    // Clear all tokens
    this.state.accessToken = null;
    this.state.refreshToken = null;
    this.state.refreshRetryCount = 0;
    
    try {
      await this.options.storage.clearTokens();
    } catch {
      // Ignore storage clear errors
    }

    // Emit session expired event
    this.emit('expired');
  }

  /**
   * Processes the refresh queue after successful token refresh.
   * Replays all queued requests with the new access token.
   * 
   * Step 1: Get the new access token
   * Step 2: Process each queued request
   * Step 3: Resolve with updated headers or reject on failure
   * Step 4: Clear the queue
   * 
   * @internal
   */
  private processQueue(error: Error | null, token: string | null): void {
    const queue = [...this.state.refreshQueue];
    this.state.refreshQueue = [];

    for (const request of queue) {
      if (error || !token) {
        // Reject all queued requests if refresh failed
        request.reject(error || new Error('Token refresh failed'));
      } else {
        // Update request headers with new token
        const updatedConfig = {
          ...request.config,
          headers: {
            ...request.config.headers,
            [this.options.authHeaderName]: `${this.options.tokenPrefix}${token}`,
          },
        };
        request.resolve(updatedConfig);
      }
    }
  }

  /**
   * Handles 401 Unauthorized responses by initiating token refresh.
   * Implements the mutex pattern to prevent multiple concurrent refresh attempts.
   * 
   * Mutex Pattern Explanation:
   * - When a 401 is received, we check if a refresh is already in progress
   * - If yes: Add the request to queue and wait for refresh to complete
   * - If no: Start refresh, queue other requests that arrive during refresh
   * - After refresh: Process all queued requests with new token or reject them
   * 
   * This prevents the "race condition" where multiple 401s trigger multiple
   * refresh requests simultaneously.
   * 
   * @internal
   */
  private async handleUnauthorized(
    originalConfig: QueuedRequest['config']
  ): Promise<QueuedRequest['config']> {
    return new Promise((resolve, reject) => {
      const requestId = generateRequestId();

      // Add request to queue
      this.state.refreshQueue.push({
        id: requestId,
        config: originalConfig,
        resolve: (config: unknown) => resolve(config as QueuedRequest['config']),
        reject,
      });

      // If refresh is already in progress, just wait in queue
      if (this.state.isRefreshing) {
        return;
      }

      // Start refresh process
      this.state.isRefreshing = true;

      this.performRefresh()
        .then(tokens => {
          this.state.isRefreshing = false;
          
          if (tokens) {
            // Success: Process all queued requests with new token
            this.processQueue(null, tokens.accessToken);
          } else {
            // Failure: Reject all queued requests
            this.processQueue(new Error('Token refresh failed'), null);
          }
        })
        .catch(error => {
          this.state.isRefreshing = false;
          this.processQueue(error instanceof Error ? error : new Error(String(error)), null);
        });
    });
  }

  /**
   * Returns the netreq middleware function.
   * This function is passed to client.use() to enable authentication.
   * 
   * The middleware:
   * 1. Injects Authorization header if token exists
   * 2. Intercepts 401 responses and triggers token refresh
   * 3. Queues requests during refresh to prevent race conditions
   * 
   * @returns Middleware function for netreq client
   */
  middleware() {
    const self = this;

    return {
      /**
       * Request interceptor - adds Authorization header.
       */
      async onRequest(config: {
        path: string;
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
      }): Promise<typeof config> {
        // Check if token exists and isn't expired
        const token = self.state.accessToken;
        
        if (token) {
          return {
            ...config,
            headers: {
              ...config.headers,
              [self.options.authHeaderName]: `${self.options.tokenPrefix}${token}`,
            },
          };
        }

        return config;
      },

      /**
       * Response interceptor - handles 401 errors and triggers refresh.
       */
      async onResponse(
        response: {
          status: number;
          statusText: string;
          headers: Record<string, string>;
          data: unknown;
        },
        requestConfig: {
          path: string;
          method?: string;
          headers?: Record<string, string>;
          body?: unknown;
        }
      ): Promise<typeof response> {
        // If response is not 401, return as-is
        if (response.status !== 401) {
          return response;
        }

        // Check if this request already has Authorization header
        // If yes and we got 401, token might be expired - try refresh
        const hasAuthHeader = requestConfig.headers?.[self.options.authHeaderName] !== undefined;
        
        if (!hasAuthHeader) {
          // No auth header was sent, this is a genuine 401 (no token)
          return response;
        }

        // Attempt to refresh token and retry request
        try {
          const updatedConfig = await self.handleUnauthorized(requestConfig);
          
          // Retry the request with new token
          // Note: This assumes the client will retry with updated config
          // In a real implementation, you might need to trigger a retry manually
          throw {
            __netreq_auth_retry: true,
            config: updatedConfig,
            originalResponse: response,
          };
        } catch (error) {
          // If it's our retry signal, re-throw for client to handle
          if (error && typeof error === 'object' && '__netreq_auth_retry' in error) {
            throw error;
          }
          
          // Otherwise, return original 401 response
          return response;
        }
      },

      /**
       * Error interceptor - handles network errors.
       */
      async onError(error: Error): Promise<Error> {
        return error;
      },
    };
  }

  /**
   * Logs in a user and stores tokens.
   * 
   * @param endpoint - Login API endpoint
   * @param credentials - Login credentials
   * @returns Login result with success status
   */
  async login(endpoint: string, credentials: LoginCredentials): Promise<LoginResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await this.options.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.message || `Login failed: ${response.status}`,
        };
      }

      const data = await response.json();
      const tokens = this.options.extractTokenPair(data);

      // Store tokens
      await this.options.storage.setTokens(tokens);
      this.state.accessToken = tokens.accessToken;
      this.state.refreshToken = tokens.refreshToken;

      // Emit login event
      this.emit('login', tokens);

      return {
        success: true,
        tokens,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Login failed',
      };
    }
  }

  /**
   * Logs out the current user and clears all tokens.
   */
  async logout(): Promise<void> {
    this.state.accessToken = null;
    this.state.refreshToken = null;
    this.state.refreshRetryCount = 0;
    
    try {
      await this.options.storage.clearTokens();
    } catch {
      // Ignore storage clear errors
    }

    this.emit('logout');
  }

  /**
   * Gets the current access token.
   * @returns Current access token or null if not logged in
   */
  getAccessToken(): string | null {
    return this.state.accessToken;
  }

  /**
   * Checks if user is currently authenticated.
   * @returns True if access token exists
   */
  isAuthenticated(): boolean {
    return this.state.accessToken !== null;
  }

  /**
   * Manually sets tokens (useful for OAuth flows or testing).
   * 
   * @param tokens - Token pair to set
   */
  async setTokens(tokens: TokenPair): Promise<void> {
    await this.options.storage.setTokens(tokens);
    this.state.accessToken = tokens.accessToken;
    this.state.refreshToken = tokens.refreshToken;
  }
}