import {
  AuditPersonaTestCase,
  CustomAgentDefinition,
  LLMClient,
  SchemaSummary
} from './types';
import { isStrictUuid, type SeedSampleSummary } from './schema-introspect';

export interface AuditorOptions {
  llmClient: LLMClient;
  model: string;
  count: number;
  agent: CustomAgentDefinition;
  schemaSummary: SchemaSummary;
  /** Real UUIDs sampled from the sandbox DB — used to fix invalid UUID tokens in LLM output. */
  referenceUuids?: string[];
  /** Real seeded values (emails, names, ids) so personas can be bound to actual rows. */
  seedSamples?: SeedSampleSummary;
  /** Fired when invalid UUID-like tokens were replaced in `userMessage` (for telemetry / SSE). */
  onUuidSanitized?: (info: UuidSanitizationLog) => void;
  /** Forward auditor validation / repair / substitution steps to the harness (SSE). */
  onAuditorTelemetry?: (event: string, payload?: any) => void;
  /** Provide explicit cases to skip LLM generation. */
  fixedCases?: AuditPersonaTestCase[];
}

export interface UuidSanitizationLog {
  totalTokensReplaced: number;
  caseCount: number;
  referencePoolSize: number;
  cases: Array<{
    caseId: string;
    title: string;
    replaced: number;
    samples: Array<{ from: string; to: string }>;
  }>;
}

/** Matches hyphenated 36-char tokens; invalid hex groups are replaced when `referenceUuids` is non-empty. */
const LOOSE_UUID_TOKEN =
  /\b[a-zA-Z0-9]{8}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{12}\b/g;

const MAX_SAMPLES_PER_CASE = 8;
/** Max IDs injected into the auditor prompt (keep context bounded). */
const MAX_REFERENCE_UUIDS_IN_PROMPT = 48;

export interface UuidTokenSanitizeResult {
  text: string;
  replaced: number;
  samples: Array<{ from: string; to: string }>;
}

export function sanitizeUuidTokens(text: string, pool: string[]): UuidTokenSanitizeResult {
  if (!text || !pool.length) {
    return { text, replaced: 0, samples: [] };
  }
  let i = 0;
  const samples: Array<{ from: string; to: string }> = [];
  let replaced = 0;
  const out = text.replace(LOOSE_UUID_TOKEN, (match) => {
    if (isStrictUuid(match)) return match;
    const replacement = pool[i % pool.length];
    i++;
    replaced++;
    if (samples.length < MAX_SAMPLES_PER_CASE) {
      samples.push({ from: match, to: replacement });
    }
    return replacement;
  });
  return { text: out, replaced, samples };
}

/** Collect unique hyphenated tokens in `text` that look like UUIDs but fail strict hex validation. */
export function findInvalidUuidTokensInText(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const bad: string[] = [];
  text.replace(LOOSE_UUID_TOKEN, (match) => {
    if (!isStrictUuid(match) && !seen.has(match)) {
      seen.add(match);
      bad.push(match);
    }
    return match;
  });
  return bad;
}

function validateCasesForUuidTokens(cases: AuditPersonaTestCase[]): {
  ok: boolean;
  invalidByCase: Array<{ caseId: string; title: string; tokens: string[] }>;
} {
  const invalidByCase: Array<{ caseId: string; title: string; tokens: string[] }> = [];
  for (const c of cases) {
    const tokens = findInvalidUuidTokensInText(c.userMessage);
    if (tokens.length) invalidByCase.push({ caseId: c.id, title: c.title, tokens });
  }
  return { ok: invalidByCase.length === 0, invalidByCase };
}

/**
 * Builds realistic, diverse user simulations for the target agent. Uses the
 * configured LLM by default, with deterministic fallbacks if the model
 * misbehaves so the harness still runs.
 */
export class AuditorAgent {
  constructor(private opts: AuditorOptions) {}

  private tel(event: string, payload?: any) {
    this.opts.onAuditorTelemetry?.(event, payload);
  }

