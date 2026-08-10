import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  IconButton,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import { Link as RouterLink } from 'react-router-dom';
import type {
  OrchestrationMatrixRun,
  OrchestrationStageRun,
  WorkflowOrchestrationState,
} from '../../shared/types';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { LoadingBlock, formatDate } from '../components/ui';
import { WorkflowJobsPanel } from './WorkflowJobsPanel';
import {
  formatDurationSeconds,
  parseGithubActionsRunUrl,
  parseGithubRepoRef,
  secondsBetween,
} from '../../shared/utils';

const STAGE_STATE: Record<
  number,
  {
    label: string;
    color: 'default' | 'success' | 'error' | 'warning' | 'info';
    border: string;
    bg: string;
  }
> = {
  0: { label: 'pending', color: 'default', border: 'rgba(15, 76, 92, 0.28)', bg: 'rgba(15, 76, 92, 0.04)' },
  1: { label: 'waiting', color: 'warning', border: '#C77700', bg: 'rgba(199, 119, 0, 0.1)' },
  2: { label: 'skipped', color: 'default', border: 'rgba(61, 85, 96, 0.35)', bg: 'rgba(61, 85, 96, 0.06)' },
  3: { label: 'success', color: 'success', border: '#0F7B4B', bg: 'rgba(15, 123, 75, 0.1)' },
  4: { label: 'failure', color: 'error', border: '#C62828', bg: 'rgba(198, 40, 40, 0.1)' },
};

type StageGroup = { key: string; label: string; stages: OrchestrationStageRun[] };

/** Stages that share Stage.Group render as a parallel column; ungrouped stages are solo columns. */
function groupStagesForFlow(stages: OrchestrationStageRun[]): StageGroup[] {
  const groups: StageGroup[] = [];
  const indexByKey = new Map<string, number>();

  for (const stage of stages) {
    const groupName = stage.Stage.Group?.trim() ?? '';
    const key = groupName || `__solo__:${stage.Stage.ID}`;
    let idx = indexByKey.get(key);
    if (idx === undefined) {
      idx = groups.length;
      indexByKey.set(key, idx);
      groups.push({ key, label: groupName, stages: [] });
    }
    groups[idx].stages.push(stage);
  }

  return groups;
}

function stageDomId(stageId: string): string {
  return `orch-stage-${stageId}`;
}

function scrollToStage(stageId: string) {
  const el = document.getElementById(stageDomId(stageId));
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const summary = el.querySelector('[role="button"]') as HTMLElement | null;
  if (summary && summary.getAttribute('aria-expanded') === 'false') {
    summary.click();
  }
}

function stageStateChip(state: number) {
  const meta = STAGE_STATE[state] ?? { label: `state ${state}`, color: 'default' as const };
  return <Chip size="small" label={meta.label} color={meta.color} />;
}

function isZeroTime(value: string | null | undefined): boolean {
  if (!value) return true;
  return value.startsWith('0001-01-01');
}

function stageDurationSeconds(stage: OrchestrationStageRun): number | null {
  if (isZeroTime(stage.StartTime) || isZeroTime(stage.EndTime)) return null;
  return secondsBetween(stage.StartTime, stage.EndTime);
}

function resolveRunRepo(
  runUrl: string | null | undefined,
  stageRepo?: string | null,
): { owner: string; repo: string } | null {
  const fromUrl = parseGithubActionsRunUrl(runUrl);
  if (fromUrl) return { owner: fromUrl.owner, repo: fromUrl.repo };
  return parseGithubRepoRef(stageRepo);
}

function StageOutputs({ outputs }: { outputs: Record<string, string> }) {
  const entries = Object.entries(outputs);
  if (entries.length === 0) return null;
  return (
    <Stack spacing={0.5} sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary">
        Outputs
      </Typography>
      {entries.map(([key, value]) => (
        <Typography
          key={key}
          variant="body2"
          sx={{ fontFamily: '"IBM Plex Mono", monospace', wordBreak: 'break-all' }}
        >
          {key}={value}
        </Typography>
      ))}
    </Stack>
  );
}

