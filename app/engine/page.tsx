/**
 * /engine — Phase 4 dashboard entry point.
 *
 * The new-run wizard collects everything the engine needs:
 *   - SDK spec (system prompt + tools)
 *   - Personas (one per line)
 *   - Objectives (one per line)
 *   - Sandbox schema (DDL or fields[])
 *   - Target endpoint config (URL + profile + auth)
 *
 * Posts to POST /api/engine/runs and redirects to /engine/[runId].
 */
import { NewRunForm } from '@/components/engine/new-run-form';

export const dynamic = 'force-dynamic';

export default function EngineHome() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="font-serif text-4xl text-ink-500">Checkpoint — new run</h1>
        <p className="mt-2 text-ink-100">
          Upload your agent's SDK spec, personas, and objectives. The engine boots a
          Supabase-compatible sandbox, generates a 3-way combinatorial matrix, and
          drives MCTS through your external target agent at URL 1 to find conversations
          that break it.
        </p>
      </header>
      <NewRunForm />
    </div>
  );
}
