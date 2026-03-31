# netreq

Lightweight HTTP client for Node.js 18+. Zero dependencies, built on native fetch.

## Why

- **Small**: No dependencies. Uses built-in fetch.
- **Fast**: Native fetch is faster than axios in most cases.
- **Secure**: Automatically masks API keys and passwords in logs.
- **Simple**: One config, reusable everywhere.

## Install

```bash
npm install netreq
```

Requires Node.js 18+.

## Quick Start

```typescript
import { createClient } from 'netreq';

const api = createClient({
  baseUrl: 'https://api.example.com',
  defaultHeaders: {
    'Authorization': `Bearer ${process.env.API_TOKEN}`
  }
});

const users = await api.get('/users');
console.log(users.data);
```

## Secure Config Pattern

Put this in `lib/api.ts`:

```typescript
import { createClient } from 'netreq';

export const api = createClient({
  baseUrl: process.env.API_URL!,
  defaultHeaders: {
    'Authorization': `Bearer ${process.env.API_TOKEN!}`
  },
  sanitize: {
    sensitiveHeaders: ['Authorization'],
    sensitiveBodyKeys: ['password', 'secret']
  }
});
```

Then import anywhere:

```typescript
import { api } from './lib/api';

const user = await api.post('/users', {
  name: 'John',
  password: 'supersecret'  // Masked in logs
});
```

## API

### createClient(config)

Creates a reusable HTTP client instance.

```typescript
const client = createClient({
  baseUrl: 'https://api.example.com',
  defaultHeaders: {},
  timeout: 10000,
  sanitize: {
    sensitiveHeaders: ['authorization', 'x-api-key'],
    sensitiveBodyKeys: ['password', 'secret'],
    replacement: '***REDACTED***'
  }
});
```

### HTTP Methods

```typescript
// GET
const res = await client.get('/users');

// POST with body
const res = await client.post('/users', { name: 'John' });

// PUT, PATCH, DELETE
await client.put('/users/1', { name: 'Jane' });
await client.patch('/users/1', { email: 'new@example.com' });
await client.delete('/users/1');
```

### Custom Headers

```typescript
const res = await client.get('/admin', {
  'X-Admin-Token': 'special'
});
```

## Sanitization

Sensitive data is automatically masked when you use `createLog()`:

```typescript
const logEntry = client.createLog({
  type: 'request',
  method: 'POST',
  url: '/users',
  headers: {
    'Authorization': 'Bearer secret123',
    'Content-Type': 'application/json'
  },
  body: { password: 'mypassword' }
});

// Output:
// headers: { 'Authorization': '***REDACTED***', 'Content-Type': 'application/json' }
// body: { password: '***REDACTED***' }
```

Default sensitive fields:
- Headers: `authorization`, `x-api-key`, `cookie`, `x-auth-token`
- Body keys: `password`, `secret`, `token`, `key`, `apikey`, `credential`

## License

MIT