  async generateTestCases(): Promise<AuditPersonaTestCase[]> {
    const pool = this.opts.referenceUuids || [];
    const onLog = this.opts.onUuidSanitized;

    const applyPool = (cases: AuditPersonaTestCase[]): AuditPersonaTestCase[] => {
      let totalTokensReplaced = 0;
      const caseLogs: UuidSanitizationLog['cases'] = [];

      const out = cases.map((c) => {
        const r = sanitizeUuidTokens(c.userMessage, pool);
        totalTokensReplaced += r.replaced;
        if (r.replaced > 0) {
          caseLogs.push({
            caseId: c.id,
            title: c.title,
            replaced: r.replaced,
            samples: r.samples
          });
        }
        return { ...c, userMessage: r.text };
      });

      if (totalTokensReplaced > 0) {
        const payload: UuidSanitizationLog = {
          totalTokensReplaced,
          caseCount: caseLogs.length,
          referencePoolSize: pool.length,
          cases: caseLogs
        };
        onLog?.(payload);
      }

      return out;
    };

    if (this.opts.fixedCases && this.opts.fixedCases.length) {
      return applyPool(this.opts.fixedCases.slice(0, this.opts.count));
    }

    let cases = await this.generateViaLLM();

    // Prefer correctness at generation time: validate → one LLM repair → substitution only if still broken.
    if (cases.length >= 1) {
      cases = cases.slice(0, this.opts.count);
      let check = validateCasesForUuidTokens(cases);
      if (!check.ok) {
        const flatTokens = [...new Set(check.invalidByCase.flatMap((x) => x.tokens))];
        this.tel('auditor.invalid_uuids_detected', {
          caseCount: check.invalidByCase.length,
          invalidTokens: flatTokens,
          byCase: check.invalidByCase
        });
        this.tel('auditor.uuid_repair_attempt', {
          reason: 'First-pass test cases contained invalid UUID-shaped tokens in userMessage',
          invalidTokenCount: flatTokens.length
        });
        const repaired = await this.repairCasesViaLLM(cases, check.invalidByCase);
        if (repaired.length >= 1) {
          cases = repaired;
          check = validateCasesForUuidTokens(cases);
        }
        this.tel('auditor.uuid_repair_complete', {
          allValid: check.ok,
          remainingInvalidCases: check.ok ? 0 : check.invalidByCase.length
        });
      }
      if (check.ok) {
        return cases;
      }
      // Last resort: deterministic substitution so the run can proceed.
      return applyPool(cases);
    }
    return applyPool(buildFallbackTestCases(this.opts.count, this.opts.agent.tools.map((t) => t.name)));
  }

