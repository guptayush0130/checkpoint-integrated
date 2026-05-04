/**
 * URL 1 client — talks to the external target agent's text endpoint.
 *
 * Three profiles cover the deployment shapes we've seen in the wild:
 *
 *   default      POST { conversation_id, user_message }
 *                  → { response, done? }
 *
 *   openai-chat  POST { messages: [{ role, content }, ...] }
 *                  → { choices: [{ message: { content } }] }
 *
 *   custom       Request body built from `requestTemplate` with placeholder
 *                substitution; response extracted via dot-path through
 *                `responseJsonPath`. Use for anything non-standard.
 *
 * Conversation strategies: `session-id` (just send the latest user_message
 * and trust the target's memory) and `replay-history` (resend the full
 * transcript every turn). The MCTS replay-from-root loop forces the latter
 * regardless of configuration — the target's session state may have drifted
 * during sandbox reset.
 */

export type TargetProfile = 'default' | 'openai-chat' | 'custom';

export type ConversationStrategy = 'session-id' | 'replay-history';

export interface ConversationTurn {
  role: 'tester' | 'agent';
  content: string;
}

export interface TargetAuthConfig {
  /**
   * `bearer`  — adds `Authorization: Bearer <value>`.
   * `header`  — adds `<header>: <value>` (defaults to `X-API-Key`).
   * `none`    — explicit no-auth.
   */
  kind: 'bearer' | 'header' | 'none';
  value?: string;
  header?: string;
}

export interface TargetEndpointConfig {
  url: string;
  profile: TargetProfile;
  auth?: TargetAuthConfig;
  /**
   * Used only when `profile === 'custom'`. The body is JSON-stringified after
   * placeholder substitution: `{{user_message}}`, `{{conversation_id}}`,
   * `{{history_json}}`, `{{history_text}}`.
   */
  requestTemplate?: any;
  /**
   * Used only when `profile === 'custom'`. Dot-path through the response JSON
   * (e.g. `choices.0.message.content` or `data.text`).
   */
  responseJsonPath?: string;
  conversationStrategy: ConversationStrategy;
  /** Default 60_000. Aborted via AbortController. */
  timeoutMs?: number;
  /**
   * Extra static headers to include on every request (in addition to auth).
   */
  headers?: Record<string, string>;
  /**
   * Sandbox runtime env (URL 2). When set, the engine attaches it to every
   * request body so the external target can point its supabase-js client at
   * our sandbox — turning every tool call into a sandbox.intercept event.
   *
   * Default profile body gains: `{ sandbox: { url, anon_key } }`.
   * openai-chat profile body gains the same field.
   * custom profile gets `{{sandbox_url}}` + `{{sandbox_anon_key}}` placeholders.
   */
  sandbox?: { url: string; anonKey: string };
}

export interface TargetReply {
  response: string;
  done: boolean;
  /** Raw decoded response body, useful for the dashboard's debug pane. */
  raw?: any;
  /** HTTP status. */
  status: number;
  /** Wall-clock duration of the request. */
  durationMs: number;
}

export interface TargetSendOptions {
  conversationId: string;
  userMessage: string;
  /**
   * Full transcript so far. Required when the configured strategy is
   * `replay-history`, ignored otherwise. Pass an empty array on the first turn.
   */
  history?: ConversationTurn[];
  /**
   * Override the configured strategy. The MCTS replay-from-root loop sets
   * this to `replay-history` even when the run config says `session-id`.
   */
  strategyOverride?: ConversationStrategy;
}

export class TargetClient {
  constructor(private readonly cfg: TargetEndpointConfig) {
    if (!cfg.url) throw new Error('TargetClient: url is required');
    if (cfg.profile === 'custom' && !cfg.responseJsonPath) {
      throw new Error("TargetClient: profile 'custom' requires responseJsonPath");
    }
    if (cfg.profile === 'custom' && cfg.requestTemplate === undefined) {
      throw new Error("TargetClient: profile 'custom' requires requestTemplate");
    }
  }

