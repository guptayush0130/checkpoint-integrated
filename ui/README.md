# ui/

React components consumed by Next.js pages under `/app`.

## Why `app/` is at the project root and not under `ui/`

Next.js 15 fixes the App Router location at `app/` (project root) or `src/app/`. There is no config to relocate to `ui/app/`. Per ARCHITECTURE.md:

- **`/app`** — Next.js routes (UI pages + API handlers). Required at project root by Next.js.
- **`/ui/components`** — All React components live here.

This is the only directive from the Phase 0 plan that the framework forced us to bend. The semantic separation is preserved: UI rendering code (pages + components) is grouped, engine/sandbox/clients are clean.

## Phase 3 additions

- `ui/components/upload/` — drag-and-drop SDK spec + persona/objective/schema editors
- `ui/components/matrix/` — combinatorial 3-way matrix table view with factor breakdown
- `ui/components/tree/` — live MCTS tree visualization (react-d3-tree or hand-rolled SVG)
- `ui/components/sandbox/` — intercepted-tool-call panel showing every URL 2 hit in real-time
