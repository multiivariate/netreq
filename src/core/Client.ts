/**
 * @fileoverview Core HTTP Client implementation for netreq.
 * Provides a zero-dependency wrapper around native fetch API with
 * centralized configuration and secure logging capabilities.
 */

/** HTTP methods supported by the client */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** Request body types */
type RequestBody = string | object | FormData | URLSearchParams | null;

/** Valid body types for fetch API */
type RequestBodyInit = string | FormData | URLSearchParams;

/**
 * Configuration options for the HTTP client.
 */
interface ClientConfig {
  /** Base URL for all requests */
  baseUrl: string;
  /** Default headers to include in all requests */
  defaultHeaders?: Record<string, string>;
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** Sanitization configuration for secure logging */
  sanitize?: SanitizeConfig;
}

/**
 * Configuration for sanitizing sensitive data in logs.
 */
interface SanitizeConfig {
  /** Header names to sanitize (case-insensitive). Default: ['authorization', 'x-api-key', 'cookie'] */
  sensitiveHeaders?: string[];
  /** Patterns to detect sensitive values in body (matched against keys). Default: ['password', 'secret', 'token', 'key'] */
  sensitiveBodyKeys?: string[];
  /** Replacement string for sensitive values. Default: '***REDACTED***' */
  replacement?: string;
}

/**
 * Request configuration for individual requests.
 */
interface RequestConfig {
  /** URL path (appended to baseUrl) */
  path: string;
  /** HTTP method */
  method?: HttpMethod;
  /** Request headers (merged with default headers) */
  headers?: Record<string, string>;
  /** Request body */
  body?: RequestBody;
  /** Override timeout for this request */
  timeout?: number;
}

/**
 * Standardized response structure.
 */
interface ClientResponse<T = unknown> {
  /** Response data (parsed JSON or raw text) */
  data: T;
  /** HTTP status code */
  status: number;
  /** Response status text */
  statusText: string;
  /** Response headers */
  headers: Record<string, string>;
  /** Original URL */
  url: string;
}

/**
 * Log entry structure for debugging.
 */
interface LogEntry {
  timestamp: string;
  type: 'request' | 'response' | 'error';
  method?: string;
  url?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  error?: string;
  duration?: number;
}

/**
 * Middleware function type for request/response interceptors.
 */
interface Middleware {
  /**
   * Interceptor called before each request.
   * Can modify request config or return a new one.
   */
  onRequest?: (config: RequestConfig) => Promise<RequestConfig> | RequestConfig;
  
  /**
   * Interceptor called after each successful response.
   * Can modify response or handle special cases (like 401 refresh).
   */
  onResponse?: <T>(response: ClientResponse<T>, requestConfig: RequestConfig) => 
    Promise<ClientResponse<T>> | ClientResponse<T>;
  
  /**
   * Interceptor called when a request fails.
   * Can handle errors or transform them.
   */
  onError?: (error: Error) => Promise<Error> | Error;
}

/**
 * Default sensitive header names (case-insensitive).
 * @internal
 */
const DEFAULT_SENSITIVE_HEADERS = [
  'authorization',
  'x-api-key',
  'api-key',
  'cookie',
  'x-auth-token',
  'bearer',
];

/**
 * Default sensitive body key patterns (matched against keys).
 * @internal
 */
const DEFAULT_SENSITIVE_BODY_KEYS = [
  'password',
  'secret',
  'token',
  'key',
  'apikey',
  'api_key',
  'auth',
  'credential',
];

/**
 * Sanitizes sensitive data from headers.
 * @param headers - Headers to sanitize
 * @param sensitiveHeaders - List of header names to sanitize
 * @param replacement - Replacement string
 * @returns Sanitized headers
 * @internal
 */
function sanitizeHeaders(
  headers: Record<string, string>,
  sensitiveHeaders: string[],
  replacement: string
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const sensitiveSet = new Set(sensitiveHeaders.map(h => h.toLowerCase()));

  for (const [key, value] of Object.entries(headers)) {
    sanitized[key] = sensitiveSet.has(key.toLowerCase()) ? replacement : value;
  }

  return sanitized;
}

/**
 * Recursively sanitizes sensitive data from body objects.
 * @param body - Body to sanitize
 * @param sensitiveKeys - List of sensitive key patterns
 * @param replacement - Replacement string
 * @returns Sanitized body
 * @internal
 */
