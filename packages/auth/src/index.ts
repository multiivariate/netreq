/**
 * @fileoverview Main entry point for @netreq/auth.
 * Authentication plugin for netreq HTTP client with JWT support,
 * automatic token refresh, and flexible storage adapters.
 */

export {
  Auth,
} from './Auth.js';

export {
  MemoryStorage,
  WebStorage,
  CookieStorage,
} from './Storage.js';

export type {
  TokenPair,
  TokenStorage,
  SessionEvent,
  SessionEventListener,
  AuthPluginOptions,
  QueuedRequest,
  AuthState,
  LoginCredentials,
  LoginResult,
  CookieOptions,
} from './types.js';