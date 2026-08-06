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
import { Link as RouterLink, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import { formatDurationSeconds, round } from '../../shared/utils';

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
  const { data, error, loading } = useAsyncData(
    () => (validId ? api.workflowRuns(workflowId) : Promise.reject(new Error('Invalid workflow id'))),
    [workflowId, validId],
  );

  if (!validId) return <ErrorState message="Invalid workflow id" />;
  if (loading) return <LoadingBlock rows={8} />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} />;

  const runs = data.items;
  const name = data.name;

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
        subtitle={`Past ${runs.length} run${runs.length === 1 ? '' : 's'} · workflow #${workflowId}`}
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
            {runs.map((run) => {
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
            })}
          </TableBody>
        </Table>
        {runs.length === 0 ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            No runs found for this workflow.
          </Typography>
        ) : null}
      </TableContainer>
    </Stack>
  );
}
