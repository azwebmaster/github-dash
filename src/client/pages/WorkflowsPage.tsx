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
import { Link as RouterLink } from 'react-router-dom';
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
  const { data, error, loading } = useAsyncData(() => api.workflows(), []);

  if (loading) return <LoadingBlock rows={8} />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} />;

  const { items, stats } = data;

  return (
    <Stack spacing={3}>
      <PageHeader title="Workflows" subtitle="GitHub Actions run metrics, success rate, and duration" />

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
                  <TableRow key={w.name}>
                    <TableCell>{w.name}</TableCell>
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
                  <Link component={RouterLink} to={`/workflows/${run.id}`} underline="hover" fontWeight={600}>
                    #{run.id}
                  </Link>
                </TableCell>
                <TableCell>{run.name}</TableCell>
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
