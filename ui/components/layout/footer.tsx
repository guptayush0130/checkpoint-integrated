export function Footer() {
  return (
    <footer className="border-t border-cream-300 bg-cream-100">
      <div className="container-fixed flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-100">
          © 2026 Checkpoint Labs · The test layer for AI agents.
        </p>
        <p className="font-mono text-2xs uppercase tracking-[0.16em] text-ink-50">
          v1.0 · local mode
        </p>
      </div>
    </footer>
  );
}
