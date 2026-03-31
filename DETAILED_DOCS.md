# netreq Documentation

Complete guide for netreq HTTP client and authentication plugin.

## Table of Contents
- [Installation](#installation)
- [Core Client](#core-client)
  - [Basic Usage](#basic-usage)
  - [Configuration](#configuration)
  - [HTTP Methods](#http-methods)
  - [Response Format](#response-format)
  - [Error Handling](#error-handling)
  - [Middleware](#middleware)
  - [Logging & Sanitization](#logging--sanitization)
- [Authentication Plugin](#authentication-plugin)
  - [Setup](#setup)
  - [Token Management](#token-management)
  - [Storage Adapters](#storage-adapters)
  - [Events](#events)
  - [Auto-Refresh Flow](#auto-refresh-flow)
- [API Reference](#api-reference)
- [Examples](#examples)

---

## Installation

### Core Package

```bash
npm install netreq
```

### With Authentication

```bash
npm install netreq netreq-auth
```

**Requirements:** Node.js 18+

---

## Core Client

### Basic Usage

```typescript
import { createClient } from 'netreq';

const api = createClient({
  baseUrl: 'https://api.example.com',
  defaultHeaders: {
    'Content-Type': 'application/json'
  }
});

// GET request
const users = await api.get('/users');
console.log(users.data);

// POST request
const newUser = await api.post('/users', {
  name: 'John Doe',
  email: 'john@example.com'
});
```

### Configuration

```typescript
const client = createClient({
  // Required
  baseUrl: 'https://api.example.com',
  
  // Optional
  defaultHeaders: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  
  timeout: 10000,  // Request timeout in ms (default: 10000)
  
  sanitize: {
    sensitiveHeaders: ['authorization', 'x-api-key'],
    sensitiveBodyKeys: ['password', 'secret', 'token'],
    replacement: '***REDACTED***'
  }
});
```

### HTTP Methods

All methods return a `Promise<ClientResponse<T>>`.

#### GET
```typescript
const response = await api.get('/users');
const response = await api.get('/users/123');
const response = await api.get('/users', {
  'X-Custom-Header': 'value'
});
```

#### POST
```typescript
const response = await api.post('/users', {
  name: 'John',
  email: 'john@example.com'
});

// With custom headers
const response = await api.post(
  '/users',
  { name: 'John' },
  { 'X-Admin-Token': 'secret' }
);
```

#### PUT
```typescript
const response = await api.put('/users/123', {
  name: 'John Updated'
});
```

#### PATCH
```typescript
const response = await api.patch('/users/123', {
  email: 'new@example.com'
});
```

#### DELETE
```typescript
const response = await api.delete('/users/123');
```

#### Generic Request
```typescript
const response = await api.request<User>({
  path: '/users',
  method: 'POST',
  body: { name: 'John' },
  headers: { 'X-Custom': 'value' },
  timeout: 5000
});
```

### Response Format

All responses follow this structure:

```typescript
interface ClientResponse<T> {
  data: T;              // Response body (parsed JSON or text)
  status: number;       // HTTP status code
  statusText: string;   // HTTP status text
  headers: Record<string, string>;  // Response headers
  url: string;          // Final URL (after redirects)
}
```

**Example:**
```typescript
const response = await api.get('/users');

console.log(response.status);      // 200
console.log(response.statusText);  // "OK"
console.log(response.url);         // "https://api.example.com/users"
console.log(response.headers);     // { "content-type": "application/json" }
console.log(response.data);        // [{ id: 1, name: "John" }]
```

### Error Handling

netreq throws errors for:
- Network failures
- Timeouts
- HTTP errors (4xx, 5xx)

```typescript
try {
  const response = await api.get('/users/999');
} catch (error) {
  if (error.message.includes('timeout')) {
    console.error('Request timed out');
  } else if (error.message.includes('401')) {
    console.error('Unauthorized');
  } else if (error.message.includes('404')) {
    console.error('Not found');
  } else {
    console.error('Request failed:', error.message);
  }
}
```

**Note:** HTTP error responses (4xx, 5xx) are still returned as successful responses. Only network failures and timeouts throw.

### Middleware

Middleware allows intercepting requests and responses.

```typescript
const client = createClient({ baseUrl: 'https://api.example.com' });

// Add middleware
client.use({
  onRequest: async (config) => {
    console.log('Request:', config.path);
    return config;
  },
  
  onResponse: async (response, requestConfig) => {
    console.log('Response:', response.status);
    return response;
  },
  
  onError: async (error) => {
    console.error('Error:', error.message);
    return error;
  }
});

// Remove middleware
client.remove(middleware);

// Clear all middlewares
client.clearMiddlewares();
```

### Logging & Sanitization

Automatically mask sensitive data in logs:

```typescript
const client = createClient({
  baseUrl: 'https://api.example.com',
  sanitize: {
    sensitiveHeaders: ['authorization', 'x-api-key'],
    sensitiveBodyKeys: ['password', 'secret', 'token'],
    replacement: '***REDACTED***'
  }
});

// Create sanitized log
const logEntry = client.createLog({
  type: 'request',
  method: 'POST',
  url: '/login',
  headers: {
    'Authorization': 'Bearer secret123',
    'Content-Type': 'application/json'
  },
  body: { 
    email: 'user@example.com',
    password: 'supersecret'
  }
});

// Output:
// {
//   type: 'request',
//   method: 'POST',
//   url: '/login',
//   headers: {
//     'Authorization': '***REDACTED***',
//     'Content-Type': 'application/json'
//   },
//   body: {
//     email: 'user@example.com',
//     password: '***REDACTED***'
//   }
// }
```

**Default sensitive fields:**
- Headers: `authorization`, `x-api-key`, `api-key`, `cookie`, `x-auth-token`, `bearer`
- Body keys: `password`, `secret`, `token`, `key`, `apikey`, `api_key`, `auth`, `credential`

---

## Authentication Plugin

### Setup

```typescript
import { createClient } from 'netreq';
import { Auth, WebStorage } from 'netreq-auth';

// 1. Create auth instance
const auth = new Auth({
  storage: new WebStorage('localStorage', 'myapp_auth'),
  refreshEndpoint: '/api/auth/refresh',
  onSessionExpired: () => {
    window.location.href = '/login';
  }
});

// 2. Create client
const api = createClient({
  baseUrl: 'https://api.example.com'
});

// 3. Apply auth middleware
api.use(auth.middleware());
```

### Token Management

```typescript
// Login
const result = await auth.login('/api/auth/login', {
  email: 'user@example.com',
  password: 'password123'
});

if (result.success) {
  console.log('Logged in:', result.tokens);
} else {
  console.error('Login failed:', result.error);
}

// Check authentication status
if (auth.isAuthenticated()) {
  console.log('Token:', auth.getAccessToken());
}

// Logout
await auth.logout();

// Set tokens manually (e.g., OAuth callback)
await auth.setTokens({
  accessToken: 'xxx',
  refreshToken: 'yyy',
  expiresAt: Date.now() + 3600000  // Optional: expiration timestamp
});
```

### Storage Adapters

Choose where tokens are stored:

#### MemoryStorage (Node.js / SSR)
```typescript
import { Auth, MemoryStorage } from 'netreq-auth';

const auth = new Auth({
  storage: new MemoryStorage(),
  refreshEndpoint: '/api/auth/refresh'
});
// Tokens lost on page refresh
```

#### WebStorage (Browser)
```typescript
import { Auth, WebStorage } from 'netreq-auth';

// LocalStorage - persists across sessions
const auth = new Auth({
  storage: new WebStorage('localStorage', 'myapp_tokens'),
  refreshEndpoint: '/api/auth/refresh'
});

// SessionStorage - cleared when tab closes
const auth = new Auth({
  storage: new WebStorage('sessionStorage', 'myapp_tokens'),
  refreshEndpoint: '/api/auth/refresh'
});
```

#### CookieStorage (Browser)
```typescript
import { Auth, CookieStorage } from 'netreq-auth';

const auth = new Auth({
  storage: new CookieStorage({
    name: 'auth_tokens',
    expires: 7,           // Days
    secure: true,         // HTTPS only
    sameSite: 'strict'    // CSRF protection
  }),
  refreshEndpoint: '/api/auth/refresh'
});
```

#### Custom Storage
```typescript
import type { TokenStorage, TokenPair } from 'netreq-auth';

class EncryptedStorage implements TokenStorage {
  async getTokens(): Promise<TokenPair | null> {
    const encrypted = localStorage.getItem('tokens');
    return encrypted ? decrypt(encrypted) : null;
  }
  
  async setTokens(tokens: TokenPair): Promise<void> {
    localStorage.setItem('tokens', encrypt(tokens));
  }
  
  async clearTokens(): Promise<void> {
    localStorage.removeItem('tokens');
  }
}
```

### Events

Handle authentication lifecycle:

```typescript
const auth = new Auth({
  storage: new WebStorage('localStorage'),
  refreshEndpoint: '/api/auth/refresh',
  
  onLogin: (event, tokens) => {
    console.log('User logged in');
    // Track login analytics
  },
  
  onLogout: () => {
    console.log('User logged out');
    // Clear user cache
  },
  
  onTokenRefreshed: (event, tokens) => {
    console.log('Token refreshed');
  },
  
  onSessionExpired: () => {
    console.log('Session expired');
    window.location.href = '/login';
  }
});
```

### Auto-Refresh Flow

When a request returns 401:

1. **Token Expired Detected** - Request receives 401
2. **Mutex Lock** - Only one refresh request starts
3. **Queue Requests** - Other pending requests wait
4. **Refresh Token** - Call `/api/auth/refresh`
5. **Update Storage** - Save new tokens
6. **Process Queue** - Retry all queued requests with new token
7. **Success** - Original request completes

```
Request 1: 401 → Start Refresh ────────────────→ Retry with new token → Success
Request 2: 401 →    Queue      ────────────────→ Retry with new token → Success
Request 3: 401 →    Queue      ────────────────→ Retry with new token → Success
```

**Benefits:**
- Prevents multiple simultaneous refresh calls
- All requests retry automatically
- Seamless user experience

---

## API Reference

### createClient(config)

Creates HTTP client instance.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| baseUrl | string | Yes | Base API URL |
| defaultHeaders | object | No | Default headers for all requests |
| timeout | number | No | Request timeout in ms (default: 10000) |
| sanitize | object | No | Log sanitization config |

### Client Methods

| Method | Parameters | Returns |
|--------|-----------|---------|
| `get(path, headers?)` | path: string, headers?: object | Promise<ClientResponse<T>> |
| `post(path, body?, headers?)` | path: string, body?: any, headers?: object | Promise<ClientResponse<T>> |
| `put(path, body?, headers?)` | path: string, body?: any, headers?: object | Promise<ClientResponse<T>> |
| `patch(path, body?, headers?)` | path: string, body?: any, headers?: object | Promise<ClientResponse<T>> |
| `delete(path, headers?)` | path: string, headers?: object | Promise<ClientResponse<T>> |
| `request(config)` | config: RequestConfig | Promise<ClientResponse<T>> |
| `use(middleware)` | middleware: Middleware | this |
| `remove(middleware)` | middleware: Middleware | boolean |
| `clearMiddlewares()` | - | void |
| `createLog(entry)` | entry: LogEntry | LogEntry |

### Auth Plugin

| Method | Parameters | Returns |
|--------|-----------|---------|
| `new Auth(options)` | options: AuthOptions | Auth |
| `middleware()` | - | Middleware |
| `login(endpoint, credentials)` | endpoint: string, credentials: object | Promise<LoginResult> |
| `logout()` | - | Promise<void> |
| `isAuthenticated()` | - | boolean |
| `getAccessToken()` | - | string \| null |
| `setTokens(tokens)` | tokens: TokenPair | Promise<void> |

### Response Types

```typescript
interface ClientResponse<T> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  url: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
}

interface LoginResult {
  success: boolean;
  error?: string;
  tokens?: TokenPair;
}
```

---

## Examples

### Basic API Client

```typescript
// api.ts
import { createClient } from 'netreq';

export const api = createClient({
  baseUrl: process.env.API_URL || 'https://api.example.com',
  defaultHeaders: {
    'Content-Type': 'application/json'
  },
  sanitize: {
    sensitiveHeaders: ['Authorization']
  }
});

// usage.ts
import { api } from './api';

export async function getUsers() {
  const response = await api.get('/users');
  return response.data;
}

export async function createUser(data: { name: string; email: string }) {
  const response = await api.post('/users', data);
  return response.data;
}
```

### React with Auth

```typescript
// auth.ts
import { createClient } from 'netreq';
import { Auth, WebStorage } from 'netreq-auth';

export const auth = new Auth({
  storage: new WebStorage('localStorage', 'app_auth'),
  refreshEndpoint: '/api/auth/refresh',
  onSessionExpired: () => {
    window.location.href = '/login';
  }
});

export const api = createClient({
  baseUrl: 'https://api.example.com'
});

api.use(auth.middleware());

// AuthContext.tsx
import { createContext, useContext, useState, useEffect } from 'react';
import { auth, api } from './auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  
  useEffect(() => {
    if (auth.isAuthenticated()) {
      api.get('/me').then(res => setUser(res.data));
    }
  }, []);
  
  const login = async (email, password) => {
    const result = await auth.login('/api/login', { email, password });
    if (result.success) {
      const res = await api.get('/me');
      setUser(res.data);
    }
  };
  
  const logout = async () => {
    await auth.logout();
    setUser(null);
  };
  
  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

### Error Retry Middleware

```typescript
client.use({
  onError: async (error) => {
    // Retry on network errors
    if (error.message.includes('network')) {
      // Retry logic here
    }
    return error;
  }
});
```

### Request Timing

```typescript
client.use({
  onRequest: async (config) => {
    config.__startTime = Date.now();
    return config;
  },
  
  onResponse: async (response, config) => {
    const duration = Date.now() - (config as any).__startTime;
    console.log(`Request took ${duration}ms`);
    return response;
  }
});
```

---

## TypeScript

Both packages are fully typed:

```typescript
import { createClient, type Client, type ClientResponse } from 'netreq';
import { Auth, type TokenPair, type TokenStorage } from 'netreq-auth';

const api: Client = createClient({ baseUrl: 'https://api.example.com' });

const response: ClientResponse<User[]> = await api.get('/users');
```

## License

MIT