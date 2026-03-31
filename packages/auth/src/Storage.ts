/**
 * @fileoverview Storage adapter implementations for @netreq/auth.
 * Provides both in-memory and web storage (localStorage/sessionStorage) adapters.
 */

import type { TokenPair, TokenStorage } from './types.js';

/**
 * In-memory storage adapter.
 * Stores tokens in JavaScript memory. Data is lost on page refresh.
 * 
 * Use this for:
 * - Server-side rendering (SSR)
 * - Testing environments
 * - When you don't need persistence across page reloads
 * 
 * @example
 * ```typescript
 * import { MemoryStorage } from '@netreq/auth';
 * 
 * const auth = new AuthPlugin({
 *   storage: new MemoryStorage(),
 *   refreshEndpoint: '/auth/refresh'
 * });
 * ```
 */
export class MemoryStorage implements TokenStorage {
  private tokens: TokenPair | null = null;

  /**
   * Retrieves tokens from memory.
   * @returns Promise resolving to stored tokens or null
   */
  async getTokens(): Promise<TokenPair | null> {
    return this.tokens;
  }

  /**
   * Stores tokens in memory.
   * @param tokens - Token pair to store
   */
  async setTokens(tokens: TokenPair): Promise<void> {
    this.tokens = tokens;
  }

  /**
   * Clears tokens from memory.
   */
  async clearTokens(): Promise<void> {
    this.tokens = null;
  }
}

/**
 * Web Storage adapter for browsers.
 * Uses localStorage or sessionStorage to persist tokens.
 * 
 * Use this for:
 * - Browser applications requiring token persistence
 * - Remember me functionality (localStorage)
 * - Session-only persistence (sessionStorage)
 * 
 * @example
 * ```typescript
 * import { WebStorage } from '@netreq/auth';
 * 
 * // Use localStorage (persists across browser sessions)
 * const auth = new AuthPlugin({
 *   storage: new WebStorage('localStorage', 'myapp_tokens'),
 *   refreshEndpoint: '/auth/refresh'
 * });
 * 
 * // Use sessionStorage (cleared when tab closes)
 * const authSession = new AuthPlugin({
 *   storage: new WebStorage('sessionStorage', 'myapp_tokens'),
 *   refreshEndpoint: '/auth/refresh'
 * });
 * ```
 */
export class WebStorage implements TokenStorage {
  private storage: Storage;
  private key: string;

  /**
   * Creates a new WebStorage instance.
   * 
   * @param storageType - Type of web storage ('localStorage' or 'sessionStorage')
   * @param key - Storage key name (default: 'netreq_auth_tokens')
   * @throws Error if storage type is invalid or not available (SSR)
   */
  constructor(
    storageType: 'localStorage' | 'sessionStorage' = 'localStorage',
    key: string = 'netreq_auth_tokens'
  ) {
    this.key = key;
    
    if (typeof window === 'undefined') {
      throw new Error(
        'WebStorage is not available in server-side environment. ' +
        'Use MemoryStorage for SSR or check typeof window before creating WebStorage.'
      );
    }

    const storage = window[storageType];
    if (!storage) {
      throw new Error(`Storage type "${storageType}" is not available in this browser`);
    }
    
    this.storage = storage;
  }

  /**
   * Retrieves tokens from web storage.
   * @returns Promise resolving to stored tokens or null
   */
  async getTokens(): Promise<TokenPair | null> {
    try {
      const data = this.storage.getItem(this.key);
      if (!data) return null;
      
      const parsed = JSON.parse(data) as TokenPair;
      return parsed;
    } catch {
      // If parsing fails, clear corrupted data
      this.storage.removeItem(this.key);
      return null;
    }
  }

  /**
   * Stores tokens in web storage.
   * @param tokens - Token pair to store
   */
  async setTokens(tokens: TokenPair): Promise<void> {
    this.storage.setItem(this.key, JSON.stringify(tokens));
  }

  /**
   * Clears tokens from web storage.
   */
  async clearTokens(): Promise<void> {
    this.storage.removeItem(this.key);
  }
}

/**
 * Cookie storage adapter for browsers.
 * Stores tokens in HTTP-only or JavaScript-accessible cookies.
 * 
 * Note: This is a basic implementation. For production use with HTTP-only cookies,
 * you should handle cookies server-side to prevent XSS attacks.
 * 
 * @example
 * ```typescript
 * import { CookieStorage } from '@netreq/auth';
 * 
 * const auth = new AuthPlugin({
 *   storage: new CookieStorage({
 *     name: 'auth_tokens',
 *     expires: 7, // 7 days
 *     secure: true,
 *     sameSite: 'strict'
 *   }),
   *   refreshEndpoint: '/auth/refresh'
 * });
 * ```
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

export class CookieStorage implements TokenStorage {
  private options: Required<Pick<CookieOptions, 'name' | 'path'>> &
    Pick<CookieOptions, 'expires' | 'domain' | 'secure' | 'sameSite'>;

  constructor(options: CookieOptions) {
    if (typeof document === 'undefined') {
      throw new Error(
        'CookieStorage is not available in server-side environment. ' +
        'Use MemoryStorage for SSR.'
      );
    }

    this.options = {
      name: options.name,
      path: options.path ?? '/',
      expires: options.expires,
      domain: options.domain,
      secure: options.secure,
      sameSite: options.sameSite,
    };
  }

  /**
   * Retrieves tokens from cookies.
   */
  async getTokens(): Promise<TokenPair | null> {
    const cookies = document.cookie.split(';');
    const targetCookie = cookies.find(c => 
      c.trim().startsWith(`${this.options.name}=`)
    );
    
    if (!targetCookie) return null;

    try {
      const value = targetCookie.split('=')[1];
      const decoded = decodeURIComponent(value);
      return JSON.parse(decoded) as TokenPair;
    } catch {
      return null;
    }
  }

  /**
   * Stores tokens in cookies.
   */
  async setTokens(tokens: TokenPair): Promise<void> {
    const value = encodeURIComponent(JSON.stringify(tokens));
    let cookieString = `${this.options.name}=${value}; path=${this.options.path}`;

    if (this.options.expires) {
      const date = new Date();
      date.setDate(date.getDate() + this.options.expires);
      cookieString += `; expires=${date.toUTCString()}`;
    }

    if (this.options.domain) {
      cookieString += `; domain=${this.options.domain}`;
    }

    if (this.options.secure) {
      cookieString += '; secure';
    }

    if (this.options.sameSite) {
      cookieString += `; samesite=${this.options.sameSite}`;
    }

    document.cookie = cookieString;
  }

  /**
   * Clears tokens from cookies.
   */
  async clearTokens(): Promise<void> {
    let cookieString = `${this.options.name}=; path=${this.options.path}; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    
    if (this.options.domain) {
      cookieString += `; domain=${this.options.domain}`;
    }

    document.cookie = cookieString;
  }
}