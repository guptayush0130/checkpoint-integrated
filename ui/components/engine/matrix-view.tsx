'use client';

interface MatrixPayload {
  rowCount: number;
  coveragePercent: number;
  totalTriplets: number;
  rows: Array<{ id: string; assignments: Record<string, any> }>;
}

export function MatrixView({ matrix }: { matrix: MatrixPayload }) {
  if (!matrix.rows.length) return null;
  const factorNames = Object.keys(matrix.rows[0]?.assignments || {});

  return (
    <section className="rounded-lg border border-cream-300 bg-white">
      <div className="flex items-baseline justify-between border-b border-cream-300 px-5 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          3-way combinatorial matrix
        </h2>
        <span className="font-mono text-xs text-ink-100">
          {matrix.rows.length} rows · {matrix.coveragePercent}% of {matrix.totalTriplets} triplets
        </span>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full font-mono text-xs">
          <thead className="sticky top-0 bg-cream-100 text-ink-500">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">id</th>
              {factorNames.map((n) => (
                <th key={n} className="px-3 py-2 text-left whitespace-nowrap">
                  {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row, i) => (
              <tr key={row.id} className="border-t border-cream-300 hover:bg-cream-50">
                <td className="px-3 py-1.5 text-ink-100">{i + 1}</td>
                <td className="px-3 py-1.5 text-ink-100">{row.id}</td>
                {factorNames.map((n) => (
                  <td key={n} className="px-3 py-1.5 text-ink-500">
                    {previewLevel(row.assignments[n])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function previewLevel(v: any): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object' && 'value' in v) {
    const inner =
      typeof v.value === 'string' && v.value.length > 16
        ? `${v.value.slice(0, 16)}…`
        : v.value === null
        ? 'null'
        : JSON.stringify(v.value);
    return `${inner} (${v.role})`;
  }
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}
