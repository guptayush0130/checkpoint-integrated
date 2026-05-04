import { Badge } from './badge';

export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <Badge tone="pass">PASS</Badge>;
    case 'failed':
      return <Badge tone="fail">FAILED</Badge>;
    case 'running':
      return (
        <Badge tone="running">
          <span className="pulse-dot text-warning-500" /> running
        </Badge>
      );
    default:
      return <Badge tone="pending">pending</Badge>;
  }
}
