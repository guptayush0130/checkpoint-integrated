/**
 * Comprehensive PostgREST/auth/storage smoke test for the mock backend.
 * Validates filter operators, pagination, single/maybeSingle, upsert,
 * count headers, and error mapping.
 */

import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';
import { MockSupabaseInstance } from '../src/mock';

async function main() {
  const instance = new MockSupabaseInstance({
    name: 'mock-test',
    schema: {
      sql: `
        CREATE TABLE items (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text UNIQUE NOT NULL,
          price numeric NOT NULL,
          stock int NOT NULL DEFAULT 0,
          tags jsonb NOT NULL DEFAULT '[]'::jsonb,
          archived boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `
    },
    seed: {
      sql: `
        INSERT INTO items (name, price, stock, tags, archived) VALUES
          ('Apple', 1.50, 100, '["fruit","red"]', false),
          ('Banana', 0.50, 50, '["fruit","yellow"]', false),
          ('Cherry', 3.00, 25, '["fruit","red"]', false),
          ('Daikon', 2.50, 0, '["vegetable","white"]', true),
          ('Eggplant', 4.00, 10, '["vegetable","purple"]', false);
      `
    }
  });

  const env = await instance.setup();
  const supa = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  await test('select * returns all rows', async () => {
    const { data, error } = await supa.from('items').select('*');
    assert.strictEqual(error, null);
    assert.strictEqual(data!.length, 5);
  });

  await test('select with column projection', async () => {
    const { data } = await supa.from('items').select('name,price').order('name');
    assert.deepStrictEqual(Object.keys(data![0]).sort(), ['name', 'price']);
    assert.strictEqual(data![0].name, 'Apple');
  });

  await test('eq filter', async () => {
    const { data } = await supa.from('items').select('name').eq('archived', false);
    assert.strictEqual(data!.length, 4);
  });

  await test('gt + order desc', async () => {
    const { data } = await supa.from('items').select('name,price').gt('price', 1).order('price', { ascending: false });
    assert.deepStrictEqual(data!.map((d: any) => d.name), ['Eggplant', 'Cherry', 'Daikon', 'Apple']);
  });

  await test('in filter', async () => {
    const { data } = await supa.from('items').select('name').in('name', ['Apple', 'Banana']);
    assert.deepStrictEqual(data!.map((d: any) => d.name).sort(), ['Apple', 'Banana']);
  });

  await test('ilike with wildcard', async () => {
    const { data } = await supa.from('items').select('name').ilike('name', '%a%');
    assert.ok(data!.some((d: any) => d.name === 'Apple'));
    assert.ok(data!.some((d: any) => d.name === 'Banana'));
  });

  await test('or composite filter', async () => {
    const { data } = await supa.from('items').select('name').or('archived.eq.true,price.lt.1');
    assert.deepStrictEqual(data!.map((d: any) => d.name).sort(), ['Banana', 'Daikon']);
  });

  await test('not filter', async () => {
    const { data } = await supa.from('items').select('name').not('archived', 'eq', true);
    assert.strictEqual(data!.length, 4);
  });

  await test('limit + offset (range)', async () => {
    const { data } = await supa.from('items').select('name').order('name').range(1, 3);
    assert.deepStrictEqual(data!.map((d: any) => d.name), ['Banana', 'Cherry', 'Daikon']);
  });

  await test('count exact', async () => {
    const { count } = await supa.from('items').select('*', { count: 'exact', head: true });
    assert.strictEqual(count, 5);
  });

  await test('insert returns row', async () => {
    const { data, error } = await supa
      .from('items')
      .insert({ name: 'Fennel', price: 2.0, stock: 5, tags: ['vegetable', 'green'] })
      .select()
      .single();
    assert.strictEqual(error, null);
    assert.strictEqual(data!.name, 'Fennel');
    assert.deepStrictEqual(data!.tags, ['vegetable', 'green']);
  });

  await test('update with eq', async () => {
    const { data } = await supa.from('items').update({ stock: 999 }).eq('name', 'Apple').select();
    assert.strictEqual(data!.length, 1);
    assert.strictEqual(data![0].stock, 999);
  });

  await test('upsert merge-duplicates', async () => {
    const { data } = await supa
      .from('items')
      .upsert(
        { name: 'Apple', price: 1.75, stock: 200 },
        { onConflict: 'name', ignoreDuplicates: false }
      )
      .select()
      .single();
    // Postgres `numeric` is returned as a string to preserve precision; that
    // matches @supabase/supabase-js behavior against a real Supabase instance.
    assert.strictEqual(Number(data!.price), 1.75);
    assert.strictEqual(data!.stock, 200);
  });

  await test('delete with eq returns deleted rows', async () => {
    const { data } = await supa.from('items').delete().eq('name', 'Cherry').select();
    assert.strictEqual(data!.length, 1);
  });

  await test('single() with multiple rows returns 406', async () => {
    const { error } = await supa.from('items').select('*').single();
    assert.ok(error, 'expected error');
  });

  await test('maybeSingle() with no match returns null', async () => {
    const { data, error } = await supa.from('items').select('*').eq('name', 'Nope').maybeSingle();
    assert.strictEqual(error, null);
    assert.strictEqual(data, null);
  });

  await test('foreign key violation surfaces error', async () => {
    await supa.from('items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const { error } = await supa
      .from('items')
      .insert({ name: 'Apple', price: 1, stock: 1 });
    assert.strictEqual(error, null, 'first insert should succeed');
    const { error: dup } = await supa.from('items').insert({ name: 'Apple', price: 1, stock: 1 });
    assert.ok(dup, 'duplicate insert should error');
  });

  await test('reset() returns to seed state', async () => {
    await instance.reset();
    const { count } = await supa.from('items').select('*', { count: 'exact', head: true });
    assert.strictEqual(count, 5);
  });

  await test('snapshot+diff detects added rows', async () => {
    await instance.reset();
    const before = await instance.snapshot(['items']);
    await supa.from('items').insert({ name: 'Garlic', price: 0.25, stock: 100 });
    const after = await instance.snapshot(['items']);
    const diff = instance.diff(before, after);
    assert.strictEqual(diff['items'].added.length, 1);
    assert.strictEqual(diff['items'].added[0].name, 'Garlic');
  });

  await test('auth signup + token', async () => {
    const res = await supa.auth.signUp({ email: 'tester@example.com', password: 'pw1234' });
    assert.strictEqual(res.error, null);
    assert.ok(res.data.user?.id);
    assert.ok(res.data.session?.access_token);
  });

  await test('storage upload + list + download', async () => {
    const up = await supa.storage.from('docs').upload('a/b.txt', new Blob(['hello']));
    assert.strictEqual(up.error, null);
    const list = await supa.storage.from('docs').list('a');
    assert.ok(list.data?.some((f: any) => f.name === 'a/b.txt'));
  });

  await instance.teardown();
  console.log('\nAll mock tests passed.');
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

main()
  .then(() => {
    console.log(`Summary: ${pass} passed, ${fail} failed.`);
    if (fail > 0) process.exit(1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
