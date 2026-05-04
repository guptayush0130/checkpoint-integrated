# api_clients/

HTTP clients for talking to external services. The principal occupant — landing in **Phase 2** — is the URL 1 client: the HTTP wrapper that POSTs tester prompts to the target agent's text endpoint and reads back its replies.

## Phase 0 state

This directory is currently empty except for `embedded_target.ts.legacy`, the old in-process target runner that compiled declarative tools to `@supabase/supabase-js` calls. That model is fundamentally incompatible with the external black-box paradigm — it assumed we owned the target's process. The `.legacy` suffix excludes it from TypeScript compilation; the file is kept only as reference for the Phase 2 rewrite.

## Phase 2 deliverable

```ts
// api_clients/target.ts
export interface TargetEndpointConfig {
  url: string;
  profile: 'default' | 'openai-chat' | 'custom';
  auth?: { kind: 'bearer' | 'header'; value: string; header?: string };
  requestTemplate?: any;        // for profile='custom'
  responseJsonPath?: string;    // for profile='custom'
  conversationStrategy: 'session-id' | 'replay-history';
}

export class TargetClient {
  constructor(cfg: TargetEndpointConfig);
  async send(conversationId: string, prompt: string, history?: ConversationTurn[]): Promise<TargetReply>;
}
```

Profiles:
- **default** — `POST { conversation_id, user_message } → { response, done }`
- **openai-chat** — `POST { messages: [...] } → { choices: [{ message: { content } }] }`
- **custom** — body built from `requestTemplate` with `{{conversation_id}}`, `{{user_message}}`, `{{history}}` placeholders; response extracted via JSONPath.
