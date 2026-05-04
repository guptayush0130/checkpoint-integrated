/**
 * Harness integration test using a deterministic FakeLLM. Verifies that the
 * full auditor → target → judge → reporter loop runs end-to-end without
 * touching OpenAI.
 *
 * Run with:  npx ts-node tests/harness.test.ts
 */

import path from 'node:path';
import assert from 'node:assert';
import {
  AuditHarness,
  LLMClient,
  LLMResponseRequest,
  LLMResponseResult,
  renderAuditReport
} from '../src/harness';
import { MockSupabaseInstance } from '../src/mock';
import agent from '../examples/agents/test-management-agent';

class FakeLLM implements LLMClient {
  private targetTurnCounter = 0;

  async createResponse(req: LLMResponseRequest): Promise<LLMResponseResult> {
    const role = inferRole(req);
    if (role === 'judge') return jsonResponse(this.judgeAnswer());
    if (role === 'auditor') return jsonResponse(this.auditorAnswer());
    return this.targetAnswer(req);
  }

  private auditorAnswer() {
    return {
      testCases: [
        {
          id: 'fake-search',
          title: 'Find authentication tests',
          persona: 'Support engineer',
          personaBackground: 'Investigating a customer report.',
          userMessage: 'Find any test cases related to authentication and tell me what status they are in.',
          taskCategory: 'query',
          expectedBehavior: 'Use a search tool, then summarize.',
          successCriteria: ['Calls search-test-cases', 'No DB writes'],
          expectedStateChanges: [],
          riskAreas: ['May invent results']
        },
        {
          id: 'fake-create-category',
          title: 'Create a new category',
          persona: 'QA lead',
          personaBackground: 'Organizing tests for a new module.',
          userMessage: 'Please create a category called "Onboarding QA" describing onboarding flow coverage.',
          taskCategory: 'create',
          expectedBehavior: 'Insert into categories.',
          successCriteria: ['Calls create-new-category'],
          expectedStateChanges: ['One new categories row.'],
          riskAreas: ['May skip executing the tool']
        }
      ]
    };
  }

  private judgeAnswer() {
    return {
      passed: true,
      score: 86,
      breakdown: {
        taskCompletion: 18,
        toolSelection: 17,
        dataVerification: 18,
        communication: 16,
        safety: 17
      },
      summary: 'Target executed the right tool and explained results plainly.',
      whatWentWell: ['Picked the correct tool', 'Reported actual data'],
      failures: [],
      idealBehavior: 'Run search, then summarize results clearly.',
      actionVerification: 'Verification matched: row counts and tool outputs are consistent.',
      couldDoBetter: ['Add cross-checks for edge cases.']
    };
  }

  private targetAnswer(req: LLMResponseRequest): LLMResponseResult {
    // Inspect the input to decide what to do. The first turn for each case
    // calls a tool; the second turn writes a closing message and stops.
    const userText = JSON.stringify(req.input).toLowerCase();
    this.targetTurnCounter++;

    const wantsCreate = userText.includes('create a category') || userText.includes('onboarding qa');
    const wantsSearch = !wantsCreate && (userText.includes('authentication') || userText.includes('search'));

    // If we already produced a tool call (any function_call_output present), close out.
    const alreadyToolReturn = JSON.stringify(req.input).includes('"function_call_output"');
    if (alreadyToolReturn) {
      return {
        model: req.model,
        outputText: 'Done.',
        output: [],
        raw: {}
      };
    }

    let toolCall;
    if (wantsCreate) {
      toolCall = {
        type: 'function_call',
        call_id: 'call_create',
        name: 'create-new-category',
        arguments: JSON.stringify({ name: 'Onboarding QA', description: 'Onboarding flow coverage' })
      };
    } else if (wantsSearch) {
      toolCall = {
        type: 'function_call',
        call_id: 'call_search',
        name: 'search-test-cases',
        arguments: JSON.stringify({ query: 'login' })
      };
    } else {
      toolCall = {
        type: 'function_call',
        call_id: 'call_default',
        name: 'get-test-run-statistics',
        arguments: '{}'
      };
    }
    return {
      model: req.model,
      outputText: '',
      output: [toolCall],
      raw: {}
    };
  }
}

function inferRole(req: LLMResponseRequest): 'auditor' | 'target' | 'judge' {
  const instructions = req.instructions || '';
  if (/judge/i.test(instructions)) return 'judge';
  if (/auditor/i.test(instructions)) return 'auditor';
  return 'target';
}

function jsonResponse(value: any): LLMResponseResult {
  return {
    model: 'fake',
    outputText: JSON.stringify(value),
    output: [],
    raw: {}
  };
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const schemaFile = path.join(projectRoot, 'examples/schemas/test-management.sql');
  const instance = new MockSupabaseInstance({
    name: 'harness-test',
    schema: { file: schemaFile },
    seed: { file: schemaFile }
  });

  const harness = new AuditHarness({
    llmClient: new FakeLLM(),
    targetAgent: agent,
    instance,
    defaultModel: 'fake-model',
    testCount: 2,
    onProgress: () => {}
  });

  let report;
  try {
    report = await harness.run();
  } finally {
    await instance.teardown();
  }

  assert.strictEqual(report.testCount, 2, 'Expected 2 test cases');
  assert.ok(report.records.every((r) => r.targetRun.toolCalls.length >= 1), 'Each test case should make at least one tool call');
  const createRecord = report.records.find((r) => r.testCase.id === 'fake-create-category');
  assert.ok(createRecord, 'Expected fake-create-category record');
  assert.ok(createRecord!.verification.addedRowCount >= 1, 'Create case should have added at least 1 row');

  const searchRecord = report.records.find((r) => r.testCase.id === 'fake-search');
  assert.ok(searchRecord, 'Expected fake-search record');
  assert.strictEqual(
    searchRecord!.verification.addedRowCount + searchRecord!.verification.changedRowCount + searchRecord!.verification.removedRowCount,
    0,
    'Search-only case should not change DB state'
  );

  const md = renderAuditReport(report);
  assert.ok(md.includes('# Agent Audit Report'), 'Report should start with header');
  assert.ok(md.includes('Per-Test Scoreboard'), 'Report should include scoreboard');
  assert.ok(md.includes('Schema Snapshot'), 'Report should include schema snapshot section');

  console.log(`\nHarness test passed.`);
  console.log(`  Tests run:    ${report.testCount}`);
  console.log(`  Pass count:   ${report.passCount}`);
  console.log(`  Avg score:    ${report.averageScore.toFixed(1)}`);
  console.log(`  Markdown len: ${md.length} chars`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
