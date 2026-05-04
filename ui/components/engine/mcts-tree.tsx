'use client';

import { useState } from 'react';

interface MCTSNode {
  id: string;
  prompt: string;
  reply: string;
  visits: number;
  value: number;
  depth: number;
  isTerminal: boolean;
  evaluation?: { verdict: string; reward: number; rationale: string };
  children: MCTSNode[];
}

export function McTsTreeView({ root }: { root: MCTSNode }) {
  if (!root) return null;
  return (
    <div className="rounded border border-cream-300 bg-white p-3 font-mono text-xs">
      <Node node={root} isRoot={true} />
    </div>
  );
}

function Node({ node, isRoot }: { node: MCTSNode; isRoot?: boolean }) {
  const [expanded, setExpanded] = useState(isRoot || node.depth <= 1);
  const verdict = node.evaluation?.verdict;
  const dot = verdictDot(verdict);
  const avg = node.visits > 0 ? (node.value / node.visits).toFixed(2) : '—';
  const promptLabel = isRoot
    ? '<root>'
    : node.prompt.length > 80
    ? `${node.prompt.slice(0, 80)}…`
    : node.prompt;

  return (
    <div className="ml-2">
      <div
        className="flex items-start gap-2 rounded py-0.5 hover:bg-cream-50 cursor-pointer"
        onClick={() => node.children.length && setExpanded(!expanded)}
      >
        <span
          className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full border ${dot.bg} ${dot.border}`}
          title={verdict || 'pending'}
        />
        <span className="flex-1">
          <span className="text-ink-500">{promptLabel}</span>
          <span className="ml-2 text-ink-100">
            v={node.visits} q={avg}
            {verdict && (
              <span className={`ml-2 ${dot.text}`}>{verdict}</span>
            )}
          </span>
          {node.reply && (
            <div className="mt-0.5 ml-0 text-[11px] text-ink-100">
              ↳ {node.reply.length > 100 ? `${node.reply.slice(0, 100)}…` : node.reply}
            </div>
          )}
        </span>
        {node.children.length > 0 && (
          <span className="font-mono text-[10px] text-ink-100">
            {expanded ? '▼' : '▶'} {node.children.length}
          </span>
        )}
      </div>
      {expanded && node.children.length > 0 && (
        <div className="ml-3 border-l border-dashed border-cream-300 pl-2 mt-1">
          {node.children.map((c) => (
            <Node key={c.id} node={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function verdictDot(verdict?: string): { bg: string; border: string; text: string } {
  switch (verdict) {
    case 'agent_failure':
      return { bg: 'bg-red-500', border: 'border-red-700', text: 'text-red-700' };
    case 'agent_success':
      return { bg: 'bg-emerald-500', border: 'border-emerald-700', text: 'text-emerald-700' };
    case 'near_miss':
      return { bg: 'bg-amber-500', border: 'border-amber-700', text: 'text-amber-700' };
    case 'timeout':
      return { bg: 'bg-gray-400', border: 'border-gray-600', text: 'text-gray-600' };
    default:
      return { bg: 'bg-cream-100', border: 'border-cream-300', text: 'text-ink-100' };
  }
}
