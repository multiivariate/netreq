/**
 * @fileoverview Main entry point for netreq.
 * A lightweight, secure HTTP client with zero dependencies.
 * 
 * @module netreq
 * @version 0.1.0
 * 
 * @example
 * ```typescript
 * import { createClient } from 'netreq';
 * 
 * const client = createClient({
 *   baseUrl: 'https://api.example.com',
 *   defaultHeaders: {
 *     'Authorization': `Bearer ${process.env.API_TOKEN}`
 *   }
 * });
 * 
 * const response = await client.get('/users');
 * ```
 */

export {
  Client,
  createClient,
} from './core/Client.js';

export type {
  ClientConfig,
  RequestConfig,
  ClientResponse,
  LogEntry,
  SanitizeConfig,
  HttpMethod,
  RequestBody,
} from './core/Client.js';