import { MockDatabase, quoteIdent } from './database';

/**
 * Translates PostgREST-style HTTP requests into SQL against PGlite.
 *
 * Targets the subset of PostgREST that @supabase/supabase-js emits:
 *   GET    /rest/v1/{table}?select=&filter=op.value&order=&limit=&offset=
 *   POST   /rest/v1/{table}                (insert / upsert)
 *   PATCH  /rest/v1/{table}?filter=...     (update)
 *   DELETE /rest/v1/{table}?filter=...     (delete)
 *   POST   /rest/v1/rpc/{function}         (rpc)
 *
 * Supported filter operators (mirrors PostgREST docs):
 *   eq, neq, gt, gte, lt, lte, like, ilike, match, imatch,
 *   in, is, fts, plfts, phfts, wfts, cs, cd, ov, sl, sr, nxr, nxl, adj
 * Plus modifiers: not.<op>, or=(...), and=(...).
 *
 * Headers honored: apikey, Authorization, Range, Prefer
 *   Prefer: return=representation|minimal|headers-only
 *   Prefer: count=exact|planned|estimated
 *   Prefer: resolution=merge-duplicates|ignore-duplicates
 *   Prefer: missing=default
 *   Accept: application/vnd.pgrst.object+json  (single-row response)
 */

export interface PostgrestRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS';
  path: string; // path under /rest/v1/, e.g. "users" or "rpc/my_func"
  query: URLSearchParams;
  headers: Record<string, string>;
  body: any;
}

export interface PostgrestResponse {
  status: number;
  body: any;
  headers: Record<string, string>;
}

export class PostgrestHandler {
  constructor(private db: MockDatabase) {}

  async handle(req: PostgrestRequest): Promise<PostgrestResponse> {
    try {
      if (req.path.startsWith('rpc/')) {
        return await this.handleRpc(req);
      }

      switch (req.method) {
        case 'GET':
          return await this.handleSelect(req);
        case 'HEAD':
          return await this.handleHead(req);
        case 'POST':
          return await this.handleInsertOrUpsert(req);
        case 'PATCH':
        case 'PUT':
          return await this.handleUpdate(req);
        case 'DELETE':
          return await this.handleDelete(req);
        default:
          return errorResponse(405, 'method_not_allowed', `Method ${req.method} not allowed`);
      }
    } catch (err: any) {
      return mapPgError(err);
    }
  }

  // ---------- SELECT ----------