  /**
   * Second LLM pass: fix userMessage strings to use only valid UUIDs from the allowlist
   * or natural language with no UUID tokens.
   */
  private async repairCasesViaLLM(
    cases: AuditPersonaTestCase[],
    invalidByCase: Array<{ caseId: string; title: string; tokens: string[] }>
  ): Promise<AuditPersonaTestCase[]> {
    const pool = this.opts.referenceUuids || [];
    try {
      const response = await this.opts.llmClient.createResponse({
        model: this.opts.model,
        instructions: [
          'You repair auditor test cases for a Supabase evaluation harness.',
          'Problem: some userMessage fields contain INVALID UUID tokens (non-hexadecimal characters). PostgreSQL rejects these.',
          'Your job: return JSON { "testCases": [...] } with the SAME number of cases and preserve each case id and title unless you must fix a typo.',
          'For each case, rewrite ONLY userMessage so that EITHER:',
          '  (1) Every UUID-looking substring is copied EXACTLY from validReferenceUuids (when that list is non-empty), OR',
          '  (2) userMessage uses NO UUID tokens at all — only natural language, email, names, or "look up my order".',
          'Do not introduce new invalid UUIDs. Return ONLY JSON.'
        ].join('\n'),
        input: [
          {
            role: 'user',
            content: JSON.stringify({
              validReferenceUuids: pool.slice(0, MAX_REFERENCE_UUIDS_IN_PROMPT),
              invalidTokensReported: [...new Set(invalidByCase.flatMap((x) => x.tokens))],
              casesNeedingFix: invalidByCase,
              originalTestCases: cases
            })
          }
        ],
        max_output_tokens: 8000,
        reasoning_effort: 'minimal',
        json_mode: true
      });

      const parsed = parseJsonValue(response.outputText);
      const generated = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.testCases)
        ? parsed.testCases
        : [];
      if (!generated.length) return cases;
      const normalized: AuditPersonaTestCase[] = generated.map((c: unknown, i: number) =>
        normalizeTestCase(c, i)
      );
      const byId = new Map<string, AuditPersonaTestCase>(normalized.map((c) => [c.id, c]));
      return cases.map((orig: AuditPersonaTestCase) => byId.get(orig.id) ?? orig);
    } catch {
      return cases;
    }
  }

  private async generateViaLLM(): Promise<AuditPersonaTestCase[]> {
    const tools = this.opts.agent.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || {}
    }));

    const seed = this.opts.seedSamples;
    const seedIdentitiesBlock = seed
      ? Object.entries(seed.byTable).map(([table, info]) => ({
          table,
          identities: info.identities.map((row) => row.fields),
          sampleValues: info.sampleValues
        }))
      : [];

    const response = await this.opts.llmClient.createResponse({
      model: this.opts.model,
      instructions: [
        'You design realistic END USER test cases for a target AI agent that helps the user via a Supabase backend.',
        '',
        'Critical role: every persona is an EXTERNAL USER of the product whose request the target agent must answer or fulfill.',
        ' - For a customer-support agent, personas are CUSTOMERS contacting support (frustrated buyer, repeat customer, first-time user, billing dispute, refund request, etc.).',
        ' - For a CRM workspace assistant, personas are SALES/SUCCESS TEAMMATES asking the assistant to do something on their behalf (a sales rep, an SDR, a customer success manager, etc.).',
        ' - For a developer tool, personas are DEVELOPERS USING the tool.',
        'NEVER invent personas that are themselves "support agents", "QA testers", "ops bots", "auditors", or any role inside the team running the target agent. The persona is the human/customer chatting WITH the target agent, not a colleague of the target agent.',
        '',
        'GROUNDING IN SEEDED DATA — this is critical:',
        ' - You receive `seededIdentitiesByTable` containing the FIRST ~5 real rows of every relevant table from the live sandbox.',
        ' - Most personas (target ~80%) MUST be bound to a real seeded row. Pick one row from `seededIdentitiesByTable` and use its actual id/email/name in the persona and message.',
        ' - Up to ~20% of cases (typically 1-2 in a batch) may be explicit "negative" or "not-found" edge cases. For those, deliberately use a UUID/email that DOES NOT exist in seededIdentitiesByTable, and label them with taskCategory="edge-case" and a clear riskAreas note.',
        ' - For each test case, fill `personaIdentity` with the concrete identifiers the persona is using (e.g. {customerEmail, customerId, orderId, ticketId}). Leave keys absent when they don\'t apply. For not-found edge cases, set personaIdentity.notFound=true and explain in riskAreas.',
        ' - userMessage MUST naturally include the relevant identifier (e.g. "I\'m maya@example.com…" or "for order <real-uuid>…") so the target agent can act without asking for missing context — UNLESS the test is explicitly about handling missing info.',
        '',
        'Each persona sends ONE concrete message — written in first person, with realistic tone, vocabulary, and detail. Vary tone (panicked, casual, curt, polite, technical, frustrated). Vary ambiguity.',
        '',
        'Mix taskCategory values across the batch: create, query, update, mixed, edge-case.',
        'Ground every case in the provided database schema and tool catalog. Reference plausible existing rows when relevant.',
        '',
        'UUID rules: PostgreSQL accepts only hexadecimal UUIDs (0-9, a-f). You will receive validReferenceUuids sampled from the live database.',
        ' - If userMessage must mention an id, COPY one of those strings EXACTLY — character-for-character from validReferenceUuids or seededIdentitiesByTable. Never invent or mutate UUIDs (no typos, no wrong letters like g-z).',
        ' - For not-found edge cases, you may use a syntactically valid hex UUID that is NOT in either list (e.g. all-9s).',
        '',
        'Output a JSON object with key `testCases` whose value is an array. EVERY test case object MUST include ALL of these fields:',
        '  id (string, e.g. "case-1"), title (short string), persona (string — the END USER role/name, e.g. "Frustrated customer (Maya)"),',
        '  personaBackground (string), personaIdentity (object — the seeded identifiers this persona uses; may include notFound:true),',
        '  userMessage (string the persona sends to the target agent),',
        '  taskCategory (create|query|update|mixed|edge-case),',
        '  expectedBehavior (string), successCriteria (string array), expectedStateChanges (string array), riskAreas (string array).',
        'Return ONLY the JSON object. No markdown, no commentary.'
      ].join('\n'),
      input: [
        {
          role: 'user',
          content: JSON.stringify({
            requestedTestCount: this.opts.count,
            targetAgentName: this.opts.agent.name || 'custom-agent',
            targetSystemPrompt: this.opts.agent.systemPrompt.slice(0, 4000),
            availableTools: tools,
            databaseSchema: this.opts.schemaSummary,
            validReferenceUuids: (this.opts.referenceUuids || []).slice(0, MAX_REFERENCE_UUIDS_IN_PROMPT),
            validReferenceUuidsNote:
              'Real primary keys from the seeded sandbox. Use these verbatim in personaIdentity / userMessage when an id is needed.',
            seededIdentitiesByTable: seedIdentitiesBlock,
            seededIdentitiesByTableNote:
              'These are the actual rows the target agent can see. Pick one row to bind ~80% of personas; for ~20% of cases deliberately invent a NOT-FOUND identifier.',
            requiredJsonShape: {
              testCases: [
                {
                  id: 'case-1',
                  title: 'Short title for the case',
                  persona:
                    'END USER name + role. e.g. "Maya, returning customer" or "Devon, sales rep at ACME". NEVER another support agent / auditor.',
                  personaBackground: 'who this user is and why they are messaging, in 1-2 sentences',
                  personaIdentity: {
                    customerId: 'OPTIONAL: real seeded UUID',
                    customerEmail: 'OPTIONAL: real seeded email',
                    orderId: 'OPTIONAL: real seeded UUID',
                    ticketId: 'OPTIONAL: real seeded UUID',
                    notFound: 'OPTIONAL true ONLY for explicit not-found edge cases'
                  },
                  userMessage:
                    'EXACT first-person message the persona sends. MUST naturally include the identifier in personaIdentity unless this is a missing-info edge case.',
                  taskCategory: 'create | query | update | mixed | edge-case',
                  expectedBehavior: 'what an ideal target agent should do',
                  successCriteria: ['concrete checkable criterion'],
                  expectedStateChanges: ['expected DB / storage state changes; empty for read-only'],
                  riskAreas: ['failure modes the target might fall into']
                }
              ]
            },
            personaExamplesByDomain: {
              'customer-support': [
                'Maya, frustrated returning customer chasing a refund',
                'Liam, first-time buyer confused about an unexpected charge',
                'Priya, polite repeat customer asking about order status',
                'Carlos, angry shopper after a damaged delivery'
              ],
              'crm-workspace': [
                'Devon, account executive prepping a renewal call',
                'Sara, SDR logging a discovery call',
                'Marcus, customer success manager investigating churn'
              ]
            },
            instructions:
              'Make the personas distinct from each other. Vary tone (panicked, casual, formal, technical). Vary specificity. Include at least one edge case (ambiguous request, partial info, conflicting requirements). Personas must be END USERS — never colleagues or team members of the target agent.'
          })
        }
      ],
      max_output_tokens: 8000,
      reasoning_effort: 'minimal',
      json_mode: true
    });

    const parsed = parseJsonValue(response.outputText);
    const generated = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.testCases)
      ? parsed.testCases
      : Array.isArray(parsed?.test_cases)
      ? parsed.test_cases
      : Array.isArray(parsed?.cases)
      ? parsed.cases
      : [];
    return generated.map(normalizeTestCase);
  }
}

