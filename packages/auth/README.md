# @netreq/auth

JWT authentication plugin for netreq. Handles tokens, auto-refresh, and storage.

## Install

```bash
npm install @netreq/auth
```

## Quick Start

```typescript
import { createClient } from 'netreq';
import { Auth, WebStorage } from '@netreq/auth';

const auth = new Auth({
  storage: new WebStorage('localStorage'),
  refreshEndpoint: '/api/auth/refresh',
  onSessionExpired: () => {
    window.location.href = '/login';
  }
});

const client = createClient({
  baseUrl: 'https://api.example.com'
});

client.use(auth.middleware());

// Login
await auth.login('/api/auth/login', {
  email: 'user@example.com',
  password: 'secret'
});

// All requests now include Authorization header
// 401 responses trigger automatic token refresh
const user = await client.get('/me');
```

## How It Works

1. **Auto Header Injection** - Adds `Authorization: Bearer <token>` to every request
2. **Token Refresh** - On 401 error, automatically refreshes token and retries the request
3. **Request Queue** - While refreshing, other requests wait in queue. After refresh, all retry with new token.
4. **Storage Adapter** - Tokens persist in localStorage/sessionStorage/memory/cookies

## Storage Options

```typescript
import { Auth, MemoryStorage, WebStorage, CookieStorage } from '@netreq/auth';

// Browser with persistence
const auth = new Auth({
  storage: new WebStorage('localStorage', 'myapp_tokens'),
  refreshEndpoint: '/api/auth/refresh'
});

// Server-side / SSR
const auth = new Auth({
  storage: new MemoryStorage(),
  refreshEndpoint: '/api/auth/refresh'
});

// Cookies
const auth = new Auth({
  storage: new CookieStorage({
    name: 'auth',
    secure: true,
    sameSite: 'strict'
  }),
  refreshEndpoint: '/api/auth/refresh'
});
```

## Configuration

```typescript
const auth = new Auth({
  // Required
  refreshEndpoint: '/api/auth/refresh',
  
  // Optional
  storage: new WebStorage('localStorage'),
  refreshMethod: 'POST',
  authHeaderName: 'Authorization',
  tokenPrefix: 'Bearer ',
  maxRefreshRetries: 3,
  refreshTimeout: 10000,
  
  // Transform refresh request/response
  buildRefreshBody: (refreshToken) => ({ token: refreshToken }),
  extractTokenPair: (response) => ({
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token
  }),
  
  // Events
  onLogin: () => console.log('Logged in'),
  onLogout: () => console.log('Logged out'),
  onTokenRefreshed: () => console.log('Token refreshed'),
  onSessionExpired: () => {
    // Redirect to login
    window.location.href = '/login';
  }
});
```

## API Methods

```typescript
// Check auth status
auth.isAuthenticated(); // boolean
auth.getAccessToken();  // string | null

// Manual login/logout
await auth.login('/api/login', { email, password });
await auth.logout();

// Manual token management
await auth.setTokens({
  accessToken: 'xxx',
  refreshToken: 'yyy'
});
```

## Custom Storage

```typescript
import type { TokenStorage, TokenPair } from '@netreq/auth';

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

const auth = new Auth({
  storage: new EncryptedStorage(),
  refreshEndpoint: '/api/auth/refresh'
});
```

## React Example

See [examples/react-integration.ts](examples/react-integration.ts) for full Context API setup.

```typescript
// AuthProvider.tsx
const auth = new Auth({
  storage: new WebStorage('localStorage'),
  refreshEndpoint: '/api/auth/refresh'
});

client.use(auth.middleware());

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  
  const login = async (email, password) => {
    await auth.login('/api/login', { email, password });
    const res = await client.get('/me');
    setUser(res.data);
  };
  
  return (
    <AuthContext.Provider value={{ user, login }}>
      {children}
    </AuthContext.Provider>
  );
}
```

## Requirements

- Node.js 18+
- netreq 0.1.0+

## License

MIT