  private async handleSelect(req: PostgrestRequest): Promise<PostgrestResponse> {
    const table = req.path;
    const sqlInfo = this.buildSelectSql(table, req.query);
    const result = await this.db.query(sqlInfo.sql, sqlInfo.params);
    const rows = result.rows;
    const total = await this.maybeCount(table, req, sqlInfo);
    const headers = this.contentRangeHeaders(rows.length, sqlInfo.offset, total);

    if (this.wantsSingle(req)) {
      if (rows.length === 0) {
        return errorResponse(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
      }
      if (rows.length > 1 && !this.allowsMaybe(req)) {
        return errorResponse(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
      }
      return { status: 200, body: rows[0], headers };
    }

    if (this.wantsMaybeSingle(req)) {
      if (rows.length > 1) {
        return errorResponse(406, 'PGRST116', 'JSON object requested, multiple rows returned');
      }
      return { status: 200, body: rows[0] || null, headers };
    }

    return { status: 200, body: rows, headers };
  }

  private async handleHead(req: PostgrestRequest): Promise<PostgrestResponse> {
    const table = req.path;
    const sqlInfo = this.buildSelectSql(table, req.query);
    const result = await this.db.query(sqlInfo.sql, sqlInfo.params);
    const total = await this.maybeCount(table, req, sqlInfo);
    const headers = this.contentRangeHeaders(result.rows.length, sqlInfo.offset, total);
    return { status: 200, body: null, headers };
  }

  // ---------- INSERT / UPSERT ----------

  private async handleInsertOrUpsert(req: PostgrestRequest): Promise<PostgrestResponse> {
    const table = req.path;
    if (!req.body) {
      return errorResponse(400, 'PGRST102', 'Empty body for insert');
    }
    const rows = Array.isArray(req.body) ? req.body : [req.body];
    if (rows.length === 0) {
      return { status: 201, body: [], headers: { 'Content-Type': 'application/json' } };
    }

    const prefer = parsePrefer(req.headers['prefer']);
    const onConflict = req.query.get('on_conflict');
    const isUpsert = prefer.resolution === 'merge-duplicates' || prefer.resolution === 'ignore-duplicates';

    const allColumns = Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));
    if (allColumns.length === 0) {
      return errorResponse(400, 'PGRST102', 'No columns supplied for insert');
    }

    const params: any[] = [];
    const valueRows = rows.map((row) => {
      const cells = allColumns.map((col) => {
        const value = row[col];
        return pushParam(params, value);
      });
      return `(${cells.join(', ')})`;
    });

    let sql = `INSERT INTO ${quoteIdent(table)} (${allColumns.map(quoteIdent).join(', ')}) VALUES ${valueRows.join(', ')}`;

    if (isUpsert) {
      const conflictCols = onConflict
        ? onConflict.split(',').map((c) => quoteIdent(c.trim())).join(', ')
        : await this.detectPrimaryKey(table);
      if (!conflictCols) {
        return errorResponse(400, '42P10', 'No conflict target available for upsert');
      }
      if (prefer.resolution === 'ignore-duplicates') {
        sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
      } else {
        const updates = allColumns
          .filter((c) => !conflictCols.includes(quoteIdent(c)))
          .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
          .join(', ');
        sql += updates
          ? ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${updates}`
          : ` ON CONFLICT (${conflictCols}) DO NOTHING`;
      }
    }

    if (prefer.return !== 'minimal' && prefer.return !== 'headers-only') {
      const selectCols = this.buildReturningSelect(req.query.get('select'));
      sql += ` RETURNING ${selectCols}`;
    }

    const result = await this.db.query(sql, params);
    const wantsObject = this.wantsSingle(req);
    const responseBody =
      prefer.return === 'minimal' || prefer.return === 'headers-only'
        ? null
        : wantsObject
        ? result.rows[0] || null
        : result.rows;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (prefer.return) {
      headers['Preference-Applied'] = `return=${prefer.return}`;
    }
    return { status: 201, body: responseBody, headers };
  }

  // ---------- UPDATE ----------

  private async handleUpdate(req: PostgrestRequest): Promise<PostgrestResponse> {
    const table = req.path;
    const body = req.body || {};
    const cols = Object.keys(body);
    if (cols.length === 0) {
      return errorResponse(400, 'PGRST102', 'Empty body for update');
    }

    const where = this.buildWhereClause(req.query);
    const params: any[] = [];
    const setParts = cols.map((col) => {
      const placeholder = pushParam(params, body[col]);
      return `${quoteIdent(col)} = ${placeholder}`;
    });

    let sql = `UPDATE ${quoteIdent(table)} SET ${setParts.join(', ')}`;
    if (where.sql) {
      const offset = params.length;
      const remapped = renumberPlaceholders(where.sql, where.params, offset);
      sql += ` WHERE ${remapped.sql}`;
      params.push(...remapped.params);
    }

    const prefer = parsePrefer(req.headers['prefer']);
    const wantsRepresentation = prefer.return !== 'minimal' && prefer.return !== 'headers-only';
    if (wantsRepresentation) {
      sql += ` RETURNING ${this.buildReturningSelect(req.query.get('select'))}`;
    }

    const result = await this.db.query(sql, params);
    const wantsObject = this.wantsSingle(req);
    const responseBody = !wantsRepresentation
      ? null
      : wantsObject
      ? result.rows[0] || null
      : result.rows;

    return { status: 200, body: responseBody, headers: { 'Content-Type': 'application/json' } };
  }

  // ---------- DELETE ----------

  private async handleDelete(req: PostgrestRequest): Promise<PostgrestResponse> {
    const table = req.path;
    const where = this.buildWhereClause(req.query);
    const params: any[] = [];
    let sql = `DELETE FROM ${quoteIdent(table)}`;
    if (where.sql) {
      const remapped = renumberPlaceholders(where.sql, where.params, 0);
      sql += ` WHERE ${remapped.sql}`;
      params.push(...remapped.params);
    }
    const prefer = parsePrefer(req.headers['prefer']);
    const wantsRepresentation = prefer.return === 'representation';
    if (wantsRepresentation) {
      sql += ` RETURNING ${this.buildReturningSelect(req.query.get('select'))}`;
    }
    const result = await this.db.query(sql, params);
    return {
      status: 200,
      body: wantsRepresentation ? result.rows : null,
      headers: { 'Content-Type': 'application/json' }
    };
  }

  // ---------- RPC ----------

  private async handleRpc(req: PostgrestRequest): Promise<PostgrestResponse> {
    const fnName = req.path.replace(/^rpc\//, '');
    const args = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const argNames = Object.keys(args);
    const params: any[] = [];
    const namedArgs = argNames.map((name) => `${quoteIdent(name)} => ${pushParam(params, args[name])}`);
    const sql = `SELECT * FROM ${quoteIdent(fnName)}(${namedArgs.join(', ')})`;

    try {
      const result = await this.db.query(sql, params);
      const wantsObject = this.wantsSingle(req);
      const body = wantsObject ? result.rows[0] || null : result.rows;
      return { status: 200, body, headers: { 'Content-Type': 'application/json' } };
    } catch (err: any) {
      // RPC function might just return scalar - try simpler form
      try {
        const altSql = `SELECT ${quoteIdent(fnName)}(${namedArgs.join(', ')}) AS result`;
        const result = await this.db.query(altSql, params);
        return {
          status: 200,
          body: result.rows[0]?.result ?? null,
          headers: { 'Content-Type': 'application/json' }
        };
      } catch {
        return mapPgError(err);
      }
    }
  }

  // ---------- helpers ----------

  private buildSelectSql(table: string, query: URLSearchParams): SelectSqlInfo {
    const select = this.buildSelectClause(query.get('select'));
    const where = this.buildWhereClause(query);
    const order = this.buildOrderClause(query);
    const limit = this.parseLimitOffset(query);
    const params: any[] = [];
    let sql = `SELECT ${select} FROM ${quoteIdent(table)}`;

    if (where.sql) {
      const remapped = renumberPlaceholders(where.sql, where.params, params.length);
      sql += ` WHERE ${remapped.sql}`;
      params.push(...remapped.params);
    }
    if (order) sql += ` ORDER BY ${order}`;
    if (typeof limit.limit === 'number') sql += ` LIMIT ${limit.limit}`;
    if (typeof limit.offset === 'number' && limit.offset > 0) sql += ` OFFSET ${limit.offset}`;

    return { sql, params, offset: limit.offset || 0, limit: limit.limit, where };
  }

  private buildSelectClause(select: string | null): string {
    if (!select || select === '*') return '*';
    const parts = select.split(',').map((piece) => piece.trim()).filter(Boolean);
    return parts
      .map((piece) => {
        // basic alias support: "alias:col"
        const aliasMatch = piece.match(/^([a-zA-Z_][\w]*)\s*:\s*(.+)$/);
        if (aliasMatch) {
          return `${quoteIdent(aliasMatch[2])} AS ${quoteIdent(aliasMatch[1])}`;
        }
        if (piece === '*') return '*';
        return quoteIdent(piece);
      })
      .join(', ');
  }

  private buildReturningSelect(select: string | null): string {
    return this.buildSelectClause(select || '*');
  }

  private buildWhereClause(query: URLSearchParams): { sql: string; params: any[] } {
    const params: any[] = [];
    const clauses: string[] = [];

    for (const [key, value] of query.entries()) {
      if (RESERVED_KEYS.has(key)) continue;

      if (key === 'or' || key === 'and') {
        clauses.push(parseLogicalGroup(key, value, params));
        continue;
      }
      if (key === 'not') {
        clauses.push(parseLogicalGroup('and', value, params, /*negate*/ true));
        continue;
      }

      // Each filter is "column=op.value" but URLSearchParams gives us key=column, value="op.value"
      clauses.push(parseSimpleFilter(key, value, params));
    }

    return { sql: clauses.join(' AND '), params };
  }

  private buildOrderClause(query: URLSearchParams): string {
    const order = query.get('order');
    if (!order) return '';
    return order
      .split(',')
      .map((piece) => {
        const segments = piece.split('.');
        const col = segments[0];
        const dir = segments.includes('desc') ? 'DESC' : 'ASC';
        const nulls = segments.includes('nullsfirst')
          ? 'NULLS FIRST'
          : segments.includes('nullslast')
          ? 'NULLS LAST'
          : '';
        return `${quoteIdent(col)} ${dir}${nulls ? ' ' + nulls : ''}`;
      })
      .join(', ');
  }

  private parseLimitOffset(query: URLSearchParams): { limit?: number; offset?: number } {
    const limit = query.get('limit');
    const offset = query.get('offset');
    return {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined
    };
  }

  private async maybeCount(
    table: string,
    req: PostgrestRequest,
    info: SelectSqlInfo
  ): Promise<number | undefined> {
    const prefer = parsePrefer(req.headers['prefer']);
    if (!prefer.count) return undefined;

    let sql = `SELECT COUNT(*)::bigint AS count FROM ${quoteIdent(table)}`;
    const params: any[] = [];
    if (info.where.sql) {
      const remapped = renumberPlaceholders(info.where.sql, info.where.params, 0);
      sql += ` WHERE ${remapped.sql}`;
      params.push(...remapped.params);
    }
    const res = await this.db.query<{ count: string | number }>(sql, params);
    return Number(res.rows[0]?.count || 0);
  }

  private contentRangeHeaders(
    rowsReturned: number,
    offset: number,
    total: number | undefined
  ): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const upper = rowsReturned === 0 ? 0 : offset + rowsReturned - 1;
    headers['Content-Range'] = `${offset}-${Math.max(upper, offset)}/${total ?? '*'}`;
    return headers;
  }

  private wantsSingle(req: PostgrestRequest): boolean {
    const accept = req.headers['accept'] || '';
    return accept.includes('application/vnd.pgrst.object+json');
  }

  private wantsMaybeSingle(req: PostgrestRequest): boolean {
    // Supabase JS sets Accept: "application/vnd.pgrst.object+json"
    // for both .single() and .maybeSingle(). Differentiation comes from
    // the client converting 406 to null. We treat the 406 path explicitly
    // in handleSelect via single vs maybe heuristics; harness uses
    // toleratesEmpty hint not currently implemented.
    return false;
  }

  private allowsMaybe(_req: PostgrestRequest): boolean {
    return false;
  }

  private async detectPrimaryKey(table: string): Promise<string> {
    const res = await this.db.query<{ attname: string }>(
      `
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass
          AND i.indisprimary
        ORDER BY a.attnum
      `,
      [table]
    );
    if (!res.rows.length) return '';
    return res.rows.map((r) => quoteIdent(r.attname)).join(', ');
  }
}

interface SelectSqlInfo {
  sql: string;
  params: any[];
  offset: number;
  limit?: number;
  where: { sql: string; params: any[] };
}

const RESERVED_KEYS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

const SUPPORTED_OPS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'match',
  'imatch',
  'in',
  'is',
  'fts',
  'plfts',
  'phfts',
  'wfts',
  'cs',
  'cd',
  'ov',
  'sl',
  'sr',
  'nxr',
  'nxl',
  'adj'
]);

function parseSimpleFilter(column: string, expression: string, params: any[]): string {
  let negated = false;
  let raw = expression;
  if (raw.startsWith('not.')) {
    negated = true;
    raw = raw.slice(4);
  }
  const dot = raw.indexOf('.');
  if (dot < 0) {
    return '';
  }
  const op = raw.slice(0, dot);
  const value = raw.slice(dot + 1);

  if (!SUPPORTED_OPS.has(op)) {
    return '';
  }

  const fragment = renderOp(column, op, value, params);
  return negated ? `NOT (${fragment})` : fragment;
}

function renderOp(column: string, op: string, raw: string, params: any[]): string {
  const col = quoteIdent(column);
  switch (op) {
    case 'eq':
      return `${col} = ${pushParam(params, coerce(raw))}`;
    case 'neq':
      return `${col} <> ${pushParam(params, coerce(raw))}`;
    case 'gt':
      return `${col} > ${pushParam(params, coerce(raw))}`;
    case 'gte':
      return `${col} >= ${pushParam(params, coerce(raw))}`;
    case 'lt':
      return `${col} < ${pushParam(params, coerce(raw))}`;
    case 'lte':
      return `${col} <= ${pushParam(params, coerce(raw))}`;
    case 'like':
      return `${col} LIKE ${pushParam(params, asLikePattern(raw))}`;
    case 'ilike':
      return `${col} ILIKE ${pushParam(params, asLikePattern(raw))}`;
    case 'match':
      return `${col} ~ ${pushParam(params, raw)}`;
    case 'imatch':
      return `${col} ~* ${pushParam(params, raw)}`;
    case 'is':
      return `${col} IS ${parseIsValue(raw)}`;
    case 'in': {
      const list = parseListValue(raw);
      if (list.length === 0) return 'FALSE';
      const placeholders = list.map((v) => pushParam(params, coerce(v))).join(', ');
      return `${col} IN (${placeholders})`;
    }
    case 'fts':
    case 'plfts':
    case 'phfts':
    case 'wfts': {
      const fn =
        op === 'plfts'
          ? 'plainto_tsquery'
          : op === 'phfts'
          ? 'phraseto_tsquery'
          : op === 'wfts'
          ? 'websearch_to_tsquery'
          : 'to_tsquery';
      const langMatch = raw.match(/^\(([^)]+)\)\.(.+)$/);
      const language = langMatch ? langMatch[1] : 'simple';
      const queryText = langMatch ? langMatch[2] : raw;
      return `to_tsvector(${pushParam(params, language)}, ${col}::text) @@ ${fn}(${pushParam(params, language)}, ${pushParam(params, queryText)})`;
    }
    case 'cs':
      return `${col} @> ${pushParam(params, parseArrayOrJson(raw))}`;
    case 'cd':
      return `${col} <@ ${pushParam(params, parseArrayOrJson(raw))}`;
    case 'ov':
      return `${col} && ${pushParam(params, parseArrayOrJson(raw))}`;
    case 'sl':
      return `${col} << ${pushParam(params, raw)}`;
    case 'sr':
      return `${col} >> ${pushParam(params, raw)}`;
    case 'nxr':
      return `${col} &< ${pushParam(params, raw)}`;
    case 'nxl':
      return `${col} &> ${pushParam(params, raw)}`;
    case 'adj':
      return `${col} -|- ${pushParam(params, raw)}`;
    default:
      return '';
  }
}

function parseLogicalGroup(
  kind: 'or' | 'and',
  raw: string,
  params: any[],
  negate = false
): string {
  // raw looks like "(col.op.val,col.op.val,or(...))"
  if (!raw.startsWith('(') || !raw.endsWith(')')) {
    return '';
  }
  const inner = raw.slice(1, -1);
  const tokens = splitTopLevel(inner, ',');
  const fragments = tokens.map((token) => parseLogicalToken(token, params)).filter(Boolean);
  const joiner = kind === 'or' ? ' OR ' : ' AND ';
  const expr = `(${fragments.join(joiner)})`;
  return negate ? `NOT ${expr}` : expr;
}

function parseLogicalToken(token: string, params: any[]): string {
  if (token.startsWith('or')) {
    return parseLogicalGroup('or', token.slice(2), params);
  }
  if (token.startsWith('and')) {
    return parseLogicalGroup('and', token.slice(3), params);
  }
  if (token.startsWith('not.')) {
    const rest = token.slice(4);
    if (rest.startsWith('or')) return parseLogicalGroup('or', rest.slice(2), params, true);
    if (rest.startsWith('and')) return parseLogicalGroup('and', rest.slice(3), params, true);
    // not.<col>.<op>.<value>
    const parts = splitOnce(rest, '.');
    if (!parts) return '';
    return `NOT (${parseSimpleFilter(parts[0], parts[1], params)})`;
  }
  // <col>.<op>.<value>
  const parts = splitOnce(token, '.');
  if (!parts) return '';
  return parseSimpleFilter(parts[0], parts[1], params);
}

function splitOnce(value: string, sep: string): [string, string] | null {
  const idx = value.indexOf(sep);
  if (idx < 0) return null;
  return [value.slice(0, idx), value.slice(idx + 1)];
}

function splitTopLevel(value: string, sep: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let buffer = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) {
      if (buffer) result.push(buffer);
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  if (buffer) result.push(buffer);
  return result;
}

function parseListValue(raw: string): string[] {
  let body = raw;
  if (body.startsWith('(') && body.endsWith(')')) {
    body = body.slice(1, -1);
  }
  if (!body) return [];
  return body.split(',').map((v) => v.trim()).map(stripQuotes);
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function parseIsValue(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === 'null') return 'NULL';
  if (lower === 'true') return 'TRUE';
  if (lower === 'false') return 'FALSE';
  if (lower === 'unknown') return 'UNKNOWN';
  return `'${raw.replace(/'/g, "''")}'`;
}

function parseArrayOrJson(raw: string): any {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    // PostgREST array literal {a,b,c}
    const inner = trimmed.slice(1, -1);
    return inner ? inner.split(',').map((s) => stripQuotes(s.trim())) : [];
  }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function asLikePattern(raw: string): string {
  // PostgREST supports * as wildcard for like/ilike. Convert to %.
  return raw.replace(/\*/g, '%');
}

function coerce(value: string): any {
  if (value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  return stripQuotes(value);
}

function pushParam(params: any[], value: any): string {
  // Convert objects/arrays to JSON for jsonb columns; PGlite handles the rest.
  let normalized = value;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    normalized = JSON.stringify(value);
  } else if (Array.isArray(value)) {
    // Postgres array_in handles JSON-style arrays poorly; for jsonb columns
    // PostgREST sends them as JSON. We pass through as JSON string.
    normalized = JSON.stringify(value);
  }
  params.push(normalized);
  return `$${params.length}`;
}

function renumberPlaceholders(
  sql: string,
  params: any[],
  offset: number
): { sql: string; params: any[] } {
  if (offset === 0) return { sql, params };
  const renumbered = sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
  return { sql: renumbered, params };
}

function parsePrefer(header: string | undefined): {
  return?: 'representation' | 'minimal' | 'headers-only';
  count?: 'exact' | 'planned' | 'estimated';
  resolution?: 'merge-duplicates' | 'ignore-duplicates';
  missing?: string;
} {
  if (!header) return {};
  const out: any = {};
  for (const part of header.split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (!k) continue;
    if (k === 'return' || k === 'count' || k === 'resolution' || k === 'missing') {
      out[k] = v;
    }
  }
  return out;
}

function errorResponse(status: number, code: string, message: string): PostgrestResponse {
  return {
    status,
    body: { code, message, details: null, hint: null },
    headers: { 'Content-Type': 'application/json' }
  };
}

function mapPgError(err: any): PostgrestResponse {
  const message = err?.message || String(err);
  const code = err?.code || 'PGRST000';
  let status = 500;
  if (/duplicate key value/i.test(message) || code === '23505') status = 409;
  else if (/violates foreign key constraint/i.test(message) || code === '23503') status = 409;
  else if (/violates not-null/i.test(message) || code === '23502') status = 400;
  else if (/does not exist/i.test(message)) status = 404;
  else if (/syntax error/i.test(message)) status = 400;
  return {
    status,
    body: { code, message, details: err?.detail || null, hint: err?.hint || null },
    headers: { 'Content-Type': 'application/json' }
  };
}