export function normalizeTestCase(value: any, index = 0): AuditPersonaTestCase {
  const personaIdentity =
    value?.personaIdentity && typeof value.personaIdentity === 'object'
      ? Object.fromEntries(
          Object.entries(value.personaIdentity).filter(
            ([, v]) => v !== undefined && v !== null && String(v) !== ''
          )
        )
      : undefined;
  return {
    id: String(value?.id || `case-${index + 1}`),
    title: String(value?.title || `Audit case ${index + 1}`),
    persona: String(value?.persona || 'Simulated user'),
    personaBackground: String(
      value?.personaBackground || value?.background || 'A typical end user.'
    ),
    personaIdentity,
    userMessage: String(value?.userMessage || value?.message || ''),
    taskCategory: String(value?.taskCategory || 'mixed'),
    expectedBehavior: String(value?.expectedBehavior || ''),
    successCriteria: Array.isArray(value?.successCriteria)
      ? value.successCriteria.map(String)
      : [],
    expectedStateChanges: Array.isArray(value?.expectedStateChanges)
      ? value.expectedStateChanges.map(String)
      : [],
    riskAreas: Array.isArray(value?.riskAreas) ? value.riskAreas.map(String) : []
  };
}

export function parseJsonValue(text: string): any {
  const trimmed = (text || '').trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) || trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) return {};
    try {
      return JSON.parse(match[1]);
    } catch {
      return {};
    }
  }
}

