import {
  Box,
  Chip,
  Link,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { Link as RouterLink } from 'react-router-dom';
import type { WorkflowLifecycleLane, WorkflowMapEntry } from '../../shared/types';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState, LoadingBlock } from './ui';

const LANE_ACCENT: Record<string, string> = {
  pull_request: '#1565C0',
  merge_queue: '#C77700',
  push: '#0F7B4B',
  release: '#E36414',
  schedule: '#5E35B1',
  manual: '#3D5560',
  reusable: '#607D8B',
  other: '#78909C',
};

function WorkflowChip({ workflow }: { workflow: WorkflowMapEntry }) {
  const path = workflow.path.replace(/^\.github\/workflows\//, '');
  return (
    <Tooltip
      title={
        <Box sx={{ maxWidth: 320 }}>
          <Typography variant="caption" display="block">
            {path}
          </Typography>
          <Typography variant="caption" display="block">
            Triggers: {workflow.triggers.length ? workflow.triggers.join(', ') : 'unknown'}
          </Typography>
          {workflow.pathFiltered ? (
            <Typography variant="caption" display="block">
              Path-filtered
            </Typography>
          ) : null}
          {workflow.source !== 'yaml' ? (
            <Typography variant="caption" display="block">
              Source: {workflow.source}
            </Typography>
          ) : null}
        </Box>
      }
    >
      <Chip
        component={RouterLink}
        to={`/workflows/by/${workflow.workflowId}`}
        clickable
        size="small"
        label={
          workflow.pathFiltered ? (
            <Stack direction="row" spacing={0.5} alignItems="center" component="span">
              <span>{workflow.name}</span>
              <Box
                component="span"
                sx={{
                  fontSize: 10,
                  opacity: 0.75,
                  fontFamily: '"IBM Plex Mono", monospace',
                }}
              >
                paths
              </Box>
            </Stack>
          ) : (
            workflow.name
          )
        }
        variant="outlined"
        sx={{
          maxWidth: '100%',
          justifyContent: 'flex-start',
          '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
        }}
      />
    </Tooltip>
  );
}

function LaneColumn({ lane }: { lane: WorkflowLifecycleLane }) {
  const accent = LANE_ACCENT[lane.id] ?? LANE_ACCENT.other;
  return (
    <Paper
      sx={{
        p: 1.5,
        minWidth: { xs: '100%', md: 220 },
        flex: { md: '1 1 0' },
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        borderTop: `3px solid ${accent}`,
      }}
    >
      <Box>
        <Typography variant="subtitle2" fontWeight={700}>
          {lane.label}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
          {lane.description}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ mt: 0.5, display: 'block', fontFamily: '"IBM Plex Mono", monospace' }}
        >
          {lane.workflows.length} workflow{lane.workflows.length === 1 ? '' : 's'}
        </Typography>
      </Box>
      <Stack spacing={0.75} sx={{ mt: 0.5 }}>
        {lane.workflows.map((w) => (
          <WorkflowChip key={`${lane.id}-${w.workflowId}`} workflow={w} />
        ))}
      </Stack>
    </Paper>
  );
}

function FlowArrow() {
  return (
    <Box
      sx={{
        display: { xs: 'none', md: 'flex' },
        alignItems: 'center',
        color: 'text.secondary',
        px: 0.25,
        flexShrink: 0,
      }}
      aria-hidden
    >
      <ArrowForwardIcon fontSize="small" />
    </Box>
  );
}

export function WorkflowLifecycleDiagram() {
  const { data, error, loading } = useAsyncData(() => api.workflowMap(), []);

  if (loading && !data) return <LoadingBlock rows={6} />;
  if (error || !data) return <ErrorState message={error ?? 'Failed to load workflow map'} />;

  const primary = data.lanes.filter((l) => l.primary);
  const secondary = data.lanes.filter((l) => !l.primary);

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h6" gutterBottom>
          When workflows run
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Grouped from each workflow’s{' '}
          <Box component="span" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
            on:
          </Box>{' '}
          triggers
          {data.observedOnly > 0
            ? ` (${data.observedOnly} inferred from recent runs; ${data.parsedFromYaml} from YAML)`
            : ` (${data.parsedFromYaml} from YAML)`}
          . Path-filtered workflows only run when matching files change.
        </Typography>
      </Box>

      <Box>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ display: 'block', mb: 1 }}
        >
          Main path
        </Typography>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1}
          alignItems={{ xs: 'stretch', md: 'stretch' }}
          sx={{ overflowX: { md: 'auto' }, pb: 0.5 }}
        >
          {primary.map((lane, index) => (
            <Box
              key={lane.id}
              sx={{ display: 'flex', alignItems: 'stretch', gap: 1, minWidth: 0, flex: { md: 1 } }}
            >
              {index > 0 ? <FlowArrow /> : null}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <LaneColumn lane={lane} />
              </Box>
            </Box>
          ))}
        </Stack>
      </Box>

      {secondary.length > 0 ? (
        <Box>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ display: 'block', mb: 1 }}
          >
            Also runs
          </Typography>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            alignItems="stretch"
            useFlexGap
            flexWrap="wrap"
          >
            {secondary.map((lane) => (
              <Box key={lane.id} sx={{ flex: { md: '1 1 220px' }, minWidth: { md: 220 } }}>
                <LaneColumn lane={lane} />
              </Box>
            ))}
          </Stack>
        </Box>
      ) : null}

      <Typography variant="caption" color="text.secondary">
        Tip: a workflow can appear in more than one lane when it listens for multiple events (for
        example Merge Queue often also registers on{' '}
        <Link
          component="span"
          underline="none"
          sx={{ fontFamily: '"IBM Plex Mono", monospace', color: 'inherit' }}
        >
          pull_request
        </Link>{' '}
        as a required-check sentinel).
      </Typography>
    </Stack>
  );
}
