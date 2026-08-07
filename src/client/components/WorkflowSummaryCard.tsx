import {
  Box,
  Chip,
  IconButton,
  Link,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { formatDate } from './ui';
import { ConclusionStrip, DurationSparkline } from './CiHealthVisuals';
import {
  DEFAULT_RUN_LIMIT,
  formatDurationSeconds,
  round,
  type RunLimit,
} from '../../shared/utils';
import type { WorkflowConclusionKind, WorkflowRunSummary } from '../../shared/types';

const RECENT_RUN_COUNT = 12;

function conclusionColor(conclusion: string | null, status: string | null): string {
  if (status && status !== 'completed') return 'info.main';
  switch (conclusion) {
    case 'success':
      return 'success.main';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'error.main';
    case 'cancelled':
      return 'text.disabled';
    default:
      return 'action.disabled';
  }
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

function conclusionKind(conclusion: string | null): WorkflowConclusionKind {
  if (conclusion === 'success') return 'success';
  if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure') {
    return 'failure';
  }
  if (conclusion === 'cancelled') return 'cancelled';
  return 'other';
}

function RunHistoryStrip({ runs }: { runs: WorkflowRunSummary[] }) {
  const recent = runs.slice(0, RECENT_RUN_COUNT);
  if (recent.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No runs in this sample.
      </Typography>
    );
  }

  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {recent.map((run) => {
        const started = formatDate(run.runStartedAt ?? run.createdAt);
        const duration = formatDurationSeconds(run.durationSeconds);
        const result = run.status !== 'completed' ? run.status : (run.conclusion ?? '—');
        return (
          <Tooltip
            key={run.id}
            title={`#${run.id} · ${result} · ${duration} · ${started}`}
            arrow
          >
            <Box
              component={RouterLink}
              to={`/workflows/runs/${run.id}`}
              sx={{
                width: 10,
                height: 10,
                borderRadius: 0.5,
                bgcolor: conclusionColor(run.conclusion, run.status),
                display: 'inline-block',
              }}
            />
          </Tooltip>
        );
      })}
    </Stack>
  );
}

export function WorkflowSummaryCard({
  workflowId,
  fallbackName,
  runLimit = DEFAULT_RUN_LIMIT,
  onRemove,
}: {
  workflowId: number;
  fallbackName?: string;
  runLimit?: RunLimit;
  onRemove: () => void;
}) {
  const { data, error, loading } = useAsyncData(
    () => api.workflowRuns(workflowId, runLimit),
    [workflowId, runLimit],
  );

  const runs = data?.items ?? [];
  const name = data?.name || fallbackName || `Workflow #${workflowId}`;

  const success = runs.filter((r) => r.conclusion === 'success').length;
  const failure = runs.filter((r) => r.conclusion === 'failure').length;
  const cancelled = runs.filter((r) => r.conclusion === 'cancelled').length;
  const durations = runs
    .map((r) => r.durationSeconds)
    .filter((d): d is number => d != null && Number.isFinite(d));
  const avgDuration = durations.length
    ? round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;
  const successRate = runs.length ? Math.round((success / runs.length) * 100) : 0;
  const latest = runs[0];
  const recentConclusions = runs.slice(0, RECENT_RUN_COUNT).map((r) => conclusionKind(r.conclusion));
  const durationSparkline = [...runs]
    .slice(0, RECENT_RUN_COUNT)
    .reverse()
    .map((r) => r.durationSeconds)
    .filter((d): d is number => d != null && Number.isFinite(d));

  return (
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Link
            component={RouterLink}
            to={`/workflows/by/${workflowId}`}
            underline="hover"
            fontWeight={600}
            sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {name}
          </Link>
          <Typography variant="caption" color="text.secondary">
            #{workflowId}
          </Typography>
        </Box>
        <Tooltip title="Remove summary card">
          <IconButton size="small" aria-label={`Remove ${name} summary`} onClick={onRemove}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {loading && !data ? (
        <Typography variant="body2" color="text.secondary">
          Loading runs…
        </Typography>
      ) : error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : (
        <>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="overline" color="text.secondary" display="block" lineHeight={1.2}>
                Success
              </Typography>
              <Typography variant="h6" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                {runs.length ? `${successRate}%` : '—'}
              </Typography>
            </Box>
            <Box>
              <Typography variant="overline" color="text.secondary" display="block" lineHeight={1.2}>
                Avg time
              </Typography>
              <Typography variant="h6" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                {formatDurationSeconds(avgDuration)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="overline" color="text.secondary" display="block" lineHeight={1.2}>
                Runs
              </Typography>
              <Typography variant="h6" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                {runs.length}
              </Typography>
            </Box>
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {success} ok · {failure} fail · {cancelled} cancel
          </Typography>

          <Stack direction="row" spacing={2} alignItems="flex-end" flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="overline" color="text.secondary">
                Recent
              </Typography>
              <ConclusionStrip conclusions={recentConclusions} />
            </Box>
            <Box>
              <Typography variant="overline" color="text.secondary">
                Duration
              </Typography>
              <DurationSparkline values={durationSparkline} />
            </Box>
          </Stack>

          <Box>
            <Typography variant="overline" color="text.secondary">
              Run links
            </Typography>
            <RunHistoryStrip runs={runs} />
          </Box>

          {latest ? (
            <Stack spacing={0.5} sx={{ mt: 'auto', pt: 0.5, borderTop: 1, borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary">
                Latest
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Link
                  component={RouterLink}
                  to={`/workflows/runs/${latest.id}`}
                  underline="hover"
                  fontWeight={600}
                  variant="body2"
                >
                  #{latest.id}
                </Link>
                {conclusionChip(latest.conclusion, latest.status)}
                <Typography variant="body2" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                  {formatDurationSeconds(latest.durationSeconds)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatDate(latest.runStartedAt ?? latest.createdAt)}
                </Typography>
              </Stack>
            </Stack>
          ) : null}
        </>
      )}
    </Paper>
  );
}
