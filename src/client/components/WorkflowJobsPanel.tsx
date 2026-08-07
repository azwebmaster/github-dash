import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Chip,
  Link,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { WorkflowRunDetail } from '../../shared/types';
import { formatDurationSeconds, round } from '../../shared/utils';
import { formatDate } from './ui';

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

function findLongestQueue(jobs: Job[]): Job | null {
  let best: Job | null = null;
  for (const job of jobs) {
    if (job.queueSeconds == null) continue;
    if (!best || (best.queueSeconds ?? 0) < job.queueSeconds) best = job;
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

export function WorkflowJobsPanel({
  jobs,
  runDurationSeconds,
  defaultExpandLongest = true,
}: {
  jobs: Job[];
  runDurationSeconds: number | null;
  defaultExpandLongest?: boolean;
}) {
  const longestJob = findLongestJob(jobs);
  const longestQueue = findLongestQueue(jobs);
  const longestStep = findLongestStep(jobs);
  const jobsByDuration = [...jobs].sort(
    (a, b) => (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1),
  );

  return (
    <Paper sx={{ p: 1 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
        Jobs · sorted by duration (longest first)
      </Typography>
      {jobsByDuration.map((job) => {
        const isLongestJob = longestJob?.id === job.id;
        const isLongestQueue = longestQueue?.id === job.id && (job.queueSeconds ?? 0) > 0;
        const jobLongestStep = [...job.steps]
          .filter((s) => s.durationSeconds != null)
          .sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0))[0];
        const share = durationShare(job.durationSeconds, runDurationSeconds);

        return (
          <Accordion
            key={job.id}
            disableGutters
            elevation={0}
            defaultExpanded={defaultExpandLongest && isLongestJob}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack spacing={0.75} sx={{ width: '100%', pr: 2 }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Typography fontWeight={600} sx={{ flex: 1 }}>
                    {job.name}
                  </Typography>
                  {isLongestJob ? (
                    <Chip size="small" label="longest job" color="warning" />
                  ) : null}
                  {isLongestQueue ? (
                    <Chip size="small" label="longest queue" color="info" variant="outlined" />
                  ) : null}
                  <Stack alignItems="flex-end" spacing={0}>
                    <Typography variant="body2" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                      {formatDurationSeconds(job.durationSeconds)}
                    </Typography>
                    {job.queueSeconds != null && job.queueSeconds > 0 ? (
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                        queued {formatDurationSeconds(job.queueSeconds)}
                      </Typography>
                    ) : null}
                  </Stack>
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
              {(job.queueSeconds != null || job.createdAt || job.startedAt) && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {job.queueSeconds != null
                    ? `Waited ${formatDurationSeconds(job.queueSeconds)} for a runner`
                    : 'Queue wait unknown'}
                  {job.createdAt ? ` · queued ${formatDate(job.createdAt)}` : ''}
                  {job.startedAt ? ` · started ${formatDate(job.startedAt)}` : ''}
                </Typography>
              )}
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Step</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Duration</TableCell>
                    <TableCell sx={{ width: 140 }}>Share of job</TableCell>
                    <TableCell align="right">Logs</TableCell>
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
                            {step.htmlUrl ? (
                              <Link
                                href={step.htmlUrl}
                                target="_blank"
                                rel="noreferrer"
                                underline="hover"
                                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                              >
                                {step.name}
                                <OpenInNewIcon sx={{ fontSize: 12 }} />
                              </Link>
                            ) : (
                              <span>{step.name}</span>
                            )}
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
                        <TableCell align="right">
                          {step.htmlUrl ? (
                            <Link
                              href={step.htmlUrl}
                              target="_blank"
                              rel="noreferrer"
                              variant="body2"
                              underline="hover"
                              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                            >
                              logs <OpenInNewIcon sx={{ fontSize: 12 }} />
                            </Link>
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
      {jobs.length === 0 ? (
        <Typography sx={{ p: 2 }} color="text.secondary">
          No jobs found for this run.
        </Typography>
      ) : null}
    </Paper>
  );
}

export { findLongestJob, findLongestQueue, findLongestStep, durationShare };
