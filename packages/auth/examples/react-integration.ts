/**
 * @fileoverview React integration example for @netreq/auth.
 * Demonstrates how to integrate the auth plugin with a React application
 * using Context API for global state management.
 */

import { createClient, type Client } from 'netreq';
import { 
  Auth, 
  WebStorage, 
  type TokenPair,
  type SessionEvent 
} from '@netreq/auth';
import React, { 
  createContext, 
  useContext, 
  useEffect, 
  useState, 
  useCallback 
} from 'react';

// =============================================================================
// STEP 1: Initialize Auth and HTTP Client
// =============================================================================

/**
 * Create the auth instance with configuration.
 * In a real app, these values would come from environment variables.
 */
const auth = new Auth({
  // Use localStorage to persist tokens across sessions
  storage: typeof window !== 'undefined' 
    ? new WebStorage('localStorage', 'myapp_auth')
    : undefined, // Falls back to MemoryStorage on SSR
  
  // Your API's token refresh endpoint
  refreshEndpoint: '/api/auth/refresh',
  
  // Optional: Custom token extraction if your API returns non-standard format
  extractTokenPair: (response: { data: { accessToken: string; refreshToken: string } }) => ({
    accessToken: response.data.accessToken,
    refreshToken: response.data.refreshToken,
  }),
  
  // Event handlers for session state changes
  onLogin: () => {
    console.log('User logged in');
  },
  
  onLogout: () => {
    console.log('User logged out');
  },
  
  onTokenRefreshed: () => {
    console.log('Token refreshed successfully');
  },
  
  onSessionExpired: () => {
    console.log('Session expired - redirecting to login');
    // React Router or window.location redirect would happen here
    window.location.href = '/login';
  },
});

/**
 * Create the HTTP client and apply auth middleware.
 */
const apiClient = createClient({
  baseUrl: process.env.REACT_APP_API_URL || 'https://api.example.com',
  defaultHeaders: {
    'Content-Type': 'application/json',
  },
});

// Apply the auth middleware to the client
// This enables automatic token injection and 401 handling
apiClient.use(auth.middleware());

// =============================================================================
// STEP 2: Create React Context for Auth State
// =============================================================================

interface AuthContextType {
  /** Whether user is currently authenticated */
  isAuthenticated: boolean;
  /** Whether auth state is still loading */
  isLoading: boolean;
  /** Current user data (null if not logged in) */
  user: User | null;
  /** Login function */
  login: (email: string, password: string) => Promise<void>;
  /** Logout function */
  logout: () => Promise<void>;
  /** The configured HTTP client with auth */
  client: Client;
}

interface User {
  id: string;
  email: string;
  name: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

// =============================================================================
// STEP 3: Auth Provider Component
// =============================================================================

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Check if we have a token
        if (auth.isAuthenticated()) {
          // Fetch current user data
          const response = await apiClient.get<{ user: User }>('/me');
          setUser(response.data.user);
          setIsAuthenticated(true);
        }
      } catch (error) {
        // Token exists but invalid - will be handled by onSessionExpired
        console.error('Auth check failed:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Login handler
  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    
    try {
      // Use auth login method
      const result = await auth.login('/api/auth/login', {
        email,
        password,
      });

      if (!result.success) {
        throw new Error(result.error || 'Login failed');
      }

      // Fetch user data after successful login
      const response = await apiClient.get<{ user: User }>('/me');
      setUser(response.data.user);
      setIsAuthenticated(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Logout handler
  const logout = useCallback(async () => {
    setIsLoading(true);
    
    try {
      // Call logout API endpoint (optional)
      await apiClient.post('/api/auth/logout');
    } catch {
      // Ignore logout API errors
    } finally {
      // Always clear local state
      await auth.logout();
      setUser(null);
      setIsAuthenticated(false);
      setIsLoading(false);
    }
  }, []);

  const value: AuthContextType = {
    isAuthenticated,
    isLoading,
    user,
    login,
    logout,
    client: apiClient,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// =============================================================================
// STEP 4: Custom Hook for Using Auth
// =============================================================================

export function useAuth() {
  const context = useContext(AuthContext);
  
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  
  return context;
}

// =============================================================================
// STEP 5: Usage Examples
// =============================================================================

/**
 * Example: Login Form Component
 */
function LoginForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    try {
      await login(email, password);
      // Redirect happens automatically in AuthProvider after successful login
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}
      
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
      />
      
      <button type="submit">Login</button>
    </form>
  );
}

/**
 * Example: Protected Data Fetching
 */
function UserProfile() {
  const { client, user, logout } = useAuth();
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    // This request automatically includes Authorization header
    // If token expires during this request:
    // 1. Plugin receives 401
    // 2. Plugin initiates token refresh (mutex locked)
    // 3. This request is queued
    // 4. After successful refresh, request retries automatically with new token
    // 5. Response resolves normally - you don't handle 401 manually!
    
    client.get('/posts').then((response) => {
      setPosts(response.data);
    });
  }, [client]);

  return (
    <div>
      <h1>Welcome {user?.name}</h1>
      <button onClick={logout}>Logout</button>
      
      <ul>
        {posts.map((post: { id: string; title: string }) => (
          <li key={post.id}>{post.title}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Example: App Component with Provider
 */
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<LoginForm />} />
          <Route 
            path="/*" 
            element={
              <ProtectedRoute>
                <UserProfile />
              </ProtectedRoute>
            } 
          />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

/**
 * Example: Protected Route Component
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

// =============================================================================
// Advanced: Token Refresh Queue Visualization
// =============================================================================

/**
 * When multiple requests fail with 401 simultaneously (e.g., on page load),
 * the plugin's mutex pattern works like this:
 * 
 * Request 1: 401 received -> Start refresh -> Await new token
 * Request 2: 401 received -> Refresh in progress -> Add to queue
 * Request 3: 401 received -> Refresh in progress -> Add to queue
 * 
 * Refresh completes with new token
 * ├─├─ Request 1: Retry with new token -> Success
 * ├─├─ Request 2: Retry with new token -> Success  
 * └─└─ Request 3: Retry with new token -> Success
 * 
 * Without this pattern, all 3 requests would trigger separate refresh calls,
 * causing race conditions and potentially invalidating each other's tokens.
 */