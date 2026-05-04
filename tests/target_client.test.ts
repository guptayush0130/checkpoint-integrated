/**
 * Phase 2 verification — TargetClient profiles + conversation strategies.
 *
 * Spins up a tiny http.Server fixture that mimics the three response shapes
 * the client needs to handle, then drives each profile through `send(...)`.
 *
 * Run with:  npx ts-node --project tsconfig.cli.json -r tsconfig-paths/register tests/target_client.test.ts
 */
import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  TargetClient,
  TargetEndpointConfig,
  ConversationTurn,
  substitutePlaceholders,
  readDotPath
} from '../api_clients/target';

// ---- fixture server ------------------------------------------------------

interface FixtureRequest {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

let fixtureRequests: FixtureRequest[] = [];

function startFixture(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: any = raw;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {}
      fixtureRequests.push({
        path: req.url || '/',
        method: req.method || 'GET',
        headers: req.headers,
        body
      });

      res.setHeader('Content-Type', 'application/json');
      const path = req.url || '';

      if (path === '/timeout') {
        // Respond after 5 seconds; client uses 50ms timeout.
        setTimeout(() => {
          res.statusCode = 200;
          res.end(JSON.stringify({ response: 'too-late' }));
        }, 5000);
        return;
      }
      if (path === '/error') {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: 'unavailable' }));
        return;
      }
      if (path === '/default') {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            response: `echoed: ${body?.user_message ?? ''}`,
            done: false
          })
        );
        return;
      }
      if (path === '/openai') {
        const last = body?.messages?.[body.messages.length - 1];
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: `replied to: ${last?.content ?? ''}` } }]
          })
        );
        return;
      }
      if (path === '/custom') {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            data: {
              text: `custom-said: ${body?.payload?.prompt ?? ''}`,
              meta: { conversation: body?.payload?.session ?? '' }
            }
          })
        );
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not_found' }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port, address } = server.address() as AddressInfo;
      const url = `http://${address}:${port}`;
      resolve({
        url,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          })
      });
    });
  });
}

// ---- main ----------------------------------------------------------------

