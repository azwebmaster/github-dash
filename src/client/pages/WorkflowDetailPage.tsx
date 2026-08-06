import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Button,
  Chip,
  LinearProgress,
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
import TimerIcon from '@mui/icons-material/Timer';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import { formatDurationSeconds, round } from '../../shared/utils';
import type { WorkflowRunDetail } from '../../shared/types';

type Job = WorkflowRunDetail['jobs'][number];
type Step = Job['steps'][number];

function findLongestJob(jobs: Job[]): Job | null {
  let best: Job | null = null;
  for (const job of jobs) {
    if (job.durationSeconds == null) continue;
    if (!best || (best.durationSeconds ?? 0) < job.durationSeconds) best = job;
  }
  return best;
}

function findLongestStep(jobs: Job[]): { job: Job; step: Step } | null {
  let best: { job: Job; step: Step } | null = null;
  for (const job of jobs) {
    for (const step of job.steps) {
      if (step.durationSeconds == null) continue;
      if (!best || (best.step.durationSeconds ?? 0) < step.durationSeconds) {
        best = { job, step };
      }
    }
  }
  return best;
}

function durationShare(part: number | null, total: number | null): number | null {
  if (part == null || total == null || total <= 0) return null;
  return Math.min(100, round((part / total) * 100, 1));
}

export default function WorkflowDetailPage() {
  const { id } = useParams();
  const runId = Number(id);
  const { data, error, loading } = useAsyncData(() => api.workflow(runId), [runId]);

  if (loading) return <LoadingBlock />;
  if (error || !data) return <ErrorState message={error ?? 'Workflow run not found'} />;

  const longestJob = findLongestJob(data.jobs);
  const longestStep = findLongestStep(data.jobs);
  const jobsByDuration = [...data.jobs].sort(
    (a, b) => (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1),
  );

  const backTo = data.workflowId
    ? `/workflows/by/${data.workflowId}`
    : '/workflows';

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button component={RouterLink} to={backTo} startIcon={<ArrowBackIcon />}>
          {data.workflowName} runs
        </Button>
        <Button component={RouterLink} to="/workflows" startIcon={<ArrowBackIcon />}>
          All workflows
        </Button>
      </Stack>

      <PageHeader
        title={data.name}
        subtitle={`Run #${data.id} · attempt ${data.attempt}`}
        action={
          <Button href={data.htmlUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />} variant="outlined">
            GitHub
          </Button>
        }
      />

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip
          label={data.conclusion ?? data.status ?? 'unknown'}
          color={data.conclusion === 'success' ? 'success' : data.conclusion === 'failure' ? 'error' : 'default'}
        />
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

      {(longestJob || longestStep) && (
        <Paper
          sx={{
            p: 2.5,
            borderLeft: 4,
            borderColor: 'warning.main',
            bgcolor: 'action.hover',
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <TimerIcon color="warning" fontSize="small" />
            <Typography variant="h6">What took the longest</Typography>
          </Stack>
          <Grid container spacing={2}>
            {longestJob ? (
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="overline" color="text.secondary">
                  Longest job
                </Typography>
                <Typography fontWeight={700}>{longestJob.name}</Typography>
                <Typography sx={{ fontFamily: '"IBM Plex Mono", monospace', mt: 0.5 }}>
                  {formatDurationSeconds(longestJob.durationSeconds)}
                  {durationShare(longestJob.durationSeconds, data.durationSeconds) != null
                    ? ` · ${durationShare(longestJob.durationSeconds, data.durationSeconds)}% of run`
                    : ''}
                </Typography>
              </Grid>
            ) : null}
            {longestStep ? (
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="overline" color="text.secondary">
                  Longest step
                </Typography>
                <Typography fontWeight={700}>{longestStep.step.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  in {longestStep.job.name}
                </Typography>
                <Typography sx={{ fontFamily: '"IBM Plex Mono", monospace', mt: 0.5 }}>
                  {formatDurationSeconds(longestStep.step.durationSeconds)}
                  {durationShare(longestStep.step.durationSeconds, data.durationSeconds) != null
                    ? ` · ${durationShare(longestStep.step.durationSeconds, data.durationSeconds)}% of run`
                    : ''}
                </Typography>
              </Grid>
            ) : null}
          </Grid>
        </Paper>
      )}

      <Paper sx={{ p: 1 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
          Jobs · sorted by duration (longest first)
        </Typography>
        {jobsByDuration.map((job) => {
          const isLongestJob = longestJob?.id === job.id;
          const jobLongestStep = [...job.steps]
            .filter((s) => s.durationSeconds != null)
            .sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0))[0];
          const share = durationShare(job.durationSeconds, data.durationSeconds);

          return (
            <Accordion key={job.id} disableGutters elevation={0} defaultExpanded={isLongestJob}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Stack spacing={0.75} sx={{ width: '100%', pr: 2 }}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Typography fontWeight={600} sx={{ flex: 1 }}>
                      {job.name}
                    </Typography>
                    {isLongestJob ? (
                      <Chip size="small" label="longest job" color="warning" />
                    ) : null}
                    <Typography variant="body2" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                      {formatDurationSeconds(job.durationSeconds)}
                    </Typography>
                    <Chip
                      size="small"
                      label={job.conclusion ?? job.status}
                      color={
                        job.conclusion === 'success'
                          ? 'success'
                          : job.conclusion === 'failure'
                            ? 'error'
                            : 'default'
                      }
                    />
                  </Stack>
                  {share != null ? (
                    <LinearProgress
                      variant="determinate"
                      value={share}
                      color={isLongestJob ? 'warning' : 'primary'}
                      sx={{ height: 6, borderRadius: 1, maxWidth: 360 }}
                    />
                  ) : null}
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
                      <TableCell sx={{ width: 140 }}>Share of job</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {job.steps.map((step) => {
                      const isLongestOverall =
                        longestStep?.job.id === job.id && longestStep.step.number === step.number;
                      const isLongestInJob = jobLongestStep?.number === step.number;
                      const stepShare = durationShare(step.durationSeconds, job.durationSeconds);

                      return (
                        <TableRow
                          key={`${job.id}-${step.number}`}
                          sx={
                            isLongestOverall
                              ? { bgcolor: 'action.selected' }
                              : isLongestInJob
                                ? { bgcolor: 'action.hover' }
                                : undefined
                          }
                        >
                          <TableCell>{step.number}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <span>{step.name}</span>
                              {isLongestOverall ? (
                                <Chip size="small" label="longest step" color="warning" />
                              ) : isLongestInJob ? (
                                <Chip size="small" label="slowest in job" variant="outlined" />
                              ) : null}
                            </Stack>
                          </TableCell>
                          <TableCell>{step.conclusion ?? step.status}</TableCell>
                          <TableCell align="right" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                            {formatDurationSeconds(step.durationSeconds)}
                          </TableCell>
                          <TableCell>
                            {stepShare != null ? (
                              <Stack direction="row" spacing={1} alignItems="center">
                                <LinearProgress
                                  variant="determinate"
                                  value={stepShare}
                                  color={isLongestOverall ? 'warning' : 'inherit'}
                                  sx={{ flex: 1, height: 6, borderRadius: 1 }}
                                />
                                <Typography
                                  variant="caption"
                                  sx={{ fontFamily: '"IBM Plex Mono", monospace', minWidth: 40 }}
                                >
                                  {stepShare}%
                                </Typography>
                              </Stack>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </AccordionDetails>
            </Accordion>
          );
        })}
        {data.jobs.length === 0 ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            No jobs found for this run.
          </Typography>
        ) : null}
      </Paper>
    </Stack>
  );
}
