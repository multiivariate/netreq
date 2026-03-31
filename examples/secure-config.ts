/**
 * @fileoverview Example: Secure configuration pattern for netreq.
 * 
 * This example demonstrates the recommended approach for managing API keys,
 * URLs, and other sensitive configuration in a centralized, secure manner.
 * 
 * The pattern ensures:
 * - Sensitive data is loaded from environment variables
 * - Configuration is defined once and reused throughout the application
 * - API keys are automatically sanitized in logs
 * - Type safety with strict TypeScript
 */

import { createClient, type ClientConfig, type Client } from '../src/index.js';

/**
 * Environment configuration interface.
 * Define all your environment variables here for type safety.
 */
interface EnvConfig {
  /** API base URL */
  API_URL: string;
  /** API authentication token */
  API_TOKEN: string;
  /** Optional: Custom API key header name */
  API_KEY_HEADER?: string;
  /** Optional: Request timeout in milliseconds */
  REQUEST_TIMEOUT?: string;
}

/**
 * Validates and loads environment variables.
 * Throws an error if required variables are missing.
 * 
 * @returns Validated environment configuration
 * @throws Error if required environment variables are not set
 */
function loadEnv(): EnvConfig {
  const env: EnvConfig = {
    API_URL: process.env.API_URL || '',
    API_TOKEN: process.env.API_TOKEN || '',
    API_KEY_HEADER: process.env.API_KEY_HEADER,
    REQUEST_TIMEOUT: process.env.REQUEST_TIMEOUT,
  };

  // Validate required variables
  const required: (keyof EnvConfig)[] = ['API_URL', 'API_TOKEN'];
  const missing = required.filter(key => !env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please set them in your .env file or environment.`
    );
  }

  return env;
}

/**
 * Creates the netreq client configuration from environment variables.
 * 
 * @param env - Environment configuration
 * @returns Client configuration object
 */
function createClientConfig(env: EnvConfig): ClientConfig {
  const headerName = env.API_KEY_HEADER || 'Authorization';
  const isBearer = headerName.toLowerCase() === 'authorization';

  return {
    baseUrl: env.API_URL,
    defaultHeaders: {
      [headerName]: isBearer ? `Bearer ${env.API_TOKEN}` : env.API_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: env.REQUEST_TIMEOUT ? parseInt(env.REQUEST_TIMEOUT, 10) : 10000,
    // Security: Define what should be sanitized in logs
    sanitize: {
      // Headers that contain sensitive data
      sensitiveHeaders: [
        'Authorization',
        headerName,
        'X-API-Key',
        'Cookie',
        'X-Auth-Token',
      ],
      // Body keys that contain sensitive data
      sensitiveBodyKeys: [
        'password',
        'secret',
        'token',
        'apiKey',
        'api_key',
        'authToken',
        'credential',
      ],
      replacement: '***REDACTED***',
    },
  };
}

/**
 * Singleton instance holder.
 * This ensures the client is created only once.
 */
let clientInstance: Client | null = null;

/**
 * Gets or creates the configured netreq client instance.
 * This is the main entry point for using the API client in your application.
 * 
 * @returns Configured Client instance
 * @example
 * ```typescript
 * import { getApiClient } from './secure-config';
 * 
 * async function fetchUsers() {
 *   const api = getApiClient();
 *   const response = await api.get('/users');
 *   return response.data;
 * }
 * ```
 */
export function getApiClient(): Client {
  if (!clientInstance) {
    const env = loadEnv();
    const config = createClientConfig(env);
    clientInstance = createClient(config);
  }
  return clientInstance;
}

/**
 * Resets the singleton instance (useful for testing).
 */
export function resetApiClient(): void {
  clientInstance = null;
}

/**
 * Example: Environment variable template for .env file
 * 
 * Copy this to a `.env` file in your project root:
 * 
 * ```
 * # API Configuration
 * API_URL=https://api.example.com
 * API_TOKEN=your-secret-api-token-here
 * 
 * # Optional: Custom header name (default: Authorization)
 * API_KEY_HEADER=Authorization
 * 
 * # Optional: Request timeout in ms (default: 10000)
 * REQUEST_TIMEOUT=10000
 * ```
 * 
 * Make sure to add `.env` to your `.gitignore` file to prevent
 * committing secrets to version control.
 */

// Example usage demonstration (not executed)
async function exampleUsage() {
  // Get the configured client
  const api = getApiClient();

  try {
    // The client automatically sanitizes sensitive headers in any logs
    const users = await api.get('/users');
    console.log('Users:', users.data);

    // POST request with body - sensitive fields are automatically masked
    const newUser = await api.post('/users', {
      name: 'John Doe',
      email: 'john@example.com',
      password: 'secret123', // This will be masked in logs!
    });
    console.log('Created:', newUser.data);

    // Custom headers for specific requests
    const adminData = await api.get('/admin', {
      'X-Admin-Override': 'true',
    });
    console.log('Admin data:', adminData.data);

  } catch (error) {
    console.error('API Error:', error);
  }
}

// Uncomment to run example (requires environment variables):
// exampleUsage();