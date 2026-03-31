# AI Agent Guide: Using netreq

This guide helps AI assistants (Claude, GPT, etc.) write code using netreq correctly.

## Quick Reference

```typescript
import { createClient } from 'netreq';
import { Auth, WebStorage } from '@netreq/auth';

// Basic client
const api = createClient({
  baseUrl: 'https://api.example.com'
});

// With auth
const auth = new Auth({
  storage: new WebStorage('localStorage'),
  refreshEndpoint: '/auth/refresh'
});
api.use(auth.middleware());
```

## Common Patterns

### 1. Simple API Call
```typescript
const users = await api.get('/users');
const user = await api.post('/users', { name: 'John' });
```

### 2. With Headers
```typescript
const res = await api.get('/admin', {
  'X-Admin-Key': 'secret'
});
```

### 3. With Auth (JWT)
```typescript
// Login first
await auth.login('/auth/login', { email, password });

// Subsequent calls auto-include Authorization header
const profile = await api.get('/me');
```

### 4. Error Handling
```typescript
try {
  const res = await api.get('/data');
} catch (error) {
  if (error.message.includes('401')) {
    // Token expired, auth plugin handles refresh automatically
  }
}
```

## When to Use What

| Scenario | Use |
|----------|-----|
| Simple HTTP calls | `createClient()` |
| JWT auth with refresh | `Auth` plugin |
| Need cookies/localStorage | `WebStorage` or `CookieStorage` |
| SSR/Node.js only | `MemoryStorage` |

## Important Rules

1. **Always use `auth.middleware()`** after creating auth instance
2. **Storage must match environment**: `WebStorage` only works in browsers
3. **Never commit sensitive data**: Use env vars for API keys
4. **Log sanitization is automatic**: Passwords and tokens are masked

## Example: Complete Setup

```typescript
import { createClient } from 'netreq';
import { Auth, WebStorage } from '@netreq/auth';

// 1. Create auth
const auth = new Auth({
  storage: new WebStorage('localStorage', 'app_auth'),
  refreshEndpoint: '/api/auth/refresh',
  onSessionExpired: () => {
    window.location.href = '/login';
  }
});

// 2. Create client
const api = createClient({
  baseUrl: process.env.API_URL,
  sanitize: {
    sensitiveHeaders: ['Authorization']
  }
});

// 3. Connect auth
api.use(auth.middleware());

// 4. Login
await auth.login('/api/auth/login', {
  email: 'user@example.com',
  password: 'password'
});

// 5. Make authenticated requests
const data = await api.get('/protected-data');
```

## Storage Adapters

- `MemoryStorage()` - Node.js/SSR, no persistence
- `WebStorage('localStorage')` - Browser, persists across sessions
- `WebStorage('sessionStorage')` - Browser, clears on tab close
- `CookieStorage({name: 'auth'})` - Browser cookies

## Available Methods

**Client:**
- `api.get(path, headers?)`
- `api.post(path, body?, headers?)`
- `api.put(path, body?, headers?)`
- `api.patch(path, body?, headers?)`
- `api.delete(path, headers?)`

**Auth:**
- `auth.login(endpoint, credentials)`
- `auth.logout()`
- `auth.isAuthenticated()`
- `auth.getAccessToken()`

## Environment Variables

```bash
API_URL=https://api.example.com
API_TOKEN=your_token_here
```

## Tips for AI Agents

1. Check if user needs auth - use `Auth` if yes
2. Always suggest proper error handling
3. Remind about storage environment (browser vs Node)
4. Include the `auth.middleware()` call
5. Use `sanitize` option when dealing with sensitive data