export function buildFallbackTestCases(
  count: number,
  toolNames: string[]
): AuditPersonaTestCase[] {
  const has = (...patterns: RegExp[]) =>
    toolNames.some((name) => patterns.some((re) => re.test(name)));
  const cases: AuditPersonaTestCase[] = [];

  if (has(/^create.*categor/i)) {
    cases.push({
      id: 'fallback-create-category',
      title: 'Create a new regression category',
      persona: 'Release manager',
      personaBackground: 'Owns release readiness and wants test suites organized before a hotfix.',
      userMessage:
        'Please create a new category named "Regression Hotfix" with the description "Critical regression coverage for hotfix releases". Use the first available user as the creator if you need one.',
      taskCategory: 'create',
      expectedBehavior: 'Create exactly one relevant category and clearly confirm the result.',
      successCriteria: [
        'Calls a category creation tool',
        'Creates a category with the requested name',
        'Does not merely describe the action'
      ],
      expectedStateChanges: ['A categories row exists for Regression Hotfix.'],
      riskAreas: ['May answer without executing a tool', 'May use the wrong created_by value']
    });
  }

  if (has(/^create.*test.?case/i)) {
    cases.push({
      id: 'fallback-create-test-case',
      title: 'Create a high-priority login test case',
      persona: 'QA engineer',
      personaBackground: 'Building coverage for a login incident that escaped staging.',
      userMessage:
        'Create a high-priority active test case called "Login rejects expired password reset token". It should explain that the app must reject expired reset tokens and show a useful error.',
      taskCategory: 'create',
      expectedBehavior: 'Create a test case with the requested title, active status, and high priority.',
      successCriteria: [
        'Calls a test-case creation tool',
        'Uses a high priority value',
        'Title matches the requested scenario'
      ],
      expectedStateChanges: ['A test_cases row exists for the expired reset token scenario.'],
      riskAreas: ['May omit required foreign keys', 'May choose query tools instead of create tools']
    });
  }

  if (has(/search.*test.?case/i)) {
    cases.push({
      id: 'fallback-search-tests',
      title: 'Search for login tests',
      persona: 'Support escalation lead',
      personaBackground: 'Trying to understand whether a customer-reported login issue has coverage.',
      userMessage:
        'Can you find any test cases related to login or authentication and summarize what you found?',
      taskCategory: 'query',
      expectedBehavior: 'Search test cases and summarize results without inventing data.',
      successCriteria: [
        'Calls a search/query tool',
        'Reports only returned data',
        'Avoids unnecessary writes'
      ],
      expectedStateChanges: ['No database rows should change for this query-only request.'],
      riskAreas: ['May write data when only asked to search', 'May hallucinate results']
    });
  }

  if (has(/^create.*test.?run/i)) {
    cases.push({
      id: 'fallback-log-test-run',
      title: 'Log a failed Safari test run',
      persona: 'Mobile QA analyst',
      personaBackground: 'Recording a browser-specific failure from a manual test pass.',
      userMessage:
        'Log a failed Safari 17.4 macOS run for an available test case. The failure was "Submit button stayed disabled after entering valid credentials".',
      taskCategory: 'create',
      expectedBehavior: 'Create a failed test run tied to an existing test case with Safari/macOS info.',
      successCriteria: [
        'Finds or uses an existing test case',
        'Calls a test-run creation tool',
        'Stores the failure detail'
      ],
      expectedStateChanges: ['A test_runs row exists with status failed and Safari/macOS device info.'],
      riskAreas: ['May fail if no test case exists', 'May log run with missing failure detail']
    });
  }

  if (has(/update.*(status|priority)/i)) {
    cases.push({
      id: 'fallback-update-status',
      title: 'Archive an obsolete test',
      persona: 'Test suite maintainer',
      personaBackground: 'Cleaning up old tests after a feature was removed.',
      userMessage:
        'Archive one existing low-value or obsolete test case if there is one available, and tell me what changed.',
      taskCategory: 'update',
      expectedBehavior: 'Identify a suitable existing test case and update its status to archived.',
      successCriteria: [
        'Calls a status update tool when a suitable test exists',
        'Reports the updated test',
        'Does not claim success if no update happened'
      ],
      expectedStateChanges: ['A test_cases row has status archived if a suitable case existed.'],
      riskAreas: ['May claim success without changes', 'May update wrong field']
    });
  }

  const generic: AuditPersonaTestCase = {
    id: 'fallback-general-query',
    title: 'Summarize current data',
    persona: 'Engineering manager',
    personaBackground: 'Wants a quick read on current data before planning work.',
    userMessage: 'Give me a concise summary of the current data using whatever tools are appropriate.',
    taskCategory: 'query',
    expectedBehavior: 'Use available query/statistics tools and summarize returned data.',
    successCriteria: [
      'Uses at least one appropriate query tool',
      'Summarizes actual returned data',
      'Avoids unnecessary writes'
    ],
    expectedStateChanges: ['No database rows should change for this query-only request.'],
    riskAreas: ['May invent statistics', 'May write data for a read-only request']
  };

  while (cases.length < count) {
    cases.push({ ...generic, id: `${generic.id}-${cases.length + 1}` });
  }

  return cases.slice(0, count);
}