function StageTestReport({ stage }: { stage: OrchestrationStageRun }) {
  const report = stage.TestReport;
  if (!report) return null;
  return (
    <Stack spacing={1} sx={{ mt: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        Test report · {report.overall}
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Suite</TableCell>
            <TableCell align="right">Passed</TableCell>
            <TableCell align="right">Failed</TableCell>
            <TableCell align="right">Skipped</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {report.suites.map((suite) => (
            <TableRow key={suite.key}>
              <TableCell>{suite.label}</TableCell>
              <TableCell align="right">{suite.passed}</TableCell>
              <TableCell align="right">{suite.failed}</TableCell>
              <TableCell align="right">{suite.skipped}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={suite.status}
                  color={suite.status === 'passed' ? 'success' : suite.status === 'failed' ? 'error' : 'default'}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {report.suites.some((s) => s.failedTests.length > 0) ? (
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            Failed tests
          </Typography>
          {report.suites.flatMap((suite) =>
            suite.failedTests.map((test) => (
              <Typography key={`${suite.key}-${test}`} variant="body2" color="error.main">
                {test}
              </Typography>
            )),
          )}
        </Stack>
      ) : null}
    </Stack>
  );
}

function LazyWorkflowRunDetails({
  runId,
  owner,
  repo,
  runUrl,
}: {
  runId: number;
  owner?: string | null;
  repo?: string | null;
  runUrl?: string | null;
}) {
  const { data: meta } = useAsyncData(() => api.meta(), []);
  const { data, error, loading } = useAsyncData(
    () =>
      api.workflow(runId, {
        includeOrchestration: false,
        owner: owner ?? undefined,
        repo: repo ?? undefined,
      }),
    [runId, owner, repo],
  );

  if (loading) return <LoadingBlock rows={3} />;
  if (error || !data) {
    return (
      <Typography variant="body2" color="error.main" sx={{ mt: 1 }}>
        {error ?? 'Failed to load workflow run details'}
        {runUrl ? (
          <>
            {' · '}
            <Link href={runUrl} target="_blank" rel="noreferrer">
              open on GitHub
            </Link>
          </>
        ) : null}
      </Typography>
    );
  }

  const isCrossRepo =
    Boolean(owner && repo) &&
    (!meta || meta.owner !== owner || meta.repo !== repo);

  return (
    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2">Workflow run details</Typography>
        {owner && repo ? (
          <Chip size="small" label={`${owner}/${repo}`} variant="outlined" />
        ) : null}
        <Chip size="small" label={`#${data.id}`} variant="outlined" />
        <Chip
          size="small"
          label={data.conclusion ?? data.status ?? 'unknown'}
          color={
            data.conclusion === 'success' ? 'success' : data.conclusion === 'failure' ? 'error' : 'default'
          }
        />
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
          {formatDurationSeconds(data.durationSeconds)}
        </Typography>
        {!isCrossRepo ? (
          <Button component={RouterLink} to={`/workflows/runs/${runId}`} size="small" variant="text">
            Open run
          </Button>
        ) : runUrl || data.htmlUrl ? (
          <Button
            href={runUrl || data.htmlUrl}
            target="_blank"
            rel="noreferrer"
            size="small"
            variant="text"
            endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
          >
            GitHub
          </Button>
        ) : null}
      </Stack>
      <WorkflowJobsPanel
        jobs={data.jobs}
        runDurationSeconds={data.durationSeconds}
        defaultExpandLongest={false}
      />
    </Stack>
  );
}

function MatrixRunSummary({ run }: { run: OrchestrationMatrixRun }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ width: '100%', pr: 1 }}>
      {stageStateChip(run.State)}
      <Typography variant="body2" sx={{ fontFamily: '"IBM Plex Mono", monospace', flex: 1 }}>
        {run.Inputs['source-repository-name'] ??
          run.Inputs['image-tag'] ??
          Object.values(run.Inputs).slice(0, 2).join(' · ')}
      </Typography>
      {run.StatusText ? (
        <Typography variant="caption" color="text.secondary">
          {run.StatusText}
        </Typography>
      ) : null}
      {run.RunURL ? (
        <Link
          href={run.RunURL}
          target="_blank"
          rel="noreferrer"
          variant="body2"
          onClick={(e) => e.stopPropagation()}
        >
          GitHub
        </Link>
      ) : null}
      {run.Error ? (
        <Typography variant="caption" color="error.main">
          {run.Error}
        </Typography>
      ) : null}
    </Stack>
  );
}

function MatrixRunRow({ run }: { run: OrchestrationMatrixRun }) {
  const [expanded, setExpanded] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const hasRunId = typeof run.RunID === 'number' && run.RunID > 0;
  const repoRef = resolveRunRepo(run.RunURL);

  if (!hasRunId) {
    return <MatrixRunSummary run={run} />;
  }

  return (
    <Accordion
      disableGutters
      elevation={0}
      expanded={expanded}
      onChange={(_, next) => {
        setExpanded(next);
        if (next) setShouldLoad(true);
      }}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, '&:before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <MatrixRunSummary run={run} />
      </AccordionSummary>
      <AccordionDetails>
        {shouldLoad ? (
          <LazyWorkflowRunDetails
            runId={run.RunID}
            owner={repoRef?.owner}
            repo={repoRef?.repo}
            runUrl={run.RunURL}
          />
        ) : null}
      </AccordionDetails>
    </Accordion>
  );
}

function StageMatrixRuns({ stage }: { stage: OrchestrationStageRun }) {
  const runs = stage.MatrixRuns;
  if (!runs?.length) return null;
  return (
    <Stack spacing={1} sx={{ mt: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        Matrix runs
      </Typography>
      {runs.map((run) => (
        <MatrixRunRow key={run.RunID || JSON.stringify(run.Inputs)} run={run} />
      ))}
    </Stack>
  );
}

function StageChecklist({ stage }: { stage: OrchestrationStageRun }) {
  const items = stage.Stage.Items;
  if (!items?.length) return null;
  return (
    <Stack component="ul" spacing={0.5} sx={{ mt: 1, pl: 2, m: 0 }}>
      {items.map((item) => (
        <Typography component="li" key={item} variant="body2">
          {item}
        </Typography>
      ))}
    </Stack>
  );
}

function FlowStageNode({ stage }: { stage: OrchestrationStageRun }) {
  const meta = STAGE_STATE[stage.State] ?? STAGE_STATE[0];
  const duration = stageDurationSeconds(stage);
  const skipped = stage.State === 2;

  return (
    <Box
      component="button"
      type="button"
      onClick={() => scrollToStage(stage.Stage.ID)}
      sx={{
        all: 'unset',
        boxSizing: 'border-box',
        display: 'block',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: 'inherit',
        border: 2,
        borderStyle: skipped ? 'dashed' : 'solid',
        borderColor: meta.border,
        bgcolor: meta.bg,
        borderRadius: 1.5,
        px: 1.25,
        py: 1,
        minWidth: 148,
        maxWidth: 200,
        transition: 'transform 120ms ease, box-shadow 120ms ease',
        '&:hover': {
          transform: 'translateY(-1px)',
          boxShadow: `0 0 0 1px ${meta.border}`,
        },
        '&:focus-visible': {
          outline: `2px solid ${meta.border}`,
          outlineOffset: 2,
        },
      }}
    >
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip size="small" label={meta.label} color={meta.color} sx={{ height: 20, '& .MuiChip-label': { px: 0.75 } }} />
          {stage.Stage.Advisory ? (
            <Chip size="small" label="advisory" variant="outlined" sx={{ height: 20 }} />
          ) : null}
        </Stack>
        <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.3 }}>
          {stage.Stage.Name}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="baseline" justifyContent="space-between">
          <Typography variant="caption" color="text.secondary" noWrap title={stage.Stage.ID}>
            {stage.Stage.ID}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: '"IBM Plex Mono", monospace', flexShrink: 0 }}>
            {formatDurationSeconds(duration)}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}

const FLOW_ZOOM_MIN = 0.1;
const FLOW_ZOOM_MAX = 2;
const FLOW_ZOOM_STEP = 0.1;
const FLOW_ZOOM_DEFAULT = 1;

function clampFlowZoom(value: number, step = FLOW_ZOOM_STEP): number {
  const stepped = Math.round(value / step) * step;
  const precision = step < 0.1 ? 2 : 1;
  return Math.min(FLOW_ZOOM_MAX, Math.max(FLOW_ZOOM_MIN, Number(stepped.toFixed(precision))));
}

/** Floor to 1% so fit never rounds up into overflow. */
function fitZoomLevel(available: number, natural: number): number {
  if (available <= 0 || natural <= 0) return FLOW_ZOOM_DEFAULT;
  const next = Math.min(1, available / natural);
  return clampFlowZoom(Math.floor(next * 100) / 100, 0.01);
}

function readNaturalSize(el: HTMLElement): { width: number; height: number } {
  // scroll* reflects max-content even if a parent would otherwise shrink the box.
  return {
    width: Math.max(el.offsetWidth, el.scrollWidth),
    height: Math.max(el.offsetHeight, el.scrollHeight),
  };
}

function StageFlowDiagram({ stages }: { stages: OrchestrationStageRun[] }) {
  const [zoom, setZoom] = useState(FLOW_ZOOM_DEFAULT);
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** When true, viewport resize / stage changes re-run fit. Cleared by manual zoom. */
  const autoFitRef = useRef(true);
  const groups = groupStagesForFlow(stages);

  const applyZoom = (next: number | ((prev: number) => number), opts?: { autoFit?: boolean }) => {
    if (opts?.autoFit === false) autoFitRef.current = false;
    if (opts?.autoFit === true) autoFitRef.current = true;
    setZoom(next);
  };

  const fitToWindow = (opts?: { userInitiated?: boolean }) => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const { width: naturalWidth } = readNaturalSize(content);
    if (naturalWidth <= 0) return;

    const styles = getComputedStyle(viewport);
    const padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
    const availableWidth = Math.max(0, viewport.clientWidth - padX);
    const next = fitZoomLevel(availableWidth, naturalWidth);
    if (opts?.userInitiated) autoFitRef.current = true;
    setZoom(next);
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;

    // Second pass after paint: correct if a scrollbar (or subpixels) still overflows.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const vp = viewportRef.current;
        if (!vp) return;
        if (vp.scrollWidth <= vp.clientWidth + 1) return;
        const ratio = vp.clientWidth / vp.scrollWidth;
        setZoom((z) => clampFlowZoom(Math.floor(z * ratio * 100) / 100, 0.01));
        vp.scrollLeft = 0;
      });
    });
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -FLOW_ZOOM_STEP : FLOW_ZOOM_STEP;
      autoFitRef.current = false;
      setZoom((z) => clampFlowZoom(z + delta));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content) return;

    autoFitRef.current = true;
    const measure = () => {
      const size = readNaturalSize(content);
      setContentSize((prev) =>
        prev.width === size.width && prev.height === size.height ? prev : size,
      );
      if (autoFitRef.current) fitToWindow();
    };
    measure();

    const contentRo = new ResizeObserver(measure);
    contentRo.observe(content);

    const viewportRo = viewport
      ? new ResizeObserver(() => {
          if (autoFitRef.current) fitToWindow();
        })
      : null;
    if (viewport && viewportRo) viewportRo.observe(viewport);

    return () => {
      contentRo.disconnect();
      viewportRo?.disconnect();
    };
    // stages identity changes when the env filter updates the diagram.
  }, [stages]);

  if (groups.length === 0) return null;

  const scaledWidth = contentSize.width > 0 ? contentSize.width * zoom : undefined;
  const scaledHeight = contentSize.height > 0 ? contentSize.height * zoom : undefined;

  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 1.5 }}
      >
        <Typography variant="subtitle2" color="text.secondary">
          Stage flow
          {groups.some((g) => g.label && g.stages.length > 1)
            ? ' · same group runs in parallel'
            : null}
        </Typography>
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Tooltip title="Zoom out">
            <span>
              <IconButton
                size="small"
                aria-label="Zoom out stage flow"
                onClick={() => applyZoom((z) => clampFlowZoom(z - FLOW_ZOOM_STEP), { autoFit: false })}
                disabled={zoom <= FLOW_ZOOM_MIN}
              >
                <ZoomOutIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={zoom === FLOW_ZOOM_DEFAULT ? 'Current zoom' : 'Reset zoom'}>
            <span>
              <Button
                size="small"
                variant="text"
                color="inherit"
                onClick={() => applyZoom(FLOW_ZOOM_DEFAULT, { autoFit: false })}
                disabled={zoom === FLOW_ZOOM_DEFAULT}
                sx={{
                  minWidth: 52,
                  px: 0.75,
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 12,
                  color: 'text.secondary',
                }}
                aria-label={`Zoom ${Math.round(zoom * 100)} percent${zoom === FLOW_ZOOM_DEFAULT ? '' : ', click to reset'}`}
              >
                {Math.round(zoom * 100)}%
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Zoom in">
            <span>
              <IconButton
                size="small"
                aria-label="Zoom in stage flow"
                onClick={() => applyZoom((z) => clampFlowZoom(z + FLOW_ZOOM_STEP), { autoFit: false })}
                disabled={zoom >= FLOW_ZOOM_MAX}
              >
                <ZoomInIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Fit to window">
            <IconButton
              size="small"
              aria-label="Fit stage flow to window"
              onClick={() => fitToWindow({ userInitiated: true })}
            >
              <FitScreenIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
      <Box
        ref={viewportRef}
        sx={{
          overflow: 'auto',
        }}
      >
        {/*
          Spacer owns the *visual* scroll size (natural × zoom). Content is absolutely
          positioned with width:max-content so the scaled wrapper never shrink-to-fits
          the diagram and permanently clips stages under overflow:hidden.
        */}
        <Box
          sx={{
            width: scaledWidth,
            height: scaledHeight,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Box
            ref={contentRef}
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              display: 'inline-flex',
              alignItems: 'stretch',
              width: 'max-content',
              gap: 0,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          >
            {groups.map((group, groupIdx) => (
              <Box
                key={group.key}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                <Stack spacing={1} sx={{ minWidth: 148 }}>
                  {group.label ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ px: 0.25, textTransform: 'uppercase', letterSpacing: '0.06em' }}
                    >
                      {group.label}
                    </Typography>
                  ) : (
                    <Box sx={{ height: 18 }} />
                  )}
                  <Stack spacing={1}>
                    {group.stages.map((stage) => (
                      <FlowStageNode key={stage.Stage.ID} stage={stage} />
                    ))}
                  </Stack>
                </Stack>
                {groupIdx < groups.length - 1 ? (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      alignSelf: 'center',
                      px: 1.25,
                      color: 'text.secondary',
                      mt: group.label || groups[groupIdx + 1]?.label ? 2.5 : 0,
                    }}
                    aria-hidden
                  >
                    <Box
                      sx={{
                        width: 18,
                        height: 2,
                        bgcolor: 'divider',
                        borderRadius: 1,
                      }}
                    />
                    <ArrowForwardIcon sx={{ fontSize: 18, mx: 0.25 }} />
                    <Box
                      sx={{
                        width: 18,
                        height: 2,
                        bgcolor: 'divider',
                        borderRadius: 1,
                      }}
                    />
                  </Box>
                ) : null}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}

