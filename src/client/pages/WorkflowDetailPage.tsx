import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Link,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
  Grid,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import TimerIcon from '@mui/icons-material/Timer';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import { OrchestrationPipeline } from '../components/OrchestrationPipeline';
import {
  WorkflowJobsPanel,
  durationShare,
  findLongestJob,
  findLongestQueue,
  findLongestStep,
} from '../components/WorkflowJobsPanel';
import { formatDurationSeconds } from '../../shared/utils';
import type {
  WorkflowFailureAnalysis,
  WorkflowFailureAnalysisEvent,
  WorkflowFailureLikelyCause,
  WorkflowFailureTargetAnalysis,
  WorkflowRunDetail,
} from '../../shared/types';

type Job = WorkflowRunDetail['jobs'][number];

function LongestHighlights({
  jobs,
  runDurationSeconds,
}: {
  jobs: Job[];
  runDurationSeconds: number | null;
}) {
  const longestJob = findLongestJob(jobs);
  const longestStep = findLongestStep(jobs);
  const longestQueue = findLongestQueue(jobs);
  const showQueue =
    longestQueue != null && (longestQueue.queueSeconds ?? 0) > 0;
  if (!longestJob && !longestStep && !showQueue) return null;

  return (
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
          <Grid size={{ xs: 12, md: 4 }}>
            <Typography variant="overline" color="text.secondary">
              Longest job
            </Typography>
            <Typography fontWeight={700}>{longestJob.name}</Typography>
            <Typography sx={{ fontFamily: '"IBM Plex Mono", monospace', mt: 0.5 }}>
              {formatDurationSeconds(longestJob.durationSeconds)}
              {durationShare(longestJob.durationSeconds, runDurationSeconds) != null
                ? ` · ${durationShare(longestJob.durationSeconds, runDurationSeconds)}% of run`
                : ''}
            </Typography>
          </Grid>
        ) : null}
        {longestStep ? (
          <Grid size={{ xs: 12, md: 4 }}>
            <Typography variant="overline" color="text.secondary">
              Longest step
            </Typography>
            <Typography fontWeight={700}>
              {longestStep.step.htmlUrl ? (
                <Link
                  href={longestStep.step.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  underline="hover"
                  color="inherit"
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                >
                  {longestStep.step.name}
                  <OpenInNewIcon sx={{ fontSize: 14 }} />
                </Link>
              ) : (
                longestStep.step.name
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              in {longestStep.job.name}
            </Typography>
            <Typography sx={{ fontFamily: '"IBM Plex Mono", monospace', mt: 0.5 }}>
              {formatDurationSeconds(longestStep.step.durationSeconds)}
              {durationShare(longestStep.step.durationSeconds, runDurationSeconds) != null
                ? ` · ${durationShare(longestStep.step.durationSeconds, runDurationSeconds)}% of run`
                : ''}
            </Typography>
          </Grid>
        ) : null}
        {showQueue && longestQueue ? (
          <Grid size={{ xs: 12, md: 4 }}>
            <Typography variant="overline" color="text.secondary">
              Longest runner wait
            </Typography>
            <Typography fontWeight={700}>{longestQueue.name}</Typography>
            <Typography sx={{ fontFamily: '"IBM Plex Mono", monospace', mt: 0.5 }}>
              {formatDurationSeconds(longestQueue.queueSeconds)} queued
            </Typography>
            <Typography variant="body2" color="text.secondary">
              created → started (waiting for a runner)
            </Typography>
          </Grid>
        ) : null}
      </Grid>
    </Paper>
  );
}

function confidenceColor(
  confidence: WorkflowFailureLikelyCause['confidence'],
): 'success' | 'warning' | 'default' {
  if (confidence === 'high') return 'success';
  if (confidence === 'medium') return 'warning';
  return 'default';
}

/** Prefer `likelyCauses`; fall back to legacy single `likelyCause` from older cache entries. */
function analysisLikelyCauses(
  analysis: Pick<WorkflowFailureAnalysis, 'likelyCauses' | 'likelyCause'>,
) {
  if (analysis.likelyCauses?.length) return analysis.likelyCauses;
  return analysis.likelyCause ? [analysis.likelyCause] : [];
}

function analysisByFailure(analysis: WorkflowFailureAnalysis): WorkflowFailureTargetAnalysis[] {
  if (analysis.byFailure?.length) return analysis.byFailure;
  return [];
}

type AnalysisLogEntry = {
  id: number;
  role: 'system' | 'assistant' | 'tool' | 'status';
  text: string;
};

function logRoleLabel(role: AnalysisLogEntry['role']): string {
  if (role === 'assistant') return 'Claude';
  if (role === 'tool') return 'Tool';
  if (role === 'status') return 'Progress';
  return 'System';
}

function logRoleColor(role: AnalysisLogEntry['role']): string {
  if (role === 'assistant') return 'secondary.main';
  if (role === 'tool') return 'info.main';
  if (role === 'status') return 'warning.main';
  return 'text.secondary';
}

function AnalysisProgressLog({
  entries,
  status,
  loading,
}: {
  entries: AnalysisLogEntry[];
  status: string | null;
  loading: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  /** User can re-open the log after completion; reset whenever a new run starts. */
  const [userOpen, setUserOpen] = useState(false);

  useEffect(() => {
    if (loading) setUserOpen(false);
  }, [loading]);

  // Expanded while analyzing; collapsed when finished unless the user re-opens it.
  const expanded = loading || userOpen;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !expanded) return;
    el.scrollTop = el.scrollHeight;
  }, [entries, status, expanded]);

  if (!loading && entries.length === 0) return null;

  return (
    <Accordion
      // Remount when a run finishes so a fast analyze cannot leave MUI stuck open.
      key={loading ? 'analyzing' : 'complete'}
      disableGutters
      elevation={0}
      expanded={expanded}
      onChange={(_event, next) => {
        if (loading) return;
        setUserOpen(next);
      }}
      slotProps={{
        transition: { unmountOnExit: true },
      }}
      sx={{
        border: 1,
        borderColor: 'divider',
        bgcolor: 'rgba(15, 76, 92, 0.03)',
        '&:before': { display: 'none' },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          {loading ? <CircularProgress size={14} /> : null}
          <Typography variant="caption" color="text.secondary">
            {loading
              ? status || 'Analyzing…'
              : `Analysis log · ${entries.length} event${entries.length === 1 ? '' : 's'}`}
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Box
          ref={scrollerRef}
          sx={{
            maxHeight: 260,
            overflow: 'auto',
            px: 0.5,
            py: 1,
            fontFamily: '"IBM Plex Mono", monospace',
          }}
        >
          <Stack spacing={1}>
            {entries.map((entry) => (
              <Box key={entry.id}>
                <Typography
                  variant="caption"
                  sx={{ color: logRoleColor(entry.role), fontWeight: 700, mr: 1 }}
                >
                  {logRoleLabel(entry.role)}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: entry.role === 'status' ? 'text.secondary' : 'text.primary',
                  }}
                >
                  {entry.text}
                </Typography>
              </Box>
            ))}
            {loading && entries.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Waiting for agent events…
              </Typography>
            ) : null}
          </Stack>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

