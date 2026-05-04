import { AuditRunReport, AuditTestRecord, ToolCallRecord } from './types';

/**
 * Renders a comprehensive Markdown report. Designed to be readable end-to-end
 * AND grep-friendly: every section has stable headings + IDs.
 */
export function renderAuditReport(report: AuditRunReport): string {
  const out: string[] = [];

  out.push('# Agent Audit Report');
  out.push('');
  out.push(metaTable(report));
  out.push('');
  out.push('## Run Summary');
  out.push('');
  out.push(summaryTable(report));
  out.push('');
  out.push('## Per-Test Scoreboard');
  out.push('');
  out.push(scoreboardTable(report));
  out.push('');
  out.push('## Schema Snapshot at Audit Start');
  out.push('');
  out.push(schemaTable(report));
  out.push('');

  for (let i = 0; i < report.records.length; i++) {
    out.push(renderRecord(report.records[i], i));
    out.push('');
  }

  out.push('## End of Report');
  return out.join('\n');
}

function metaTable(report: AuditRunReport): string {
  return [
    '| Field | Value |',
    '| --- | --- |',
    `| Run ID | \`${report.runId}\` |`,
    `| Target agent | \`${report.targetAgentName}\` |`,
    `| Started | ${report.startedAt} |`,
    `| Completed | ${report.completedAt} |`,
    `| Duration | ${formatMs(report.totalDurationMs)} |`,
    `| Auditor model | \`${report.auditorModel}\` |`,
    `| Target model | \`${report.targetModel}\` |`,
    `| Judge model | \`${report.judgeModel}\` |`
  ].join('\n');
}

function summaryTable(report: AuditRunReport): string {
  const passRate =
    report.testCount > 0 ? ((report.passCount / report.testCount) * 100).toFixed(1) : '0.0';
  return [
    '| Metric | Value |',
    '| --- | --- |',
    `| Test cases | ${report.testCount} |`,
    `| Passed | ${report.passCount} |`,
    `| Failed | ${report.failCount} |`,
    `| Pass rate | ${passRate}% |`,
    `| Average score | ${report.averageScore.toFixed(1)} / 100 |`
  ].join('\n');
}

function scoreboardTable(report: AuditRunReport): string {
  const rows = ['| # | Title | Persona | Category | Result | Score | Tools | Failures | Duration |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  report.records.forEach((record, idx) => {
    const tc = record.testCase;
    const j = record.judge;
    const v = record.verification;
    rows.push(
      `| ${idx + 1} | ${escapeCell(tc.title)} | ${escapeCell(tc.persona)} | ${escapeCell(tc.taskCategory)} | ${
        j.passed ? 'PASS' : 'FAIL'
      } | ${j.score.toFixed(1)} | ${record.targetRun.toolCalls.length} | ${v.failedToolCallCount} | ${formatMs(record.durationMs)} |`
    );
  });
  return rows.join('\n');
}

function schemaTable(report: AuditRunReport): string {
  if (!report.schemaSummary || !report.schemaSummary.tables.length) {
    return '_No schema introspected._';
  }
  const lines = ['| Table | Columns | Rows at start |', '| --- | --- | --- |'];
  for (const table of report.schemaSummary.tables) {
    const cols = table.columns.map((c) => `\`${c.name}\` ${c.type}${c.nullable ? '?' : ''}`).join(', ');
    lines.push(`| \`${table.name}\` | ${cols} | ${table.rowCount} |`);
  }
  if (report.schemaSummary.foreignKeys.length) {
    lines.push('');
    lines.push('Foreign keys:');
    for (const fk of report.schemaSummary.foreignKeys) {
      lines.push(`- \`${fk.fromTable}.${fk.fromColumn}\` → \`${fk.toTable}.${fk.toColumn}\``);
    }
  }
  return lines.join('\n');
}

