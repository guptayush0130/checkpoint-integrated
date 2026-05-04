#!/usr/bin/env node
/**
 * Demo runner: spins up the mock Supabase, applies the bundled schema,
 * then walks through a series of @supabase/supabase-js calls so you can
 * confirm the environment is healthy WITHOUT any external dependencies
 * (no Docker, no OpenAI, no network).
 */

import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { MockSupabaseInstance } from '../mock';

async function main() {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const schemaFile = path.join(projectRoot, 'examples/schemas/test-management.sql');
  const instance = new MockSupabaseInstance({
    name: 'demo',
    schema: { file: schemaFile },
    seed: { file: schemaFile },
    snapshotTables: ['users', 'categories', 'test_cases', 'test_files', 'test_runs', 'user_integrations']
  });

  const env = await instance.setup();
  console.log('Mock Supabase ready:');
  console.log('  URL:', env.SUPABASE_URL);
  console.log('  anon key:', env.SUPABASE_ANON_KEY.slice(0, 32) + '…');

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log('\n[1] Users:');
  console.log(await supabase.from('users').select('id,email,role').order('email'));

  console.log('\n[2] Test cases by status (active):');
  console.log(await supabase.from('test_cases').select('title,priority,status').eq('status', 'active'));

  console.log('\n[3] Search test cases for "login":');
  console.log(
    await supabase
      .from('test_cases')
      .select('title')
      .or('title.ilike.%login%,description.ilike.%login%')
  );

  console.log('\n[4] Insert a new category:');
  const ins = await supabase
    .from('categories')
    .insert({ name: 'Onboarding', description: 'Sign-up funnel coverage' })
    .select()
    .single();
  console.log(ins);

  console.log('\n[5] Update a test case priority:');
  const upd = await supabase
    .from('test_cases')
    .update({ priority: 4, updated_at: new Date().toISOString() })
    .eq('title', 'Login with valid credentials')
    .select();
  console.log(upd);

  console.log('\n[6] Verify update:');
  console.log(
    await supabase
      .from('test_cases')
      .select('title,priority')
      .eq('title', 'Login with valid credentials')
      .single()
  );

  console.log('\n[7] Snapshot before reset:');
  const before = await instance.snapshot();
  console.log('  test_cases rows:', before['test_cases'].length);
  console.log('  categories rows:', before['categories'].length);

  await instance.reset();

  console.log('\n[8] Snapshot after reset (back to seed):');
  const after = await instance.snapshot();
  console.log('  test_cases rows:', after['test_cases'].length);
  console.log('  categories rows:', after['categories'].length);

  console.log('\n[9] Storage round-trip:');
  const up = await supabase.storage.from('reports').upload('summary.txt', new Blob(['hi'], { type: 'text/plain' }));
  console.log('  upload:', up);
  const list = await supabase.storage.from('reports').list();
  console.log('  list:', list);

  await instance.teardown();
  console.log('\nDemo complete. Mock is healthy.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