async function main() {
  const fixture = await startFixture();

  // ---- helpers --------------------------------------------------------

  await test('substitutePlaceholders walks nested objects + arrays', async () => {
    const out = substitutePlaceholders(
      { prompt: 'hi {{user_message}}', meta: { id: '{{conversation_id}}', tags: ['{{user_message}}'] } },
      { user_message: 'world', conversation_id: 'c1' }
    );
    assert.deepStrictEqual(out, {
      prompt: 'hi world',
      meta: { id: 'c1', tags: ['world'] }
    });
  });

  await test('substitutePlaceholders leaves unknown keys literal', async () => {
    assert.strictEqual(
      substitutePlaceholders('hi {{nope}}', { user_message: 'x' }),
      'hi {{nope}}'
    );
  });

  await test('readDotPath walks nested objects and arrays', async () => {
    assert.strictEqual(
      readDotPath({ a: { b: [{ c: 'x' }, { c: 'y' }] } }, 'a.b.1.c'),
      'y'
    );
    assert.strictEqual(readDotPath({ a: 1 }, 'a.b.c'), undefined);
    // Empty path returns the input unchanged (caller's "give me the whole thing").
    assert.deepStrictEqual(readDotPath({ a: 1 }, ''), { a: 1 });
  });

  // ---- default profile ------------------------------------------------

  await test('default profile: session-id strategy sends only latest user_message', async () => {
    fixtureRequests = [];
    const client = new TargetClient({
      url: `${fixture.url}/default`,
      profile: 'default',
      conversationStrategy: 'session-id'
    });
    const reply = await client.send({
      conversationId: 'c-1',
      userMessage: 'hello',
      history: [
        { role: 'tester', content: 'old' },
        { role: 'agent', content: 'older' }
      ]
    });
    assert.strictEqual(reply.response, 'echoed: hello');
    assert.strictEqual(reply.done, false);
    assert.strictEqual(reply.status, 200);
    assert.deepStrictEqual(fixtureRequests[0].body, {
      conversation_id: 'c-1',
      user_message: 'hello'
    });
  });

  await test('default profile: replay-history strategy sends full transcript', async () => {
    fixtureRequests = [];
    const client = new TargetClient({
      url: `${fixture.url}/default`,
      profile: 'default',
      conversationStrategy: 'replay-history'
    });
    const history: ConversationTurn[] = [
      { role: 'tester', content: 'first' },
      { role: 'agent', content: 'response' }
    ];
    await client.send({ conversationId: 'c-2', userMessage: 'second', history });
    assert.deepStrictEqual(fixtureRequests[0].body.history, [
      { role: 'tester', content: 'first' },
      { role: 'agent', content: 'response' }
    ]);
  });

  await test('default profile: strategyOverride wins over config', async () => {
    fixtureRequests = [];
    const client = new TargetClient({
      url: `${fixture.url}/default`,
      profile: 'default',
      conversationStrategy: 'session-id'
    });
    await client.send({
      conversationId: 'c-3',
      userMessage: 'q',
      history: [{ role: 'tester', content: 'old' }],
      strategyOverride: 'replay-history'
    });
    assert.ok(Array.isArray(fixtureRequests[0].body.history));
    assert.strictEqual(fixtureRequests[0].body.history.length, 1);
  });

  // ---- openai-chat profile -------------------------------------------

  await test('openai-chat profile: session-id sends only the new user turn', async () => {
    fixtureRequests = [];
    const client = new TargetClient({
      url: `${fixture.url}/openai`,
      profile: 'openai-chat',
      conversationStrategy: 'session-id'
    });
    const reply = await client.send({
      conversationId: 'oai-1',
      userMessage: 'ping',
      history: [{ role: 'tester', content: 'past' }]
    });
    assert.strictEqual(reply.response, 'replied to: ping');
    assert.deepStrictEqual(fixtureRequests[0].body.messages, [{ role: 'user', content: 'ping' }]);
  });

  await test('openai-chat profile: replay-history maps tester→user, agent→assistant', async () => {
    fixtureRequests = [];
    const client = new TargetClient({
      url: `${fixture.url}/openai`,
      profile: 'openai-chat',
      conversationStrategy: 'replay-history'
    });
    await client.send({
      conversationId: 'oai-2',
      userMessage: 'now',
      history: [
        { role: 'tester', content: 'a' },
        { role: 'agent', content: 'b' }
      ]
    });
    assert.deepStrictEqual(fixtureRequests[0].body.messages, [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'now' }
    ]);
  });

  // ---- custom profile -------------------------------------------------

  await test('custom profile: template substitution + JSONPath extraction', async () => {
    fixtureRequests = [];
    const cfg: TargetEndpointConfig = {
      url: `${fixture.url}/custom`,
      profile: 'custom',
      conversationStrategy: 'replay-history',
      requestTemplate: {
        payload: { prompt: '{{user_message}}', session: '{{conversation_id}}' },
        history_text: '{{history_text}}'
      },
      responseJsonPath: 'data.text'
    };
    const client = new TargetClient(cfg);
    const reply = await client.send({
      conversationId: 'cs-1',
      userMessage: 'abracadabra',
      history: [{ role: 'tester', content: 'h0' }]
    });
    assert.strictEqual(reply.response, 'custom-said: abracadabra');
    assert.deepStrictEqual(fixtureRequests[0].body.payload, {
      prompt: 'abracadabra',
      session: 'cs-1'
    });
    assert.strictEqual(fixtureRequests[0].body.history_text, 'TESTER: h0');
  });

  await test('custom profile: requires responseJsonPath at construction', async () => {
    assert.throws(
      () =>
        new TargetClient({
          url: 'x',
          profile: 'custom',
          conversationStrategy: 'session-id',
          requestTemplate: { x: 1 }
        } as any),
      /responseJsonPath/
    );
  });

  // ---- auth ----------------------------------------------------------

  await test('bearer auth attaches Authorization header', async () => {
    fixtureRequests = [];
    const client = new TargetClient({
      url: `${fixture.url}/default`,
      profile: 'default',
      conversationStrategy: 'session-id',
      auth: { kind: 'bearer', value: 'sk-secret' }
    });
    await client.send({ conversationId: 'a-1', userMessage: 'q' });
    assert.strictEqual(fixtureRequests[0].headers['authorization'], 'Bearer sk-secret');
  });

  await test('header auth uses configured header name', async () => {
    fixtureRequests = [];
    const client = new TargetClient({
      url: `${fixture.url}/default`,
      profile: 'default',
      conversationStrategy: 'session-id',
      auth: { kind: 'header', header: 'X-Token', value: 'abc' }
    });
    await client.send({ conversationId: 'a-2', userMessage: 'q' });
    assert.strictEqual(fixtureRequests[0].headers['x-token'], 'abc');
  });

  // ---- error paths ---------------------------------------------------

  await test('non-2xx surfaces a useful error message', async () => {
    const client = new TargetClient({
      url: `${fixture.url}/error`,
      profile: 'default',
      conversationStrategy: 'session-id'
    });
    await assert.rejects(
      client.send({ conversationId: 'e-1', userMessage: 'q' }),
      /503/
    );
  });

  await test('timeout aborts via AbortController and throws', async () => {
    const client = new TargetClient({
      url: `${fixture.url}/timeout`,
      profile: 'default',
      conversationStrategy: 'session-id',
      timeoutMs: 100
    });
    await assert.rejects(
      client.send({ conversationId: 't-1', userMessage: 'q' }),
      /timed out/i
    );
  });

  await fixture.close();
  console.log(`\nAll Phase 2 target-client tests passed. (${pass} pass, ${fail} fail)`);
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
