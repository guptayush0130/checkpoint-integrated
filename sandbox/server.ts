import http from 'node:http';
import { AddressInfo } from 'node:net';
import { URL } from 'node:url';
import { PostgrestHandler, PostgrestRequest } from './postgrest';
import { AuthHandler } from './auth';
import { StorageHandler, StorageRequest } from './storage';
import { MockDatabase } from './database';

export interface MockServerOptions {
  port?: number;
  host?: string;
  /**
   * Called once per intercepted request *after* the response is dispatched.
   * The MCTS engine and the dashboard subscribe to this to render the
   * "intercepted Supabase tool calls" panel in real time.
   */
  onIntercept?: (event: SandboxInterceptEvent) => void;
}

export interface SandboxInterceptEvent {
  ts: string;
  method: string;
  surface: 'rest' | 'auth' | 'storage' | 'meta';
  path: string;
  query?: Record<string, string>;
  requestBody?: any;
  status: number;
  responsePreview?: any;
  durationMs: number;
}

export class MockSupabaseServer {
  private server: http.Server;
  private postgrest: PostgrestHandler;
  private auth: AuthHandler;
  private storage: StorageHandler;
  private db: MockDatabase;
  private boundUrl: string | null = null;
  private onIntercept?: (event: SandboxInterceptEvent) => void;

  constructor(db: MockDatabase, auth: AuthHandler, storage: StorageHandler) {
    this.db = db;
    this.postgrest = new PostgrestHandler(db);
    this.auth = auth;
    this.storage = storage;

    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        respondJson(res, 500, { code: '500', message: err?.message || String(err) });
      });
    });
  }

  setInterceptor(fn: ((event: SandboxInterceptEvent) => void) | undefined) {
    this.onIntercept = fn;
  }

  start(options: MockServerOptions = {}): Promise<string> {
    if (options.onIntercept) this.onIntercept = options.onIntercept;
    return new Promise((resolve, reject) => {
      const port = options.port ?? 0;
      const host = options.host ?? '127.0.0.1';
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        const address = this.server.address() as AddressInfo;
        this.boundUrl = `http://${address.address}:${address.port}`;
        resolve(this.boundUrl);
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
    this.boundUrl = null;
  }

  url(): string {
    if (!this.boundUrl) throw new Error('Server has not been started.');
    return this.boundUrl;
  }

  private emit(event: SandboxInterceptEvent) {
    if (!this.onIntercept) return;
    try {
      this.onIntercept(event);
    } catch {
      // never let a subscriber error take down the request
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const startedAt = Date.now();
    const url = new URL(req.url || '/', this.boundUrl || 'http://localhost');
    const headers = normalizeHeaders(req.headers);
    const rawBody = await readBody(req);
    const body = parseBodyForPath(url.pathname, headers['content-type'] || '', rawBody);

    if (url.pathname.startsWith('/rest/v1/')) {
      const tablePath = url.pathname.replace(/^\/rest\/v1\//, '');
      const pgrequest: PostgrestRequest = {
        method: req.method as PostgrestRequest['method'],
        path: tablePath,
        query: url.searchParams,
        headers,
        body
      };
      const response = await this.postgrest.handle(pgrequest);
      respondJson(res, response.status, response.body, response.headers);
      this.emit({
        ts: new Date().toISOString(),
        method: req.method || 'GET',
        surface: 'rest',
        path: tablePath,
        query: searchParamsToObject(url.searchParams),
        requestBody: previewValue(body),
        status: response.status,
        responsePreview: previewValue(response.body),
        durationMs: Date.now() - startedAt
      });
      return;
    }

    if (url.pathname.startsWith('/auth/v1/')) {
      const authPath = url.pathname.replace(/^\/auth\/v1\//, '');
      const bearer = extractBearer(headers);
      const user = this.auth.authorizeBearer(bearer);
      const result = await this.auth.handle(
        req.method || 'GET',
        authPath,
        url.searchParams,
        authPath === 'user' ? user : body
      );
      respondJson(res, result.status, result.body);
      this.emit({
        ts: new Date().toISOString(),
        method: req.method || 'GET',
        surface: 'auth',
        path: authPath,
        query: searchParamsToObject(url.searchParams),
        requestBody: previewValue(redactAuthBody(body)),
        status: result.status,
        responsePreview: previewValue(redactAuthResponse(result.body)),
        durationMs: Date.now() - startedAt
      });
      return;
    }

    if (url.pathname.startsWith('/storage/v1/')) {
      const storagePath = url.pathname.replace(/^\/storage\/v1\//, '');
      const sreq: StorageRequest = {
        method: req.method || 'GET',
        path: storagePath,
        headers,
        body:
          storagePath.startsWith('object/') &&
          req.method !== 'GET' &&
          headers['content-type'] &&
          !headers['content-type'].includes('application/json')
            ? rawBody
            : body,
        query: url.searchParams
      };
      const response = await this.storage.handle(sreq);
      if (Buffer.isBuffer(response.body)) {
        res.statusCode = response.status;
        for (const [k, v] of Object.entries(response.headers || {})) {
          res.setHeader(k, v);
        }
        res.end(response.body);
      } else {
        respondJson(res, response.status, response.body, response.headers);
      }
      this.emit({
        ts: new Date().toISOString(),
        method: req.method || 'GET',
        surface: 'storage',
        path: storagePath,
        query: searchParamsToObject(url.searchParams),
        requestBody: Buffer.isBuffer(sreq.body)
          ? `<binary ${sreq.body.length} bytes>`
          : previewValue(sreq.body),
        status: response.status,
        responsePreview: Buffer.isBuffer(response.body)
          ? `<binary ${response.body.length} bytes>`
          : previewValue(response.body),
        durationMs: Date.now() - startedAt
      });
      return;
    }

    if (url.pathname === '/health' || url.pathname === '/healthz' || url.pathname === '/') {
      respondJson(res, 200, { healthy: true, service: 'supabase-mock' });
      return;
    }

    respondJson(res, 404, { code: '404', message: `Not found: ${url.pathname}` });
    this.emit({
      ts: new Date().toISOString(),
      method: req.method || 'GET',
      surface: 'meta',
      path: url.pathname,
      status: 404,
      durationMs: Date.now() - startedAt
    });
  }
}

function setCors(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, apikey, content-type, prefer, accept, x-client-info, range, x-supabase-api-version'
  );
  res.setHeader('Access-Control-Expose-Headers', 'content-range, range, preference-applied');
}

function normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) out[k.toLowerCase()] = v.join(',');
    else if (typeof v === 'string') out[k.toLowerCase()] = v;
  }
  return out;
}

function extractBearer(headers: Record<string, string>): string | undefined {
  const auth = headers['authorization'] || headers['Authorization'];
  if (!auth) return undefined;
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return auth;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseBodyForPath(_pathname: string, contentType: string, raw: Buffer): any {
  if (!raw || raw.length === 0) return undefined;
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return raw.toString('utf8');
    }
  }
  if (contentType.includes('text/')) {
    return raw.toString('utf8');
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw.toString('utf8'));
    const out: Record<string, string> = {};
    params.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return raw;
}

