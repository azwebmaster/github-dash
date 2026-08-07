import { useState } from 'react';
import {
  Button,
  Chip,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Grid,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import DashboardCustomizeOutlinedIcon from '@mui/icons-material/DashboardCustomizeOutlined';
import { LineChart } from '@mui/x-charts/LineChart';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { usePinnedWorkflows } from '../hooks/usePinnedWorkflows';
import { ErrorState, LoadingBlock, PageHeader, RunLimitFilter, StatTile, formatDate } from '../components/ui';
import {
  DEFAULT_RUN_LIMIT,
  formatDurationSeconds,
  round,
  type RunLimit,
} from '../../shared/utils';
import type { WorkflowRunSummary } from '../../shared/types';

function DurationHistoryChart({ runs }: { runs: WorkflowRunSummary[] }) {
  const points = runs
    .filter((run) => run.durationSeconds != null && Number.isFinite(run.durationSeconds))
    .map((run) => ({
      id: run.id,
      at: new Date(run.runStartedAt ?? run.createdAt),
      durationSeconds: run.durationSeconds as number,
    }))
    .filter((p) => !Number.isNaN(p.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Duration history
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {points.length
          ? `${points.length} completed run${points.length === 1 ? '' : 's'} in this sample`
          : 'No completed runs with duration data in this sample.'}
      </Typography>
      {points.length ? (
        <LineChart
          height={280}
          series={[
            {
              data: points.map((p) => p.durationSeconds),
              label: 'Duration',
              color: '#0F4C5C',
              showMark: true,
              valueFormatter: (value, { dataIndex }) => {
                const point = points[dataIndex];
                const label = formatDurationSeconds(value);
                if (!point) return label;
                return `${label} · #${point.id}`;
              },
            },
          ]}
          xAxis={[
            {
              data: points.map((p) => p.at),
              scaleType: 'time',
              valueFormatter: (value) => {
                const date = value instanceof Date ? value : new Date(value as string | number);
                if (Number.isNaN(date.getTime())) return '';
                return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              },
            },
          ]}
          yAxis={[
            {
              valueFormatter: (value: number | null) => formatDurationSeconds(value),
              width: 56,
            },
          ]}
          margin={{ left: 10, right: 16, top: 20, bottom: 40 }}
        />
      ) : null}
    </Paper>
  );
}

function conclusionChip(conclusion: string | null, status: string | null) {
  if (status && status !== 'completed') {
    return <Chip size="small" label={status} color="info" variant="outlined" />;
  }
  switch (conclusion) {
    case 'success':
      return <Chip size="small" label="success" color="success" />;
    case 'failure':
      return <Chip size="small" label="failure" color="error" />;
    case 'cancelled':
      return <Chip size="small" label="cancelled" variant="outlined" />;
    default:
      return <Chip size="small" label={conclusion ?? '—'} variant="outlined" />;
  }
}

export default function WorkflowRunsPage() {
  const { workflowId: workflowIdParam } = useParams();
  const workflowId = Number(workflowIdParam);
  const validId = Number.isFinite(workflowId);
  const [runLimit, setRunLimit] = useState<RunLimit>(DEFAULT_RUN_LIMIT);
  const { isPinned, toggle } = usePinnedWorkflows();
  const { data, error, loading } = useAsyncData(
    () =>
      validId
        ? api.workflowRuns(workflowId, runLimit)
        : Promise.reject(new Error('Invalid workflow id')),
    [workflowId, validId, runLimit],
  );

  if (!validId) return <ErrorState message="Invalid workflow id" />;
  if (loading && !data) return <LoadingBlock rows={8} />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} />;

  const runs = data.items;
  const name = data.name;
  const pinned = isPinned(workflowId);

  const success = runs.filter((r) => r.conclusion === 'success').length;
  const failure = runs.filter((r) => r.conclusion === 'failure').length;
  const durations = runs
    .map((r) => r.durationSeconds)
    .filter((d): d is number => d != null && Number.isFinite(d));
  const avgDuration = durations.length
    ? round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;
  const maxDuration = durations.length ? Math.max(...durations) : null;
  const longestRun = runs
    .filter((r) => r.durationSeconds != null)
    .sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0))[0];

  return (
    <Stack spacing={3}>
      <Button component={RouterLink} to="/workflows" startIcon={<ArrowBackIcon />} sx={{ alignSelf: 'flex-start' }}>
        All workflows
      </Button>

      <PageHeader
        title={name}
        subtitle={`Workflow #${workflowId}`}
        action={
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button
              variant={pinned ? 'contained' : 'outlined'}
              size="small"
              startIcon={pinned ? <DashboardCustomizeIcon /> : <DashboardCustomizeOutlinedIcon />}
              onClick={() => toggle(workflowId)}
            >
              {pinned ? 'Pinned' : 'Add summary'}
            </Button>
            <RunLimitFilter value={runLimit} onChange={setRunLimit} />
          </Stack>
        }
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Runs" value={runs.length} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Success rate"
            value={`${runs.length ? Math.round((success / runs.length) * 100) : 0}%`}
            hint={`${success} ok · ${failure} fail`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Avg duration" value={formatDurationSeconds(avgDuration)} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Longest run"
            value={formatDurationSeconds(maxDuration)}
            hint={longestRun ? `#${longestRun.id}` : undefined}
          />
        </Grid>
      </Grid>

      <DurationHistoryChart runs={runs} />

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Run</TableCell>
              <TableCell>Branch</TableCell>
              <TableCell>Event</TableCell>
              <TableCell>Started</TableCell>
              <TableCell align="right">Duration</TableCell>
              <TableCell>Result</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    No runs match the current limit.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              runs.map((run) => {
                const isLongest = longestRun?.id === run.id && (run.durationSeconds ?? 0) > 0;
                return (
                  <TableRow
                    key={run.id}
                    hover
                    sx={isLongest ? { bgcolor: 'action.selected' } : undefined}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Link
                          component={RouterLink}
                          to={`/workflows/runs/${run.id}`}
                          underline="hover"
                          fontWeight={600}
                        >
                          #{run.id}
                        </Link>
                        {isLongest ? <Chip size="small" label="longest" color="warning" variant="outlined" /> : null}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>{run.branch || '—'}</TableCell>
                    <TableCell>{run.event}</TableCell>
                    <TableCell>{formatDate(run.runStartedAt ?? run.createdAt)}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                      {formatDurationSeconds(run.durationSeconds)}
                    </TableCell>
                    <TableCell>{conclusionChip(run.conclusion, run.status)}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
