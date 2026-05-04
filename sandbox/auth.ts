import crypto from 'node:crypto';

/**
 * In-process mock of /auth/v1 endpoints. We don't enforce real RLS — agents
 * just need successful sign-in/sign-up + a usable JWT for `apikey` /
 * `Authorization` headers. Keys are deterministic per instance.
 */
export interface AuthUser {
  id: string;
  email: string;
  role: 'authenticated' | 'service_role' | 'anon';
  user_metadata: Record<string, any>;
  app_metadata: Record<string, any>;
  created_at: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  expires_at: number;
  user: AuthUser;
}

export class AuthHandler {
  private users = new Map<string, AuthUser & { password?: string }>();
  private secret: Buffer;
  public readonly anonKey: string;
  public readonly serviceRoleKey: string;

  constructor(seed = 'mock-supabase-instance') {
    this.secret = crypto.createHash('sha256').update(`secret:${seed}`).digest();
    this.anonKey = this.signKey('anon', { iss: 'supabase-mock', role: 'anon' });
    this.serviceRoleKey = this.signKey('service', { iss: 'supabase-mock', role: 'service_role' });
  }

  // ------------- public API used by server -------------

  async handle(method: string, path: string, query: URLSearchParams, body: any): Promise<{
    status: number;
    body: any;
  }> {
    if (path === 'health' || path === 'settings') {
      return {
        status: 200,
        body: {
          version: 'mock',
          name: 'supabase-mock-auth',
          external: { email: { enabled: true } },
          mailer_autoconfirm: true,
          phone_autoconfirm: true,
          disable_signup: false
        }
      };
    }
    if (path === 'signup' && method === 'POST') {
      return this.signUp(body);
    }
    if (path === 'token' && method === 'POST') {
      const grantType = query.get('grant_type') || body?.grant_type || 'password';
      return this.token(grantType, body);
    }
    if (path === 'logout' && method === 'POST') {
      return { status: 204, body: null };
    }
    if (path === 'user' && method === 'GET') {
      return this.getUserFromHeader(body);
    }
    if (path === 'admin/users' && method === 'GET') {
      return {
        status: 200,
        body: {
          users: Array.from(this.users.values()).map((u) => ({
            ...u,
            password: undefined
          })),
          aud: 'authenticated'
        }
      };
    }
    if (path === 'admin/users' && method === 'POST') {
      return this.adminCreateUser(body);
    }

    return { status: 404, body: { code: '404', message: `Auth endpoint not found: ${path}` } };
  }

  authorizeBearer(token: string | undefined): AuthUser | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const expected = this.sign(`${parts[0]}.${parts[1]}`);
    if (parts[2] !== expected) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (!payload.sub) return null;
      const user = this.users.get(payload.sub);
      if (user) return user;
      // Service-role / anon tokens don't have a sub user; expose synthetic identity
      if (payload.role === 'service_role') {
        return { id: 'service-role', email: 'service@mock', role: 'service_role', user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() };
      }
      if (payload.role === 'anon') {
        return { id: 'anon', email: 'anon@mock', role: 'anon', user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() };
      }
      return null;
    } catch {
      return null;
    }
  }

  // ------------- handlers -------------

  private signUp(body: any) {
    const email = String(body?.email || '').toLowerCase();
    if (!email) {
      return { status: 400, body: { code: '400', message: 'email is required' } };
    }
    const existing = Array.from(this.users.values()).find((u) => u.email === email);
    if (existing) {
      return { status: 422, body: { code: '422', message: 'User already registered' } };
    }
    const user: AuthUser & { password?: string } = {
      id: crypto.randomUUID(),
      email,
      role: 'authenticated',
      user_metadata: body?.data || {},
      app_metadata: { provider: 'email' },
      created_at: new Date().toISOString(),
      password: body?.password
    };
    this.users.set(user.id, user);
    const session = this.buildSession(user);
    return { status: 200, body: session };
  }

  private adminCreateUser(body: any) {
    const email = String(body?.email || '').toLowerCase();
    if (!email) {
      return { status: 400, body: { code: '400', message: 'email is required' } };
    }
    const user: AuthUser & { password?: string } = {
      id: body?.id || crypto.randomUUID(),
      email,
      role: 'authenticated',
      user_metadata: body?.user_metadata || {},
      app_metadata: body?.app_metadata || {},
      created_at: new Date().toISOString(),
      password: body?.password
    };
    this.users.set(user.id, user);
    return { status: 200, body: { ...user, password: undefined } };
  }

  private token(grantType: string, body: any) {
    if (grantType === 'password') {
      const email = String(body?.email || '').toLowerCase();
      const password = String(body?.password || '');
      const user = Array.from(this.users.values()).find((u) => u.email === email);
      if (!user || (user.password && user.password !== password)) {
        return { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials' } };
      }
      return { status: 200, body: this.buildSession(user) };
    }
    if (grantType === 'refresh_token') {
      const sub = body?.refresh_token;
      const user = sub ? this.users.get(sub) : undefined;
      if (!user) {
        return { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid refresh token' } };
      }
      return { status: 200, body: this.buildSession(user) };
    }
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  }

  private getUserFromHeader(authorizedUser: AuthUser | null | any) {
    const user = authorizedUser as AuthUser | null;
    if (!user) return { status: 401, body: { code: '401', message: 'Missing or invalid token' } };
    return { status: 200, body: { ...user, password: undefined } };
  }

  // ------------- helpers -------------

  private buildSession(user: AuthUser): AuthSession {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600;
    const access = this.signKey('access', {
      iss: 'supabase-mock',
      aud: 'authenticated',
      role: user.role,
      sub: user.id,
      email: user.email,
      iat: now,
      exp
    });
    return {
      access_token: access,
      refresh_token: user.id,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: exp,
      user: { ...user }
    };
  }

  private signKey(_kind: string, payload: Record<string, any>): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.sign(`${headerB64}.${payloadB64}`);
    return `${headerB64}.${payloadB64}.${signature}`;
  }

  private sign(input: string): string {
    return crypto.createHmac('sha256', this.secret).update(input).digest('base64url');
  }
}
