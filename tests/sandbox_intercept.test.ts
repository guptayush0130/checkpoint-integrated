/**
 * Phase 1 verification — proves the intercept bus actually fires when a real
 * supabase-js client hits the sandbox.
 *
 * Run with:  npx ts-node --project tsconfig.cli.json tests/sandbox_intercept.test.ts
 */
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';
import {
  createSandbox,
  disposeSandbox,
  getEvents,
  resetSandbox,
  subscribe
} from '../lib/sandbox_pool';

async function main() {
  const runId = `test-intercept-${Date.now()}`;

  await test('createSandbox boots PGlite + HTTP shim and returns env', async () => {
    const { env } = await createSandbox(runId, {
      schema: {
        sql: `CREATE TABLE items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, qty int NOT NULL DEFAULT 0);`
      },
      seed: { sql: `INSERT INTO items (name, qty) VALUES ('Apple', 5), ('Banana', 9);` }
    });
    assert.match(env.SUPABASE_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(env.SUPABASE_ANON_KEY.length > 20);
  });

  const env = (await import('../lib/sandbox_pool')).getSandbox(runId)!.env;
  const supa = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const liveEvents: any[] = [];
  const unsub = subscribe(runId, (ev) => liveEvents.push(ev));

  await test('SELECT triggers a rest intercept event', async () => {
    const before = liveEvents.length;
    const { data, error } = await supa.from('items').select('name, qty').order('name');
    assert.strictEqual(error, null);
    assert.deepStrictEqual(
      data!.map((d: any) => d.name),
      ['Apple', 'Banana']
    );
    const after = liveEvents.slice(before);
    assert.ok(
      after.some((e) => e.surface === 'rest' && e.method === 'GET' && e.path === 'items'),
      'expected GET items intercept'
    );
  });

  await test('INSERT triggers a rest intercept with status 201', async () => {
    const before = liveEvents.length;
    const { data, error } = await supa
      .from('items')
      .insert({ name: 'Cherry', qty: 13 })
      .select()
      .single();
    assert.strictEqual(error, null);
    assert.strictEqual(data!.name, 'Cherry');
    const after = liveEvents.slice(before);
    const insert = after.find(
      (e) => e.surface === 'rest' && e.method === 'POST' && e.path === 'items'
    );
    assert.ok(insert, 'expected POST items intercept');
    assert.strictEqual(insert.status, 201);
  });

  await test('intercept events are also retained for replay (history pool)', async () => {
    const history = getEvents(runId);
    assert.ok(history.length >= 2, 'history should have accumulated intercepts');
    assert.ok(history.every((e) => e.ts && e.method && e.surface));
  });

  await test('resetSandbox wipes data but reapplies seed', async () => {
    // After insert, there should be 3 rows
    let { data } = await supa.from('items').select('*');
    assert.strictEqual(data!.length, 3);

    const ok = await resetSandbox(runId);
    assert.strictEqual(ok, true);

    // After reset, back to seeded 2 rows
    ({ data } = await supa.from('items').select('*'));
    assert.strictEqual(data!.length, 2);
  });

  await test('auth signin redacts password in interception', async () => {
    const before = liveEvents.length;
    await supa.auth.signUp({ email: 'tester@example.com', password: 'super-secret' });
    const after = liveEvents.slice(before);
    const authEvents = after.filter((e) => e.surface === 'auth');
    assert.ok(authEvents.length >= 1, 'expected at least one auth intercept');
    for (const ev of authEvents) {
      const stringified = JSON.stringify(ev);
      assert.ok(
        !stringified.includes('super-secret'),
        `password leaked in intercept: ${stringified}`
      );
    }
  });

  unsub();
  await disposeSandbox(runId);

  await test('disposeSandbox removes the entry', async () => {
    const ok = await resetSandbox(runId);
    assert.strictEqual(ok, false, 'sandbox should be gone after dispose');
  });

  console.log(`\nAll Phase 1 sandbox-intercept tests passed. (${pass} pass, ${fail} fail)`);
  if (fail > 0) process.exit(1);
}

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (err: any) {
    fail++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err?.message || err}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
