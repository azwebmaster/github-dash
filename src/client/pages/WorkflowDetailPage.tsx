import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  Grid,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import { formatDurationSeconds } from '../../shared/utils';

export default function WorkflowDetailPage() {
  const { id } = useParams();
  const runId = Number(id);
  const { data, error, loading } = useAsyncData(() => api.workflow(runId), [runId]);

  if (loading) return <LoadingBlock />;
  if (error || !data) return <ErrorState message={error ?? 'Workflow run not found'} />;

  return (
    <Stack spacing={3}>
      <Button component={RouterLink} to="/workflows" startIcon={<ArrowBackIcon />} sx={{ alignSelf: 'flex-start' }}>
        All workflow runs
      </Button>

      <PageHeader
        title={data.name}
        subtitle={`Run #${data.id} · attempt ${data.attempt}`}
        action={
          <Button href={data.htmlUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />} variant="outlined">
            GitHub
          </Button>
        }
      />

      <Stack direction="row" spacing={1}>
        <Chip label={data.conclusion ?? data.status ?? 'unknown'} color={data.conclusion === 'success' ? 'success' : data.conclusion === 'failure' ? 'error' : 'default'} />
        <Chip label={data.event} variant="outlined" />
        <Chip label={data.branch || 'no branch'} variant="outlined" />
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Started" value={formatDate(data.runStartedAt ?? data.createdAt)} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Duration" value={formatDurationSeconds(data.durationSeconds)} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Jobs" value={data.jobs.length} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Updated" value={formatDate(data.updatedAt)} />
        </Grid>
      </Grid>

      <Paper sx={{ p: 1 }}>
        {data.jobs.map((job) => (
          <Accordion key={job.id} disableGutters elevation={0}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%', pr: 2 }}>
                <Typography fontWeight={600} sx={{ flex: 1 }}>
                  {job.name}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                  {formatDurationSeconds(job.durationSeconds)}
                </Typography>
                <Chip
                  size="small"
                  label={job.conclusion ?? job.status}
                  color={job.conclusion === 'success' ? 'success' : job.conclusion === 'failure' ? 'error' : 'default'}
                />
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Step</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Duration</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {job.steps.map((step) => (
                    <TableRow key={`${job.id}-${step.number}`}>
                      <TableCell>{step.number}</TableCell>
                      <TableCell>{step.name}</TableCell>
                      <TableCell>{step.conclusion ?? step.status}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                        {formatDurationSeconds(step.durationSeconds)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AccordionDetails>
          </Accordion>
        ))}
        {data.jobs.length === 0 ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            No jobs found for this run.
          </Typography>
        ) : null}
      </Paper>
    </Stack>
  );
}