function LikelyCauseList({ causes }: { causes: WorkflowFailureLikelyCause[] }) {
  if (causes.length === 0) {
    return <Typography fontWeight={700}>No likely causes identified</Typography>;
  }
  return (
    <Stack spacing={1.25}>
      {causes.map((cause, index) => (
        <Stack
          key={`${cause.prNumber ?? 'none'}-${index}`}
          spacing={0.5}
          sx={{
            pl: 1.5,
            borderLeft: 2,
            borderColor: index === 0 ? 'secondary.main' : 'divider',
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontFamily: '"IBM Plex Mono", monospace', minWidth: 1.5 }}
            >
              {index + 1}.
            </Typography>
            {cause.prNumber != null ? (
              <Link
                component={RouterLink}
                to={`/prs/${cause.prNumber}`}
                underline="hover"
                fontWeight={700}
              >
                #{cause.prNumber}
                {cause.prTitle ? ` · ${cause.prTitle}` : ''}
              </Link>
            ) : (
              <Typography fontWeight={700}>No single PR identified</Typography>
            )}
            {cause.author ? (
              <Chip size="small" label={`@${cause.author}`} color="secondary" />
            ) : null}
            <Chip
              size="small"
              label={`${cause.confidence} confidence`}
              color={confidenceColor(cause.confidence)}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {cause.reasoning}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function ByFailureGroups({ analysis }: { analysis: WorkflowFailureAnalysis }) {
  const entries = analysisByFailure(analysis);
  if (entries.length === 0) return null;

  const jobs = entries.filter((e) => e.kind === 'job');
  const stages = entries.filter((e) => e.kind === 'stage');

  const renderGroup = (title: string, items: WorkflowFailureTargetAnalysis[]) => {
    if (items.length === 0) return null;
    return (
      <Stack spacing={1}>
        <Typography variant="overline" color="text.secondary">
          {title}
        </Typography>
        {items.map((entry) => (
          <Accordion
            key={`${entry.kind}-${entry.targetId}`}
            disableGutters
            defaultExpanded
            elevation={0}
            sx={{ border: 1, borderColor: 'divider', '&:before': { display: 'none' } }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={entry.kind}
                  color={entry.kind === 'stage' ? 'warning' : 'default'}
                  variant="outlined"
                />
                <Typography fontWeight={700}>{entry.targetName}</Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontFamily: '"IBM Plex Mono", monospace' }}
                >
                  {entry.targetId}
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1.25}>
                <Typography variant="body2">{entry.summary}</Typography>
                <LikelyCauseList causes={entry.likelyCauses} />
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
      </Stack>
    );
  };

  return (
    <Stack spacing={2}>
      {renderGroup(`Failed jobs (${jobs.length})`, jobs)}
      {renderGroup(`Failed stages (${stages.length})`, stages)}
    </Stack>
  );
}

function FailedStageTestChips({ analysis }: { analysis: WorkflowFailureAnalysis }) {
  const withTests = analysis.failedStages.filter((s) => s.testReport);
  const withLogs = [
    ...analysis.failedJobs.filter((j) => j.logsFetched),
    ...analysis.failedStages.flatMap((s) => s.linkedFailedJobs ?? []).filter((j) => j.logsFetched),
  ];
  if (withTests.length === 0 && withLogs.length === 0) return null;

  return (
    <Stack spacing={0.75}>
      {withTests.length > 0 ? (
        <>
          <Typography variant="caption" color="text.secondary">
            Stage test reports used in analysis
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {withTests.map((stage) => {
              const failedTests =
                stage.testReport?.suites.reduce((n, s) => n + s.failedTests.length, 0) ?? 0;
              const label = stage.testReport?.infraFailure
                ? `${stage.name}: infra failure`
                : failedTests > 0
                  ? `${stage.name}: ${failedTests} failed test${failedTests === 1 ? '' : 's'}`
                  : `${stage.name}: ${stage.testReport?.overall || 'tests'}`;
              return (
                <Chip key={stage.id} size="small" label={label} variant="outlined" color="error" />
              );
            })}
          </Stack>
        </>
      ) : null}
      {withLogs.length > 0 ? (
        <>
          <Typography variant="caption" color="text.secondary">
            GitHub job logs used in analysis
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {withLogs.map((job) => (
              <Chip
                key={`${job.id}-${job.name}`}
                size="small"
                label={`${job.name}${job.logExcerpt ? '' : ' (unavailable)'}`}
                variant="outlined"
                color={job.logExcerpt ? 'info' : 'default'}
              />
            ))}
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}

function FailureAnalysisPanel({ runId }: { runId: number }) {
  const { data: meta } = useAsyncData(() => api.meta(), []);
  const [analysis, setAnalysis] = useState<WorkflowFailureAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingCache, setLoadingCache] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<AnalysisLogEntry[]>([]);
  const logIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingCache(true);
    setAnalysis(null);
    setError(null);
    setStatus(null);
    setLogEntries([]);
    logIdRef.current = 0;

    void (async () => {
      try {
        const cached = await api.getWorkflowAnalysis(runId);
        if (cancelled) return;
        if (cached) {
          setAnalysis(cached);
          setStatus(
            cached.analyzedAt
              ? `Loaded cached analysis from ${formatDate(cached.analyzedAt)}`
              : 'Loaded cached analysis',
          );
        }
      } catch {
        // No cache / transient error — user can still run Analyze.
      } finally {
        if (!cancelled) setLoadingCache(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runId]);

  const appendLog = (role: AnalysisLogEntry['role'], text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    logIdRef.current += 1;
    const id = logIdRef.current;
    setLogEntries((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.text === trimmed) return prev;
      return [...prev, { id, role, text: trimmed }];
    });
  };

  const handleEvent = (event: WorkflowFailureAnalysisEvent) => {
    if (event.type === 'status') {
      setStatus(event.message);
      appendLog('status', event.message);
      return;
    }
    if (event.type === 'log') {
      appendLog(event.role, event.text);
      return;
    }
    if (event.type === 'result') {
      setAnalysis(event.analysis);
      setStatus('Analysis complete');
      return;
    }
    if (event.type === 'error') {
      setError(event.message);
      appendLog('system', event.message);
    }
  };

  const runAnalysis = async (refresh: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setStatus(refresh ? 'Re-analyzing…' : 'Starting…');
    setLogEntries([]);
    logIdRef.current = 0;

    try {
      const result = await api.analyzeWorkflowStream(runId, handleEvent, {
        signal: controller.signal,
        refresh,
      });
      setAnalysis(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  };

  return (
    <Paper
      sx={{
        p: 2.5,
        borderLeft: 4,
        borderColor: 'secondary.main',
        bgcolor: 'background.paper',
      }}
    >
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          useFlexGap
        >
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <AutoAwesomeIcon color="secondary" fontSize="small" />
              <Typography variant="h6">Claude failure analysis</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Groups analysis by each failed job and orchestration stage, using GitHub job logs,
              release notes, and stage test reports. Results are cached per run.
            </Typography>
          </Stack>
          <Button
            variant="contained"
            color="secondary"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
            onClick={() => void runAnalysis(Boolean(analysis))}
            disabled={loading || loadingCache}
          >
            {loading ? 'Analyzing…' : analysis ? 'Re-analyze' : 'Analyze failure'}
          </Button>
        </Stack>

        {meta?.claudeAnalysisAvailable === false ? (
          <Alert severity="warning">
            Configure Claude Agent auth: set <code>ANTHROPIC_API_KEY</code>, or{' '}
            <code>apiKeyHelper</code> (and related settings) in <code>~/.claude/settings.json</code>.
          </Alert>
        ) : null}

        <AnalysisProgressLog entries={logEntries} status={status} loading={loading} />

        {error ? <Alert severity="error">{error}</Alert> : null}

        {analysis ? (
          <Stack spacing={1.5}>
            <Typography>{analysis.summary}</Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {analysis.analyzedAt ? (
                <Chip
                  size="small"
                  label={`cached ${formatDate(analysis.analyzedAt)}`}
                  variant="outlined"
                  color="secondary"
                />
              ) : null}
              {analysis.tagName ? (
                <Chip size="small" label={`tag ${analysis.tagName}`} variant="outlined" />
              ) : null}
              <Chip
                size="small"
                label={`notes: ${analysis.releaseNotesSource}`}
                variant="outlined"
              />
              {analysis.model ? (
                <Chip
                  size="small"
                  label={analysis.model}
                  variant="outlined"
                  sx={{ fontFamily: '"IBM Plex Mono", monospace' }}
                />
              ) : null}
              {analysis.release ? (
                <Link href={analysis.release.htmlUrl} target="_blank" rel="noreferrer" variant="body2">
                  {analysis.release.name}
                </Link>
              ) : null}
            </Stack>

            <ByFailureGroups analysis={analysis} />

            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
              <Typography variant="overline" color="text.secondary">
                Overall likely causes
              </Typography>
              <Stack spacing={1.25} sx={{ mt: 0.5 }}>
                <LikelyCauseList causes={analysisLikelyCauses(analysis)} />
              </Stack>
            </Paper>

            <FailedStageTestChips analysis={analysis} />

            {analysis.associatedPrs.length > 0 ? (
              <Stack spacing={0.75}>
                <Typography variant="caption" color="text.secondary">
                  PRs from release notes
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {analysis.associatedPrs.map((pr) => {
                    const implicated =
                      analysisLikelyCauses(analysis).some((cause) => cause.prNumber === pr.number) ||
                      analysisByFailure(analysis).some((entry) =>
                        entry.likelyCauses.some((cause) => cause.prNumber === pr.number),
                      );
                    return (
                      <Chip
                        key={pr.number}
                        size="small"
                        component={RouterLink}
                        to={`/prs/${pr.number}`}
                        clickable
                        label={`#${pr.number}${pr.author ? ` @${pr.author}` : ''}`}
                        color={implicated ? 'secondary' : 'default'}
                        variant={implicated ? 'filled' : 'outlined'}
                      />
                    );
                  })}
                </Stack>
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}

export default function WorkflowDetailPage() {
  const { id } = useParams();
  const runId = Number(id);
  const { data, error, loading } = useAsyncData(() => api.workflow(runId), [runId]);
  const [tab, setTab] = useState(0);

  if (loading) return <LoadingBlock />;
  if (error || !data) return <ErrorState message={error ?? 'Workflow run not found'} />;

  const hasOrchestration = Boolean(data.orchestration);
  const backTo = data.workflowId
    ? `/workflows/by/${data.workflowId}`
    : '/workflows';

  const showAnalysis =
    data.conclusion === 'failure' ||
    data.conclusion === 'timed_out' ||
    data.conclusion === 'startup_failure' ||
    Boolean(data.orchestration?.pipeline.stages.some((s) => s.State === 4));

  const jobsTab = (
    <Stack spacing={3}>
      <LongestHighlights jobs={data.jobs} runDurationSeconds={data.durationSeconds} />
      <WorkflowJobsPanel jobs={data.jobs} runDurationSeconds={data.durationSeconds} />
    </Stack>
  );

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

      {showAnalysis ? <FailureAnalysisPanel runId={data.id} /> : null}

      {hasOrchestration && data.orchestration ? (
        <>
          <Tabs
            value={tab}
            onChange={(_, next: number) => setTab(next)}
            sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
          >
            <Tab label="Jobs" sx={{ minHeight: 40 }} />
            <Tab
              label={`Orchestration (${data.orchestration.pipeline.stages.length})`}
              sx={{ minHeight: 40 }}
            />
          </Tabs>
          {tab === 0 ? jobsTab : null}
          {tab === 1 ? (
            <OrchestrationPipeline
              orchestration={data.orchestration}
              artifact={data.orchestrationArtifact}
            />
          ) : null}
        </>
      ) : (
        jobsTab
      )}
    </Stack>
  );
}