function PipelineStage({ stage, defaultExpanded }: { stage: OrchestrationStageRun; defaultExpanded: boolean }) {
  const duration = stageDurationSeconds(stage);
  const outputs = stage.Outputs ?? {};
  const hasRunId = typeof stage.RunID === 'number' && stage.RunID > 0;
  const repoRef = resolveRunRepo(stage.RunURL, stage.Stage.Repo);
  const hasDetail =
    Object.keys(outputs).length > 0 ||
    Boolean(stage.TestReport) ||
    Boolean(stage.MatrixRuns?.length) ||
    Boolean(stage.Stage.Items?.length) ||
    Boolean(stage.Error) ||
    Boolean(stage.Stage.URL) ||
    !isZeroTime(stage.StartTime) ||
    hasRunId;
  const initiallyExpanded = defaultExpanded && hasDetail;
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [shouldLoad, setShouldLoad] = useState(initiallyExpanded);

  return (
    <Accordion
      id={stageDomId(stage.Stage.ID)}
      disableGutters
      elevation={0}
      expanded={expanded}
      onChange={(_, next) => {
        setExpanded(next);
        if (next) setShouldLoad(true);
      }}
      sx={{ scrollMarginTop: 72 }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack spacing={0.75} sx={{ width: '100%', pr: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            {stageStateChip(stage.State)}
            {stage.Stage.Advisory ? <Chip size="small" label="advisory" variant="outlined" /> : null}
            {stage.Env ? <Chip size="small" label={stage.Env} variant="outlined" /> : null}
            {stage.Stage.Group ? (
              <Chip size="small" label={stage.Stage.Group} variant="outlined" />
            ) : null}
            <Typography fontWeight={600} sx={{ flex: 1 }}>
              {stage.Stage.Name}
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
              {formatDurationSeconds(duration)}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Typography variant="caption" color="text.secondary">
              {stage.Stage.ID}
              {stage.Stage.Workflow ? ` · ${stage.Stage.Workflow}` : ''}
              {stage.Stage.Repo ? ` · ${stage.Stage.Repo}` : ''}
            </Typography>
            {stage.StatusText ? (
              <Typography variant="caption" color="text.secondary">
                {stage.StatusText}
              </Typography>
            ) : null}
            {stage.RunURL ? (
              <Link
                href={stage.RunURL}
                target="_blank"
                rel="noreferrer"
                variant="caption"
                underline="hover"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                onClick={(e) => e.stopPropagation()}
              >
                GitHub run <OpenInNewIcon sx={{ fontSize: 12 }} />
              </Link>
            ) : null}
          </Stack>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        {!hasDetail ? (
          <Typography variant="body2" color="text.secondary">
            No additional detail for this stage.
          </Typography>
        ) : (
          <>
            {!isZeroTime(stage.StartTime) ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {formatDate(stage.StartTime)}
                {!isZeroTime(stage.EndTime) ? ` → ${formatDate(stage.EndTime)}` : ''}
              </Typography>
            ) : null}
            {stage.Error ? (
              <Typography variant="body2" color="error.main" sx={{ mb: 1 }}>
                {stage.Error}
              </Typography>
            ) : null}
            {stage.Stage.URL ? (
              <Link href={stage.Stage.URL} target="_blank" rel="noreferrer" variant="body2">
                {stage.Stage.URL}
              </Link>
            ) : null}
            <StageOutputs outputs={outputs} />
            <StageChecklist stage={stage} />
            <StageMatrixRuns stage={stage} />
            <StageTestReport stage={stage} />
            {shouldLoad && hasRunId ? (
              <LazyWorkflowRunDetails
                runId={stage.RunID}
                owner={repoRef?.owner}
                repo={repoRef?.repo}
                runUrl={stage.RunURL}
              />
            ) : null}
          </>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export function OrchestrationPipeline({
  orchestration,
  artifact,
}: {
  orchestration: WorkflowOrchestrationState;
  artifact: { id: number; name: string } | null;
}) {
  const stages = orchestration.pipeline.stages;
  const environments = [
    ...new Set(stages.map((s) => s.Env?.trim()).filter((env): env is string => Boolean(env))),
  ].sort((a, b) => a.localeCompare(b));
  const [envFilter, setEnvFilter] = useState<string | null>(null);
  const activeEnvFilter = envFilter && environments.includes(envFilter) ? envFilter : null;
  const filteredStages = activeEnvFilter
    ? stages.filter((s) => s.Env?.trim() === activeEnvFilter)
    : stages;
  const failedOrWaiting = filteredStages.filter((s) => s.State === 4 || s.State === 1);
  const success = filteredStages.filter((s) => s.State === 3).length;
  const failure = filteredStages.filter((s) => s.State === 4).length;
  const waiting = filteredStages.filter((s) => s.State === 1).length;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h6">Orchestration pipeline</Typography>
        <Chip size="small" label={`${filteredStages.length} stages`} variant="outlined" />
        <Chip size="small" label={`${success} ok`} color="success" variant="outlined" />
        {failure > 0 ? <Chip size="small" label={`${failure} failed`} color="error" /> : null}
        {waiting > 0 ? <Chip size="small" label={`${waiting} waiting`} color="warning" /> : null}
        {artifact ? (
          <Typography variant="caption" color="text.secondary">
            from artifact “{artifact.name}”
          </Typography>
        ) : null}
      </Stack>

      {(orchestration.branch || orchestration.commit || orchestration.operator) && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {orchestration.branch ? <Chip size="small" label={`branch ${orchestration.branch}`} /> : null}
          {orchestration.commit ? (
            <Chip
              size="small"
              label={`commit ${orchestration.commit.slice(0, 7)}`}
              sx={{ fontFamily: '"IBM Plex Mono", monospace' }}
            />
          ) : null}
          {orchestration.operator ? (
            <Chip size="small" label={`operator ${orchestration.operator}`} variant="outlined" />
          ) : null}
          {orchestration.release_notes_url ? (
            <Link href={orchestration.release_notes_url} target="_blank" rel="noreferrer" variant="body2">
              Release notes
            </Link>
          ) : null}
        </Stack>
      )}

      {environments.length > 0 ? (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
            Environment
          </Typography>
          <Chip
            size="small"
            label="All"
            clickable
            color={activeEnvFilter === null ? 'primary' : 'default'}
            variant={activeEnvFilter === null ? 'filled' : 'outlined'}
            onClick={() => setEnvFilter(null)}
            aria-pressed={activeEnvFilter === null}
          />
          {environments.map((env) => {
            const selected = activeEnvFilter === env;
            return (
              <Chip
                key={env}
                size="small"
                label={env}
                clickable
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                onClick={() => setEnvFilter(selected ? null : env)}
                aria-pressed={selected}
              />
            );
          })}
        </Stack>
      ) : null}

      {filteredStages.length > 0 ? <StageFlowDiagram stages={filteredStages} /> : null}

      <Paper sx={{ p: 1 }}>
        {filteredStages.map((stage) => (
          <PipelineStage
            key={stage.Stage.ID}
            stage={stage}
            defaultExpanded={failedOrWaiting.some((s) => s.Stage.ID === stage.Stage.ID)}
          />
        ))}
        {stages.length === 0 ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            No stages in state.json.
          </Typography>
        ) : filteredStages.length === 0 ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            No stages for environment “{activeEnvFilter}”.
          </Typography>
        ) : null}
      </Paper>
    </Stack>
  );
}