function respondJson(
  res: http.ServerResponse,
  status: number,
  body: any,
  extraHeaders: Record<string, string> = {}
) {
  res.statusCode = status;
  if (!extraHeaders['Content-Type']) {
    res.setHeader('Content-Type', 'application/json');
  }
  for (const [k, v] of Object.entries(extraHeaders)) {
    res.setHeader(k, v);
  }
  if (body === null || body === undefined) {
    res.end();
    return;
  }
  if (typeof body === 'string') {
    res.end(body);
    return;
  }
  res.end(JSON.stringify(body));
}

function searchParamsToObject(params: URLSearchParams): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let any = false;
  params.forEach((value, key) => {
    out[key] = value;
    any = true;
  });
  return any ? out : undefined;
}

const PREVIEW_MAX_CHARS = 600;

function previewValue(value: any): any {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
  if (typeof value === 'string') {
    return value.length > PREVIEW_MAX_CHARS ? value.slice(0, PREVIEW_MAX_CHARS) + '…' : value;
  }
  if (Array.isArray(value)) {
    const trimmed = value.slice(0, 3).map(previewValue);
    return value.length > 3 ? [...trimmed, `<+${value.length - 3} more>`] : trimmed;
  }
  if (typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length <= PREVIEW_MAX_CHARS) return value;
      return JSON.parse(serialized.slice(0, PREVIEW_MAX_CHARS - 1) + '"…"');
    } catch {
      return '<unserializable>';
    }
  }
  return value;
}

function redactAuthBody(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const clone: any = { ...body };
  if ('password' in clone) clone.password = '<redacted>';
  if ('refresh_token' in clone) clone.refresh_token = '<redacted>';
  return clone;
}

function redactAuthResponse(body: any): any {
  return redactSecretsDeep(body, new Set(['password', 'access_token', 'refresh_token']));
}

function redactSecretsDeep(value: any, keys: Set<string>): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactSecretsDeep(v, keys));
  if (typeof value !== 'object') return value;
  const out: any = {};
  for (const [k, v] of Object.entries(value)) {
    if (keys.has(k)) out[k] = '<redacted>';
    else out[k] = redactSecretsDeep(v, keys);
  }
  return out;
}