function sanitizeBody(
  body: unknown,
  sensitiveKeys: string[],
  replacement: string
): unknown {
  if (body === null || typeof body !== 'object') {
    return body;
  }

  if (body instanceof FormData || body instanceof URLSearchParams) {
    // FormData and URLSearchParams can't be easily inspected/sanitized
    return body;
  }

  if (Array.isArray(body)) {
    return body.map(item => sanitizeBody(item, sensitiveKeys, replacement));
  }

  const sanitized: Record<string, unknown> = {};
  const sensitivePatterns = sensitiveKeys.map(k => k.toLowerCase());

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const isSensitive = sensitivePatterns.some(pattern => 
      key.toLowerCase().includes(pattern)
    );
    
    if (isSensitive) {
      sanitized[key] = replacement;
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeBody(value, sensitiveKeys, replacement);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * HTTP Client class providing a secure, configurable wrapper around native fetch.
 * 
 * @example
 * ```typescript
 * const client = new Client({
 *   baseUrl: 'https://api.example.com',
 *   defaultHeaders: {
 *     'Content-Type': 'application/json',
 *     'X-API-Key': process.env.API_KEY!
 *   },
 *   sanitize: {
 *     sensitiveHeaders: ['X-API-Key'],
 *     sensitiveBodyKeys: ['password', 'secret']
 *   }
 * });
 * 
 * // All sensitive headers will be automatically masked in logs
 * const response = await client.request({
 *   path: '/users',
 *   method: 'GET'
 * });
 * ```
 */
export class Client {
  private readonly config: Required<ClientConfig>;
  private middlewares: Middleware[] = [];

  /**
   * Creates a new HTTP Client instance.
   * @param config - Client configuration
   */
  constructor(config: ClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''), // Remove trailing slash
      defaultHeaders: config.defaultHeaders ?? {},
      timeout: config.timeout ?? 10000,
      sanitize: {
        sensitiveHeaders: config.sanitize?.sensitiveHeaders ?? DEFAULT_SENSITIVE_HEADERS,
        sensitiveBodyKeys: config.sanitize?.sensitiveBodyKeys ?? DEFAULT_SENSITIVE_BODY_KEYS,
        replacement: config.sanitize?.replacement ?? '***REDACTED***',
      },
    };
  }

  /**
   * Adds a middleware to the client.
   * Middlewares are executed in the order they were added.
   * 
   * @param middleware - Middleware to add
   * @returns The client instance for chaining
   * 
   * @example
   * ```typescript
   * import { AuthPlugin } from '@netreq/auth';
   * 
   * const authPlugin = new AuthPlugin({
   *   refreshEndpoint: '/auth/refresh',
   *   storage: new WebStorage('localStorage')
   * });
   * 
   * client.use(authPlugin.middleware());
   * ```
   */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Removes a middleware from the client.
   * @param middleware - Middleware to remove
   * @returns True if middleware was found and removed
   */
  remove(middleware: Middleware): boolean {
    const index = this.middlewares.indexOf(middleware);
    if (index > -1) {
      this.middlewares.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clears all middlewares from the client.
   */
  clearMiddlewares(): void {
    this.middlewares = [];
  }

  /**
   * Creates a sanitized log entry for debugging.
   * Sensitive data is automatically masked.
   * 
   * @param entry - Log entry to sanitize
   * @returns Sanitized log entry safe for logging
   */
  createLog(entry: LogEntry): LogEntry {
    const sanitized: LogEntry = {
      ...entry,
      headers: entry.headers 
        ? sanitizeHeaders(
            entry.headers,
            this.config.sanitize.sensitiveHeaders ?? DEFAULT_SENSITIVE_HEADERS,
            this.config.sanitize.replacement ?? '***REDACTED***'
          )
        : undefined,
      body: entry.body
        ? sanitizeBody(
            entry.body,
            this.config.sanitize.sensitiveBodyKeys ?? DEFAULT_SENSITIVE_BODY_KEYS,
            this.config.sanitize.replacement ?? '***REDACTED***'
          )
        : undefined,
    };

    return sanitized;
  }

  /**
   * Executes request middlewares in sequence.
   * @internal
   */
  private async executeRequestMiddlewares(config: RequestConfig): Promise<RequestConfig> {
    let currentConfig = config;
    
    for (const middleware of this.middlewares) {
      if (middleware.onRequest) {
        currentConfig = await middleware.onRequest(currentConfig);
      }
    }
    
    return currentConfig;
  }

  /**
   * Executes response middlewares in sequence.
   * @internal
   */
  private async executeResponseMiddlewares<T>(
    response: ClientResponse<T>, 
    requestConfig: RequestConfig
  ): Promise<ClientResponse<T>> {
    let currentResponse = response;
    
    for (const middleware of this.middlewares) {
      if (middleware.onResponse) {
        currentResponse = await middleware.onResponse(currentResponse, requestConfig);
      }
    }
    
    return currentResponse;
  }

  /**
   * Executes error middlewares in sequence.
   * @internal
   */
  private async executeErrorMiddlewares(error: Error): Promise<Error> {
    let currentError = error;
    
    for (const middleware of this.middlewares) {
      if (middleware.onError) {
        currentError = await middleware.onError(currentError);
      }
    }
    
    return currentError;
  }

  /**
   * Makes an HTTP request with the configured settings.
   * Automatically sanitizes sensitive data in any logged information.
   * 
   * @param requestConfig - Request configuration
   * @returns Promise resolving to standardized response
   * @throws Error if request fails or times out
   */
  async request<T = unknown>(requestConfig: RequestConfig): Promise<ClientResponse<T>> {
    // Execute request middlewares
    const config = await this.executeRequestMiddlewares(requestConfig);
    
    const url = `${this.config.baseUrl}${config.path}`;
    const method = config.method ?? 'GET';
    const timeout = config.timeout ?? this.config.timeout;

    // Merge headers
    const headers: Record<string, string> = {
      ...this.config.defaultHeaders,
      ...config.headers,
    };

    // Prepare body
    let body: RequestBodyInit | undefined;
    if (config.body !== null && config.body !== undefined) {
      if (typeof config.body === 'string') {
        body = config.body;
      } else if (config.body instanceof FormData || config.body instanceof URLSearchParams) {
        body = config.body;
      } else {
        body = JSON.stringify(config.body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Parse response
      const contentType = response.headers.get('content-type') || '';
      let data: T;

      if (contentType.includes('application/json')) {
        data = await response.json() as T;
      } else {
        data = await response.text() as unknown as T;
      }

      // Build headers record
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const result: ClientResponse<T> = {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        url: response.url,
      };

      // Execute response middlewares
      return await this.executeResponseMiddlewares(result, config);
    } catch (error) {
      const processedError = await this.executeErrorMiddlewares(
        error instanceof Error ? error : new Error(String(error))
      );
      
      if (processedError instanceof Error) {
        if (processedError.name === 'AbortError') {
          throw new Error(`Request timeout after ${timeout}ms: ${url}`);
        }
        throw processedError;
      }

      throw new Error(`Request failed: ${String(error)}`);
    }
  }

  /**
   * Convenience method for GET requests.
   * @param path - URL path
   * @param headers - Optional additional headers
   * @returns Promise resolving to response
   */
  get<T = unknown>(path: string, headers?: Record<string, string>): Promise<ClientResponse<T>> {
    return this.request<T>({ path, method: 'GET', headers });
  }

  /**
   * Convenience method for POST requests.
   * @param path - URL path
   * @param body - Request body
   * @param headers - Optional additional headers
   * @returns Promise resolving to response
   */
  post<T = unknown>(
    path: string,
    body?: RequestBody,
    headers?: Record<string, string>
  ): Promise<ClientResponse<T>> {
    return this.request<T>({ path, method: 'POST', body, headers });
  }

  /**
   * Convenience method for PUT requests.
   * @param path - URL path
   * @param body - Request body
   * @param headers - Optional additional headers
   * @returns Promise resolving to response
   */
  put<T = unknown>(
    path: string,
    body?: RequestBody,
    headers?: Record<string, string>
  ): Promise<ClientResponse<T>> {
    return this.request<T>({ path, method: 'PUT', body, headers });
  }

  /**
   * Convenience method for PATCH requests.
   * @param path - URL path
   * @param body - Request body
   * @param headers - Optional additional headers
   * @returns Promise resolving to response
   */
  patch<T = unknown>(
    path: string,
    body?: RequestBody,
    headers?: Record<string, string>
  ): Promise<ClientResponse<T>> {
    return this.request<T>({ path, method: 'PATCH', body, headers });
  }

  /**
   * Convenience method for DELETE requests.
   * @param path - URL path
   * @param headers - Optional additional headers
   * @returns Promise resolving to response
   */
  delete<T = unknown>(path: string, headers?: Record<string, string>): Promise<ClientResponse<T>> {
    return this.request<T>({ path, method: 'DELETE', headers });
  }
}

/**
 * Factory function to create a configured HTTP client instance.
 * This is the recommended way to initialize netreq.
 * 
 * @param config - Client configuration
 * @returns Configured Client instance
 * 
 * @example
 * ```typescript
 * import { createClient } from 'netreq';
 * 
 * const api = createClient({
 *   baseUrl: process.env.API_URL!,
 *   defaultHeaders: {
 *     'Authorization': `Bearer ${process.env.API_TOKEN!}`,
 *     'Content-Type': 'application/json'
 *   },
 *   sanitize: {
 *     sensitiveHeaders: ['Authorization'],
 *     replacement: '[REDACTED]'
 *   }
 * });
 * 
 * // Use throughout your application
 * const users = await api.get('/users');
 * ```
 */
export function createClient(config: ClientConfig): Client {
  return new Client(config);
}

export type {
  ClientConfig,
  RequestConfig,
  ClientResponse,
  LogEntry,
  SanitizeConfig,
  HttpMethod,
  RequestBody,
  Middleware,
};