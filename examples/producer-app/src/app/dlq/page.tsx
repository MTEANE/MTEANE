'use client';

import { useCallback, useEffect, useState } from 'react';
import { triggrr, type DlqJob } from '@/lib/triggrr';
import { PageHeader } from '@/components/page-header';
import { DlqRow } from '@/components/dlq-row';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function DlqPage() {
  const [jobs, setJobs] = useState<DlqJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    triggrr.dlq
      .list()
      .then(res => setJobs(res.jobs))
      .catch(() => toast.error('Failed to load DLQ jobs'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Dead Letter Queue"
        description="Jobs that exhausted all retries. Expand a row to see details, then Retry to re-queue the event."
        action={
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm animate-pulse">
              Loading…
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
              <AlertTriangle className="w-10 h-10 opacity-20" />
              <p className="text-sm">No dead-letter jobs — all events processed successfully.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Event type</TableHead>
                  <TableHead>Failed reason</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map(job => (
                  <DlqRow key={job.id} job={job} onRetried={load} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