  async send(opts: TargetSendOptions): Promise<TargetReply> {
    const strategy = opts.strategyOverride ?? this.cfg.conversationStrategy;
    const body = this.buildBody(opts, strategy);
    const headers = this.buildHeaders();

    const controller = new AbortController();
    const timeoutMs = this.cfg.timeoutMs ?? 60_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const startedAt = Date.now();
    let res: Response;
    try {
      res = await fetch(this.cfg.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err: any) {
      clearTimeout(timer);
      if (err?.name === 'AbortError') {
        throw new Error(`TargetClient: request timed out after ${timeoutMs}ms`);
      }
      throw new Error(`TargetClient: fetch failed: ${err?.message || String(err)}`);
    }
    clearTimeout(timer);

    const durationMs = Date.now() - startedAt;
    const text = await res.text();
    let raw: any;
    try {
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = text;
    }

    if (!res.ok) {
      const errMsg =
        (raw && typeof raw === 'object' && (raw.error || raw.message)) ||
        text ||
        `HTTP ${res.status}`;
      throw new Error(`TargetClient: target returned ${res.status}: ${errMsg}`);
    }

    return {
      response: this.extractResponse(raw),
      done: this.extractDone(raw),
      raw,
      status: res.status,
      durationMs
    };
  }

  // ------------------------------------------------------------------------
  // request body construction
  // ------------------------------------------------------------------------

  private buildBody(opts: TargetSendOptions, strategy: ConversationStrategy): any {
    const history = opts.history ?? [];
    const sandboxBlock = this.cfg.sandbox
      ? { url: this.cfg.sandbox.url, anon_key: this.cfg.sandbox.anonKey }
      : undefined;
    switch (this.cfg.profile) {
      case 'default': {
        const base =
          strategy === 'replay-history'
            ? {
                conversation_id: opts.conversationId,
                user_message: opts.userMessage,
                history: history.map((t) => ({ role: t.role, content: t.content }))
              }
            : { conversation_id: opts.conversationId, user_message: opts.userMessage };
        return sandboxBlock ? { ...base, sandbox: sandboxBlock } : base;
      }

      case 'openai-chat': {
        const messages = history.map((t) => ({
          role: t.role === 'tester' ? 'user' : 'assistant',
          content: t.content
        }));
        messages.push({ role: 'user', content: opts.userMessage });
        const base =
          strategy === 'replay-history'
            ? { messages }
            : { messages: [{ role: 'user', content: opts.userMessage }] };
        return sandboxBlock ? { ...base, sandbox: sandboxBlock } : base;
      }

      case 'custom':
        return substitutePlaceholders(this.cfg.requestTemplate, {
          user_message: opts.userMessage,
          conversation_id: opts.conversationId,
          history_json: JSON.stringify(history),
          history_text: history.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join('\n'),
          sandbox_url: this.cfg.sandbox?.url || '',
          sandbox_anon_key: this.cfg.sandbox?.anonKey || ''
        });
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.cfg.headers || {})
    };
    const auth = this.cfg.auth;
    if (auth && auth.kind === 'bearer' && auth.value) {
      headers['Authorization'] = `Bearer ${auth.value}`;
    } else if (auth && auth.kind === 'header' && auth.value) {
      headers[auth.header || 'X-API-Key'] = auth.value;
    }
    return headers;
  }

  // ------------------------------------------------------------------------
  // response extraction
  // ------------------------------------------------------------------------

  private extractResponse(raw: any): string {
    switch (this.cfg.profile) {
      case 'default': {
        const v = raw?.response;
        return typeof v === 'string' ? v : JSON.stringify(v ?? '');
      }
      case 'openai-chat': {
        const v = raw?.choices?.[0]?.message?.content;
        return typeof v === 'string' ? v : JSON.stringify(v ?? '');
      }
      case 'custom': {
        const v = readDotPath(raw, this.cfg.responseJsonPath || '');
        return typeof v === 'string' ? v : JSON.stringify(v ?? '');
      }
    }
  }

  private extractDone(raw: any): boolean {
    if (raw && typeof raw === 'object' && typeof raw.done === 'boolean') return raw.done;
    return false;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;

/**
 * Walks an arbitrary JSON value and replaces `{{key}}` placeholders inside
 * any string with values from `bindings`. Unknown placeholders are left
 * literal so the caller's mistake surfaces in the request rather than
 * silently becoming `undefined`.
 */
export function substitutePlaceholders(value: any, bindings: Record<string, string>): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER_RE, (match, key) =>
      bindings[key] !== undefined ? bindings[key] : match
    );
  }
  if (Array.isArray(value)) return value.map((v) => substitutePlaceholders(v, bindings));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substitutePlaceholders(v, bindings);
    }
    return out;
  }
  return value;
}

/**
 * Tiny dot-path resolver. Supports nested keys and numeric array indexes:
 *   readDotPath({ data: { items: [{ name: "x" }] } }, "data.items.0.name") === "x"
 */
export function readDotPath(value: any, path: string): any {
  if (!path) return value;
  const parts = path.split('.');
  let cur: any = value;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}
