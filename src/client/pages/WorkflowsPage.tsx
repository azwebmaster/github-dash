import {
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
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { BarChart } from '@mui/x-charts/BarChart';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import { formatDurationHours, formatDurationSeconds } from '../../shared/utils';

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
  const { data, error, loading } = useAsyncData(() => api.workflows(), []);

  if (loading) return <LoadingBlock rows={8} />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} />;

  const { items, stats } = data;

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Workflows"
        subtitle="Click a workflow to see its runs, then open a run for job and step timings"
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Runs loaded" value={stats.totalRuns} />
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

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              By workflow
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell align="right">Runs</TableCell>
                  <TableCell align="right">OK%</TableCell>
                  <TableCell align="right">Avg</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stats.byWorkflow.map((w) => (
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
                    <TableCell align="right">
                      {w.total ? Math.round((w.success / w.total) * 100) : 0}%
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                      {formatDurationSeconds(w.avgDurationSeconds)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Daily conclusions
            </Typography>
            {stats.recentConclusions.length ? (
              <BarChart
                height={280}
                series={[
                  { data: stats.recentConclusions.map((d) => d.success), label: 'Success', color: '#0F7B4B', stack: 't' },
                  { data: stats.recentConclusions.map((d) => d.failure), label: 'Failure', color: '#C62828', stack: 't' },
                  { data: stats.recentConclusions.map((d) => d.other), label: 'Other', color: '#3D5560', stack: 't' },
                ]}
                xAxis={[{ data: stats.recentConclusions.map((d) => d.date.slice(5)), scaleType: 'band' }]}
                margin={{ left: 40, right: 10, top: 20, bottom: 40 }}
              />
            ) : (
              <Typography color="text.secondary">No data</Typography>
            )}
          </Paper>
        </Grid>
      </Grid>

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
            {items.map((run) => (
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
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
