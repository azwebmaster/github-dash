import { useState } from 'react';
import {
  Chip,
  IconButton,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
  Grid,
} from '@mui/material';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import DashboardCustomizeOutlinedIcon from '@mui/icons-material/DashboardCustomizeOutlined';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { usePinnedWorkflows } from '../hooks/usePinnedWorkflows';
import { WorkflowSummaryCard } from '../components/WorkflowSummaryCard';
import { ConclusionStrip, DurationSparkline } from '../components/CiHealthVisuals';
import { ErrorState, LoadingBlock, PageHeader, RunLimitFilter, StatTile, formatDate } from '../components/ui';
import {
  DEFAULT_RUN_LIMIT,
  formatDurationHours,
  formatDurationSeconds,
  type RunLimit,
} from '../../shared/utils';
import type { WorkflowStats } from '../../shared/types';

type WorkflowRow = WorkflowStats['byWorkflow'][number];
type SortKey = 'name' | 'total' | 'successRate' | 'avgDuration' | 'consecutiveFailures';
type SortDir = 'asc' | 'desc';

function successRate(w: WorkflowRow): number {
  return w.successRate ?? (w.total ? Math.round((w.success / w.total) * 100) : 0);
}

function compareWorkflows(a: WorkflowRow, b: WorkflowRow, key: SortKey, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1;
  let cmp = 0;
  switch (key) {
    case 'name':
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      break;
    case 'total':
      cmp = a.total - b.total;
      break;
    case 'successRate':
      cmp = successRate(a) - successRate(b);
      break;
    case 'consecutiveFailures':
      cmp = a.consecutiveFailures - b.consecutiveFailures;
      break;
    case 'avgDuration': {
      const ad = a.avgDurationSeconds;
      const bd = b.avgDurationSeconds;
      if (ad == null && bd == null) cmp = 0;
      else if (ad == null) cmp = 1;
      else if (bd == null) cmp = -1;
      else cmp = ad - bd;
      break;
    }
  }
  if (cmp === 0) cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return cmp * mul;
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

export default function WorkflowsPage() {
  const navigate = useNavigate();
  const [runLimit, setRunLimit] = useState<RunLimit>(DEFAULT_RUN_LIMIT);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const { pinnedIds, isPinned, toggle, unpin } = usePinnedWorkflows();
  const { data, error, loading } = useAsyncData(() => api.workflows(runLimit), [runLimit]);

  if (loading && !data) return <LoadingBlock rows={8} />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} />;

  const { items, stats } = data;
  const nameById = new Map(stats.byWorkflow.map((w) => [w.workflowId, w.name]));
  const sortedWorkflows = [...stats.byWorkflow].sort((a, b) =>
    compareWorkflows(a, b, sortKey, sortDir),
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'name' ? 'asc' : 'desc');
  };

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Workflows"
        subtitle="All workflows in the repo. Per-workflow stats use each workflow’s last 20 runs; the table below is a repo-wide recent sample"
        action={<RunLimitFilter value={runLimit} onChange={setRunLimit} />}
      />

      {pinnedIds.length > 0 ? (
        <Stack spacing={1.5}>
          <Typography variant="h6">Summary cards</Typography>
          <Typography variant="body2" color="text.secondary">
            Pinned workflows persist in a browser cookie. Use the dashboard icon next to a workflow to add or remove one.
          </Typography>
          <Grid container spacing={2}>
            {pinnedIds.map((id) => (
              <Grid key={id} size={{ xs: 12, sm: 6, lg: 4 }}>
                <WorkflowSummaryCard
                  workflowId={id}
                  fallbackName={nameById.get(id)}
                  runLimit={runLimit}
                  onRemove={() => unpin(id)}
                />
              </Grid>
            ))}
          </Grid>
        </Stack>
      ) : null}

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Sampled runs" value={stats.totalRuns} hint="Up to 20 per workflow" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Success rate"
            value={`${stats.successRate}%`}
            hint={`${stats.success} ok · ${stats.failure} fail · ${stats.cancelled} cancel`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Avg duration"
            value={formatDurationSeconds((stats.duration.avgHours ?? 0) * 3600 || null)}
            hint={`p90 ${formatDurationHours(stats.duration.p90Hours)}`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Workflows" value={stats.byWorkflow.length} />
        </Grid>
      </Grid>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          All workflows
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Runs / OK% / Avg are from each workflow’s last 20 runs. Use the dashboard icon to pin a summary card.
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sortDirection={sortKey === 'name' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'name'}
                  direction={sortKey === 'name' ? sortDir : 'asc'}
                  onClick={() => handleSort('name')}
                >
                  Name
                </TableSortLabel>
              </TableCell>
              <TableCell align="right" sortDirection={sortKey === 'total' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'total'}
                  direction={sortKey === 'total' ? sortDir : 'asc'}
                  onClick={() => handleSort('total')}
                >
                  Runs
                </TableSortLabel>
              </TableCell>
              <TableCell
                align="right"
                sortDirection={sortKey === 'successRate' ? sortDir : false}
              >
                <TableSortLabel
                  active={sortKey === 'successRate'}
                  direction={sortKey === 'successRate' ? sortDir : 'asc'}
                  onClick={() => handleSort('successRate')}
                >
                  OK%
                </TableSortLabel>
              </TableCell>
              <TableCell
                align="right"
                sortDirection={sortKey === 'consecutiveFailures' ? sortDir : false}
              >
                <TableSortLabel
                  active={sortKey === 'consecutiveFailures'}
                  direction={sortKey === 'consecutiveFailures' ? sortDir : 'asc'}
                  onClick={() => handleSort('consecutiveFailures')}
                >
                  Streak
                </TableSortLabel>
              </TableCell>
              <TableCell>Recent</TableCell>
              <TableCell
                align="right"
                sortDirection={sortKey === 'avgDuration' ? sortDir : false}
              >
                <TableSortLabel
                  active={sortKey === 'avgDuration'}
                  direction={sortKey === 'avgDuration' ? sortDir : 'asc'}
                  onClick={() => handleSort('avgDuration')}
                >
                  Avg
                </TableSortLabel>
              </TableCell>
              <TableCell>Duration</TableCell>
              <TableCell align="right" padding="checkbox" sx={{ width: 48 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedWorkflows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    No workflows found in this repository.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sortedWorkflows.map((w) => {
                const pinned = isPinned(w.workflowId);
                return (
                  <TableRow
                    key={w.workflowId}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/workflows/by/${w.workflowId}`)}
                  >
                    <TableCell>
                      <Link
                        component={RouterLink}
                        to={`/workflows/by/${w.workflowId}`}
                        underline="hover"
                        fontWeight={600}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {w.name}
                      </Link>
                    </TableCell>
                    <TableCell align="right">{w.total}</TableCell>
                    <TableCell align="right">{w.total ? `${successRate(w)}%` : '—'}</TableCell>
                    <TableCell align="right">
                      {w.consecutiveFailures > 0 ? (
                        <Typography variant="body2" color="error.main" fontWeight={600}>
                          {w.consecutiveFailures} fail
                        </Typography>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <ConclusionStrip conclusions={w.recentConclusions} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                      {w.total ? formatDurationSeconds(w.avgDurationSeconds) : '—'}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DurationSparkline values={w.durationSparkline} width={72} height={24} />
                    </TableCell>
                    <TableCell align="right" padding="checkbox" onClick={(e) => e.stopPropagation()}>
                      <Tooltip title={pinned ? 'Remove summary card' : 'Add summary card'}>
                        <IconButton
                          size="small"
                          color={pinned ? 'primary' : 'default'}
                          aria-label={pinned ? `Remove ${w.name} summary` : `Add ${w.name} summary`}
                          onClick={() => toggle(w.workflowId)}
                        >
                          {pinned ? (
                            <DashboardCustomizeIcon fontSize="small" />
                          ) : (
                            <DashboardCustomizeOutlinedIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Run</TableCell>
              <TableCell>Workflow</TableCell>
              <TableCell>Branch</TableCell>
              <TableCell>Event</TableCell>
              <TableCell>Started</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell>Result</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    No workflow runs match the current limit.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              items.map((run) => (
                <TableRow key={run.id} hover>
                  <TableCell>
                    <Link
                      component={RouterLink}
                      to={`/workflows/runs/${run.id}`}
                      underline="hover"
                      fontWeight={600}
                    >
                      #{run.id}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      component={RouterLink}
                      to={`/workflows/by/${run.workflowId}`}
                      underline="hover"
                      color="inherit"
                    >
                      {run.name}
                    </Link>
                  </TableCell>
                  <TableCell sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>{run.branch || '—'}</TableCell>
                  <TableCell>{run.event}</TableCell>
                  <TableCell>{formatDate(run.runStartedAt ?? run.createdAt)}</TableCell>
                  <TableCell sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                    {formatDurationSeconds(run.durationSeconds)}
                  </TableCell>
                  <TableCell>{conclusionChip(run.conclusion, run.status)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
