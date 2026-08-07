import { useState } from 'react';
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
import { LineChart } from '@mui/x-charts/LineChart';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { AgeFilter, ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import {
  DEFAULT_AGE_LOOKBACK_DAYS,
  formatDurationHours,
  formatDurationSeconds,
  type AgeLookbackDays,
} from '../../shared/utils';
import type { ReleaseSummary } from '../../shared/types';

function SincePreviousChart({ releases }: { releases: ReleaseSummary[] }) {
  const points = releases
    .map((rel) => ({
      tagName: rel.tagName,
      name: rel.name,
      at: new Date(rel.publishedAt ?? rel.createdAt),
      hours:
        rel.timeSincePreviousHours != null && Number.isFinite(rel.timeSincePreviousHours)
          ? rel.timeSincePreviousHours
          : null,
      prCount: rel.associatedPrCount,
    }))
    .filter((p) => !Number.isNaN(p.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const cadenceCount = points.filter((p) => p.hours != null).length;

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Since previous
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {points.length
          ? `${points.length} release${points.length === 1 ? '' : 's'} · ${cadenceCount} with cadence data`
          : 'No releases in this window.'}
      </Typography>
      {points.length ? (
        <LineChart
          height={280}
          series={[
            {
              id: 'hours',
              data: points.map((p) => p.hours),
              label: 'Since previous',
              color: '#0F4C5C',
              showMark: true,
              yAxisId: 'hours',
              valueFormatter: (value, { dataIndex }) => {
                const point = points[dataIndex];
                const label = formatDurationHours(value);
                if (!point) return label;
                return `${label} · ${point.tagName}`;
              },
            },
            {
              id: 'prs',
              data: points.map((p) => p.prCount),
              label: 'PRs in notes',
              color: '#C45C26',
              showMark: true,
              yAxisId: 'prs',
              valueFormatter: (value, { dataIndex }) => {
                const point = points[dataIndex];
                const label = value == null ? '—' : String(value);
                if (!point) return label;
                return `${label} PRs · ${point.tagName}`;
              },
            },
          ]}
          xAxis={[
            {
              data: points.map((p) => p.at),
              scaleType: 'time',
              valueFormatter: (value) => {
                const date = value instanceof Date ? value : new Date(value as string | number);
                if (Number.isNaN(date.getTime())) return '';
                return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              },
            },
          ]}
          yAxis={[
            {
              id: 'hours',
              valueFormatter: (value: number | null) => formatDurationHours(value),
              width: 56,
            },
            {
              id: 'prs',
              position: 'right',
              valueFormatter: (value: number | null) => (value == null ? '—' : String(Math.round(value))),
              width: 40,
            },
          ]}
          margin={{ left: 10, right: 10, top: 20, bottom: 40 }}
        />
      ) : null}
    </Paper>
  );
}

function conclusionColor(conclusion: string | null | undefined): 'success' | 'error' | 'warning' | 'default' {
  if (conclusion === 'success') return 'success';
  if (conclusion === 'failure') return 'error';
  if (conclusion === 'cancelled') return 'warning';
  return 'default';
}

export default function ReleasesPage() {
  const [ageFilter, setAgeFilter] = useState<AgeLookbackDays>(DEFAULT_AGE_LOOKBACK_DAYS);
  const { data, error, loading } = useAsyncData(() => api.releases(ageFilter), [ageFilter]);
  const {
    data: orchHealth,
    error: orchError,
    loading: orchLoading,
  } = useAsyncData(() => api.orchestrationHealth(), []);

  if (loading) return <LoadingBlock rows={8} />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} />;

  const { items, stats } = data;
  const failingStages = orchHealth?.stageStats.filter((s) => s.failureRate > 0).slice(0, 8) ?? [];

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Releases"
        subtitle={`Cadence timing, PRs from notes, and ${stats.creatingWorkflowFile} creating-run stats`}
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Total" value={stats.total} hint={`${stats.published} published · ${stats.prereleases} pre`} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Avg cadence"
            value={formatDurationHours(stats.releaseCadence.avgHours)}
            hint={`median ${formatDurationHours(stats.releaseCadence.medianHours)}`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="PRs in notes" value={stats.associatedPrTotal} hint={`avg ${stats.avgPrsPerRelease} / release`} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Longest gap"
            value={formatDurationHours(stats.releaseCadence.maxHours)}
            hint={`shortest ${formatDurationHours(stats.releaseCadence.minHours)}`}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Creating runs"
            value={`${stats.creatingRunsMatched}/${stats.total}`}
            hint={`matched via ${stats.creatingWorkflowFile}`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Release workflow success"
            value={stats.creatingRunsMatched ? `${stats.creatingRunSuccessRate}%` : '—'}
            hint={`${stats.creatingRunSuccess} ok · ${stats.creatingRunFailure} fail · ${stats.creatingRunsMissing} unmatched`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Avg creating-run duration"
            value={formatDurationSeconds((stats.creatingRunDuration.avgHours ?? 0) * 3600 || null)}
            hint={`median ${formatDurationSeconds((stats.creatingRunDuration.medianHours ?? 0) * 3600 || null)}`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Slowest creating run"
            value={formatDurationSeconds((stats.creatingRunDuration.maxHours ?? 0) * 3600 || null)}
            hint={`fastest ${formatDurationSeconds((stats.creatingRunDuration.minHours ?? 0) * 3600 || null)}`}
          />
        </Grid>
      </Grid>

      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6" gutterBottom>
          Release-train / orchestration health
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Sampled from recent {stats.creatingWorkflowFile} runs (cached). Stage failure rates use state.json when present.
        </Typography>
        {orchLoading && !orchHealth ? (
          <Typography variant="body2" color="text.secondary">
            Loading orchestration sample…
          </Typography>
        ) : orchError ? (
          <Typography variant="body2" color="error">
            {orchError}
          </Typography>
        ) : orchHealth && orchHealth.runsWithState > 0 ? (
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <StatTile
                label="Runs with state"
                value={`${orchHealth.runsWithState}/${orchHealth.sampleSize}`}
                hint="in sample"
              />
              {orchHealth.topFailingSuites.length > 0 ? (
                <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                  <Typography variant="overline" color="text.secondary">
                    Top failing suites
                  </Typography>
                  {orchHealth.topFailingSuites.slice(0, 5).map((s) => (
                    <Typography key={s.name} variant="body2">
                      {s.name}: {s.failures} fail
                    </Typography>
                  ))}
                </Stack>
              ) : null}
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography variant="overline" color="text.secondary">
                Stages with failures
              </Typography>
              {failingStages.length ? (
                <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                  {failingStages.map((s) => (
                    <Stack key={s.stageId} direction="row" spacing={1} alignItems="center">
                      <Chip
                        size="small"
                        color={s.failureRate >= 50 ? 'error' : 'warning'}
                        label={`${s.failureRate}%`}
                      />
                      <Typography variant="body2" noWrap>
                        {s.name}
                        {s.group ? ` · ${s.group}` : ''}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  No stage failures in the sample.
                </Typography>
              )}
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography variant="overline" color="text.secondary">
                Recent orchestrated runs
              </Typography>
              <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                {orchHealth.recentRuns.slice(0, 6).map((r) => (
                  <Stack key={r.runId} spacing={0.25}>
                    <Link
                      component={RouterLink}
                      to={`/workflows/runs/${r.runId}`}
                      underline="hover"
                      fontWeight={600}
                      variant="body2"
                    >
                      #{r.runId}
                    </Link>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(r.createdAt)}
                      {r.failedStages.length
                        ? ` · failed: ${r.failedStages.slice(0, 3).join(', ')}`
                        : ' · no failed stages'}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Grid>
          </Grid>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No orchestration state.json found in recent {stats.creatingWorkflowFile} runs.
          </Typography>
        )}
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
          <AgeFilter value={ageFilter} onChange={setAgeFilter} />
          <Typography variant="body2" color="text.secondary">
            Showing {items.length} release{items.length === 1 ? '' : 's'}
          </Typography>
        </Stack>
      </Paper>

      <SincePreviousChart releases={items} />

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Release</TableCell>
              <TableCell>Published</TableCell>
              <TableCell>Since previous</TableCell>
              <TableCell>PRs in notes</TableCell>
              <TableCell>Creating run</TableCell>
              <TableCell>Flags</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    No releases match the current age filter.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              items.map((rel) => (
                <TableRow key={rel.id} hover>
                  <TableCell>
                    <Link component={RouterLink} to={`/releases/${rel.id}`} underline="hover" fontWeight={600}>
                      {rel.name}
                    </Link>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, opacity: 0.7 }}>{rel.tagName}</div>
                  </TableCell>
                  <TableCell>{formatDate(rel.publishedAt ?? rel.createdAt)}</TableCell>
                  <TableCell sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                    {formatDurationHours(rel.timeSincePreviousHours)}
                  </TableCell>
                  <TableCell>
                    <Link component={RouterLink} to={`/releases/${rel.id}`}>
                      {rel.associatedPrCount}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {rel.creatingRun ? (
                      <Stack spacing={0.5}>
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                          <Link component={RouterLink} to={`/workflows/${rel.creatingRun.id}`} underline="hover" fontWeight={600}>
                            #{rel.creatingRun.id}
                          </Link>
                          <Chip
                            size="small"
                            label={rel.creatingRun.conclusion ?? rel.creatingRun.status ?? '—'}
                            color={conclusionColor(rel.creatingRun.conclusion)}
                            variant="outlined"
                          />
                        </Stack>
                        <Typography variant="caption" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                          {formatDurationSeconds(rel.creatingRun.durationSeconds)}
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      {rel.draft ? <Chip size="small" label="draft" /> : null}
                      {rel.prerelease ? <Chip size="small" label="pre" color="warning" variant="outlined" /> : null}
                      {!rel.draft && !rel.prerelease ? <Chip size="small" label="stable" color="success" variant="outlined" /> : null}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