function renderRecord(record: AuditTestRecord, index: number): string {
  const { testCase, targetRun, verification, judge } = record;
  const lines: string[] = [];
  const headerNum = index + 1;
  const status = judge.passed ? 'PASS' : 'FAIL';

  lines.push(`## Test ${headerNum}: ${testCase.title} — ${status} (${judge.score.toFixed(1)} / 100)`);
  lines.push('');
  lines.push(`- **Test ID:** \`${testCase.id}\``);
  lines.push(`- **Persona:** ${testCase.persona}`);
  lines.push(`- **Persona background:** ${testCase.personaBackground}`);
  lines.push(`- **Task category:** ${testCase.taskCategory}`);
  lines.push(`- **Duration:** ${formatMs(record.durationMs)}`);
  lines.push('');

  lines.push('### User request');
  lines.push('');
  lines.push(block(testCase.userMessage));
  lines.push('');

  lines.push('### Auditor expectations');
  lines.push('');
  lines.push(`**Expected behavior.** ${testCase.expectedBehavior || '_Not provided._'}`);
  lines.push('');
  lines.push('**Success criteria:**');
  lines.push(bulletList(testCase.successCriteria));
  lines.push('');
  lines.push('**Expected state changes:**');
  lines.push(bulletList(testCase.expectedStateChanges || []));
  lines.push('');
  lines.push('**Risk areas:**');
  lines.push(bulletList(testCase.riskAreas));
  lines.push('');

  lines.push('### Target agent execution');
  lines.push('');
  lines.push('**Final response to user:**');
  lines.push(block(targetRun.finalResponse || '_(no final response)_'));
  lines.push('');
  lines.push(`Reached max tool iterations: \`${targetRun.reachedMaxToolIterations}\`  `);
  lines.push(`Total turns: \`${targetRun.turns.length}\`  `);
  lines.push(`Total tool calls: \`${targetRun.toolCalls.length}\`  `);
  lines.push('');
  lines.push('**Visible reasoning summaries:**');
  lines.push(bulletList(targetRun.reasoningSummaries.length ? targetRun.reasoningSummaries : ['_(model returned none)_']));
  lines.push('');
  lines.push('**Tool calls (in order):**');
  lines.push(renderToolCalls(targetRun.toolCalls));
  lines.push('');

  lines.push('### Sandbox verification');
  lines.push('');
  lines.push(verificationTable(verification));
  lines.push('');
  if (verification.toolCallErrors.length) {
    lines.push('**Tool call errors:**');
    lines.push(bulletList(verification.toolCallErrors));
    lines.push('');
  }
  lines.push('**Database state diff:**');
  lines.push('');
  lines.push(block(JSON.stringify(verification.diff, null, 2), 'json'));
  lines.push('');

  lines.push('### Judge assessment');
  lines.push('');
  lines.push(judge.summary);
  lines.push('');
  lines.push('**Score breakdown (each /20):**');
  lines.push('');
  lines.push(judgeBreakdownTable(judge));
  lines.push('');
  lines.push('**Did the actions actually happen?**');
  lines.push('');
  lines.push(judge.actionVerification || '_Judge did not provide action verification._');
  lines.push('');
  lines.push('**What went well:**');
  lines.push(bulletList(judge.whatWentWell));
  lines.push('');
  lines.push('**What failed or was missing:**');
  lines.push(bulletList(judge.failures));
  lines.push('');
  lines.push('**Ideal behavior:**');
  lines.push('');
  lines.push(judge.idealBehavior || '_Judge did not provide ideal behavior._');
  lines.push('');
  lines.push('**Could it have done better?**');
  lines.push(bulletList(judge.couldDoBetter));

  return lines.join('\n');
}

function verificationTable(v: AuditTestRecord['verification']): string {
  return [
    '| Metric | Value |',
    '| --- | --- |',
    `| Tables checked | ${v.tables.length ? v.tables.map((t) => `\`${t}\``).join(', ') : '_none_'} |`,
    `| Successful tool calls | ${v.successfulToolCallCount} |`,
    `| Failed tool calls | ${v.failedToolCallCount} |`,
    `| Tables changed | ${v.changedTableCount} |`,
    `| Rows added | ${v.addedRowCount} |`,
    `| Rows changed | ${v.changedRowCount} |`,
    `| Rows removed | ${v.removedRowCount} |`
  ].join('\n');
}

function judgeBreakdownTable(judge: AuditTestRecord['judge']): string {
  return [
    '| Dimension | Score |',
    '| --- | --- |',
    `| Task completion | ${judge.breakdown.taskCompletion} / 20 |`,
    `| Tool selection | ${judge.breakdown.toolSelection} / 20 |`,
    `| Data verification | ${judge.breakdown.dataVerification} / 20 |`,
    `| Communication | ${judge.breakdown.communication} / 20 |`,
    `| Safety | ${judge.breakdown.safety} / 20 |`
  ].join('\n');
}

function renderToolCalls(toolCalls: ToolCallRecord[]): string {
  if (!toolCalls.length) return '- _No tool calls were made._';
  return toolCalls
    .map((call, idx) => {
      const status = call.error ? 'FAILED' : 'OK';
      const lines = [
        `${idx + 1}. \`${call.toolName}\` — ${status} in ${call.duration}ms`,
        `   - Params: ${inlineJson(call.params)}`,
        call.error
          ? `   - Error: ${call.error}`
          : `   - Result: ${inlineJson(call.result)}`
      ];
      return lines.join('\n');
    })
    .join('\n');
}

function bulletList(items: string[]): string {
  if (!items || items.length === 0) return '- _none_';
  return items.map((item) => `- ${item}`).join('\n');
}

function block(value: string, language = ''): string {
  const safe = (value || '').replace(/```/g, '\\`\\`\\`');
  return `\`\`\`${language}\n${safe}\n\`\`\``;
}

function inlineJson(value: any): string {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    json = String(value);
  }
  if (!json) return 'null';
  return json.length > 600 ? `${json.slice(0, 600)}…` : json;
}

function escapeCell(value: string): string {
  return (value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60_000).toFixed(2)}m`;
}
