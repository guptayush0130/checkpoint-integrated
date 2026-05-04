/**
 * In-memory mock of /storage/v1 endpoints. Behaves like Supabase Storage for
 * the operations @supabase/storage-js emits:
 *   POST   /storage/v1/object/{bucket}/{path}     (upload)
 *   PUT    /storage/v1/object/{bucket}/{path}     (upsert)
 *   GET    /storage/v1/object/{bucket}/{path}     (download)
 *   DELETE /storage/v1/object/{bucket}/{path}
 *   POST   /storage/v1/object/list/{bucket}       (list)
 *   GET    /storage/v1/bucket
 *   POST   /storage/v1/bucket
 *   DELETE /storage/v1/bucket/{id}
 */

export interface StorageObject {
  bucket: string;
  path: string;
  contentType: string;
  size: number;
  body: Buffer;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface StorageBucket {
  id: string;
  name: string;
  public: boolean;
  created_at: string;
}

export interface StorageRequest {
  method: string;
  path: string; // path under /storage/v1/
  headers: Record<string, string>;
  body: any; // Buffer or parsed JSON
  query: URLSearchParams;
}

export interface StorageResponse {
  status: number;
  body: any;
  headers: Record<string, string>;
}

export class StorageHandler {
  private buckets = new Map<string, StorageBucket>();
  private objects = new Map<string, StorageObject>();

  ensureBucket(name: string, isPublic = false) {
    if (!this.buckets.has(name)) {
      this.buckets.set(name, {
        id: name,
        name,
        public: isPublic,
        created_at: new Date().toISOString()
      });
    }
  }

  async handle(req: StorageRequest): Promise<StorageResponse> {
    const segments = req.path.split('/').filter(Boolean);
    const root = segments[0];

    if (root === 'bucket') {
      return this.handleBucket(req, segments);
    }
    if (root === 'object') {
      return this.handleObject(req, segments);
    }
    if (root === 'health') {
      return jsonOk({ healthy: true });
    }
    return notFound(`Storage endpoint not found: ${req.path}`);
  }

  // ------------- buckets -------------

  private handleBucket(req: StorageRequest, segments: string[]): StorageResponse {
    if (req.method === 'GET' && segments.length === 1) {
      return jsonOk(Array.from(this.buckets.values()));
    }
    if (req.method === 'GET' && segments.length === 2) {
      const bucket = this.buckets.get(segments[1]);
      if (!bucket) return notFound('Bucket not found');
      return jsonOk(bucket);
    }
    if (req.method === 'POST' && segments.length === 1) {
      const body = req.body || {};
      const bucket: StorageBucket = {
        id: body.id || body.name,
        name: body.name || body.id,
        public: !!body.public,
        created_at: new Date().toISOString()
      };
      if (!bucket.name) {
        return { status: 400, body: { message: 'name required' }, headers: jsonHeaders() };
      }
      this.buckets.set(bucket.name, bucket);
      return jsonOk({ name: bucket.name }, 200);
    }
    if (req.method === 'DELETE' && segments.length === 2) {
      const name = segments[1];
      this.buckets.delete(name);
      for (const key of Array.from(this.objects.keys())) {
        if (key.startsWith(`${name}/`)) this.objects.delete(key);
      }
      return jsonOk({ message: 'Successfully deleted' });
    }
    return notFound('Bucket endpoint not implemented');
  }

  // ------------- objects -------------

  private handleObject(req: StorageRequest, segments: string[]): StorageResponse {
    // /object/{bucket}/{...path}
    // /object/list/{bucket}
    if (segments[1] === 'list' && req.method === 'POST') {
      const bucket = segments[2];
      const body = req.body || {};
      const prefix = body.prefix || '';
      const search = body.search || '';
      const matches = Array.from(this.objects.values())
        .filter((obj) => obj.bucket === bucket)
        .filter((obj) => obj.path.startsWith(prefix))
        .filter((obj) => (search ? obj.path.includes(search) : true))
        .map((obj) => ({
          name: obj.path,
          id: obj.path,
          size: obj.size,
          created_at: obj.createdAt,
          updated_at: obj.updatedAt,
          metadata: obj.metadata
        }));
      return jsonOk(matches);
    }

    if (segments.length < 3) {
      return notFound('Bucket and path required');
    }

    const bucket = segments[1];
    const path = segments.slice(2).join('/');
    const key = `${bucket}/${path}`;
    this.ensureBucket(bucket);

    if (req.method === 'POST' || req.method === 'PUT') {
      const buffer = asBuffer(req.body);
      const now = new Date().toISOString();
      this.objects.set(key, {
        bucket,
        path,
        contentType: req.headers['content-type'] || 'application/octet-stream',
        size: buffer.length,
        body: buffer,
        metadata: {},
        createdAt: this.objects.get(key)?.createdAt || now,
        updatedAt: now
      });
      return jsonOk({ Key: key, Id: key });
    }

    if (req.method === 'GET') {
      const obj = this.objects.get(key);
      if (!obj) return notFound('Object not found');
      return {
        status: 200,
        body: obj.body,
        headers: { 'Content-Type': obj.contentType }
      };
    }

    if (req.method === 'DELETE') {
      this.objects.delete(key);
      return jsonOk({ message: 'Successfully deleted' });
    }

    return notFound('Object endpoint not implemented');
  }

  reset() {
    this.buckets.clear();
    this.objects.clear();
  }
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

function jsonOk(body: any, status = 200): StorageResponse {
  return { status, body, headers: jsonHeaders() };
}

function notFound(message: string): StorageResponse {
  return { status: 404, body: { message, statusCode: '404', error: 'Not Found' }, headers: jsonHeaders() };
}

function asBuffer(value: any): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value === null || value === undefined) return Buffer.alloc(0);
  if (typeof value === 'string') return Buffer.from(value);
  return Buffer.from(JSON.stringify(value));
}
