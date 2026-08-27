import { useState } from 'react';
import {
  Alert,
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
import type { WorkflowFailureAnalysis, WorkflowRunDetail } from '../../shared/types';

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
  confidence: WorkflowFailureAnalysis['likelyCause']['confidence'],
): 'success' | 'warning' | 'default' {
  if (confidence === 'high') return 'success';
  if (confidence === 'medium') return 'warning';
  return 'default';
}

function FailureAnalysisPanel({ runId }: { runId: number }) {
  const { data: meta } = useAsyncData(() => api.meta(), []);
  const [analysis, setAnalysis] = useState<WorkflowFailureAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.analyzeWorkflow(runId);
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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
              Uses release notes linked to this run’s tag to identify the likely PR and author.
            </Typography>
          </Stack>
          <Button
            variant="contained"
            color="secondary"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
            onClick={() => void runAnalysis()}
            disabled={loading || meta?.claudeAnalysisAvailable === false}
          >
            {loading ? 'Analyzing…' : analysis ? 'Re-analyze' : 'Analyze failure'}
          </Button>
        </Stack>

        {meta?.claudeAnalysisAvailable === false ? (
          <Alert severity="warning">
            Set <code>ANTHROPIC_API_KEY</code> on the server to enable Claude Agent analysis.
          </Alert>
        ) : null}

        {error ? <Alert severity="error">{error}</Alert> : null}

        {analysis ? (
          <Stack spacing={1.5}>
            <Typography>{analysis.summary}</Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
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

            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
              <Typography variant="overline" color="text.secondary">
                Likely cause
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                {analysis.likelyCause.prNumber != null ? (
                  <Link
                    component={RouterLink}
                    to={`/prs/${analysis.likelyCause.prNumber}`}
                    underline="hover"
                    fontWeight={700}
                  >
                    #{analysis.likelyCause.prNumber}
                    {analysis.likelyCause.prTitle ? ` · ${analysis.likelyCause.prTitle}` : ''}
                  </Link>
                ) : (
                  <Typography fontWeight={700}>No single PR identified</Typography>
                )}
                {analysis.likelyCause.author ? (
                  <Chip size="small" label={`@${analysis.likelyCause.author}`} color="secondary" />
                ) : null}
                <Chip
                  size="small"
                  label={`${analysis.likelyCause.confidence} confidence`}
                  color={confidenceColor(analysis.likelyCause.confidence)}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {analysis.likelyCause.reasoning}
              </Typography>
            </Paper>

            {analysis.associatedPrs.length > 0 ? (
              <Stack spacing={0.75}>
                <Typography variant="caption" color="text.secondary">
                  PRs from release notes
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {analysis.associatedPrs.map((pr) => (
                    <Chip
                      key={pr.number}
                      size="small"
                      component={RouterLink}
                      to={`/prs/${pr.number}`}
                      clickable
                      label={`#${pr.number}${pr.author ? ` @${pr.author}` : ''}`}
                      color={pr.number === analysis.likelyCause.prNumber ? 'secondary' : 'default'}
                      variant={pr.number === analysis.likelyCause.prNumber ? 'filled' : 'outlined'}
                    />
                  ))}
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
