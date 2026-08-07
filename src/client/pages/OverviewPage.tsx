import { useState, type ReactNode } from 'react';
import { Chip, Grid, Link, List, ListItem, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { BarChart } from '@mui/x-charts/BarChart';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { usePinnedWorkflows } from '../hooks/usePinnedWorkflows';
import { WorkflowSummaryCard } from '../components/WorkflowSummaryCard';
import { AgeFilter, ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import {
  DEFAULT_AGE_LOOKBACK_DAYS,
  formatDurationHours,
  formatDurationSeconds,
  type AgeLookbackDays,
} from '../../shared/utils';
import type { OverviewInsights } from '../../shared/types';

function hasAttention(insights: OverviewInsights): boolean {
  return (
    insights.oldestOpenPrs.length > 0 ||
    insights.attentionWorkflows.length > 0 ||
    insights.slowestWorkflows.length > 0 ||
    insights.releaseGapHours != null ||
    (insights.orchestrationSummary != null && insights.orchestrationSummary.runsWithState > 0)
  );
}

export default function OverviewPage() {
  const [ageFilter, setAgeFilter] = useState<AgeLookbackDays>(DEFAULT_AGE_LOOKBACK_DAYS);
  const { data, error, loading } = useAsyncData(() => api.overview(ageFilter), [ageFilter]);
  const { pinnedIds, unpin } = usePinnedWorkflows();

  if (loading && !data) return <LoadingBlock rows={6} />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} />;

  const { repo, prs, commits, releases, workflows, insights } = data;
  const orch = insights.orchestrationSummary;
  const nameById = new Map(workflows.byWorkflow.map((w) => [w.workflowId, w.name]));

  return (
    <Stack spacing={3}>
      <PageHeader
        title={repo.fullName}
        subtitle={repo.description ?? 'Repository overview — PRs, commits, releases, and Actions'}
        action={<AgeFilter value={ageFilter} onChange={setAgeFilter} />}
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Stars" value={repo.stars.toLocaleString()} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Forks" value={repo.forks.toLocaleString()} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Open issues" value={repo.openIssues.toLocaleString()} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Last push" value={formatDate(repo.pushedAt)} hint={repo.language ?? undefined} />
        </Grid>
      </Grid>

      {hasAttention(insights) ? (
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="h6" gutterBottom>
            Needs attention
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6, lg: 3 }}>
              <Typography variant="overline" color="text.secondary">
                Oldest open PRs
              </Typography>
              {insights.oldestOpenPrs.length ? (
                <List dense disablePadding>
                  {insights.oldestOpenPrs.map((pr) => (
                    <ListItem key={pr.number} disableGutters sx={{ py: 0.25, display: 'block' }}>
                      <Link
                        component={RouterLink}
                        to={`/prs/${pr.number}`}
                        underline="hover"
                        fontWeight={600}
                        variant="body2"
                        sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        #{pr.number} {pr.title}
                      </Link>
                      <Typography variant="caption" color="text.secondary">
                        open {formatDurationHours(pr.ageHours)}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No open PRs in this window.
                </Typography>
              )}
            </Grid>

            <Grid size={{ xs: 12, md: 6, lg: 3 }}>
              <Typography variant="overline" color="text.secondary">
                Flaky / failing workflows
              </Typography>
              {insights.attentionWorkflows.length ? (
                <List dense disablePadding>
                  {insights.attentionWorkflows.map((w) => (
                    <ListItem key={w.workflowId} disableGutters sx={{ py: 0.25, display: 'block' }}>
                      <Link
                        component={RouterLink}
                        to={`/workflows/by/${w.workflowId}`}
                        underline="hover"
                        fontWeight={600}
                        variant="body2"
                        sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {w.name}
                      </Link>
                      <Typography variant="caption" color="text.secondary">
                        {w.consecutiveFailures > 0
                          ? `${w.successRate}% ok · ${w.consecutiveFailures} consecutive fail`
                          : `${w.successRate}% success`}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No workflows need attention.
                </Typography>
              )}
            </Grid>

            <Grid size={{ xs: 12, md: 6, lg: 3 }}>
              <Typography variant="overline" color="text.secondary">
                Slowest workflows
              </Typography>
              {insights.slowestWorkflows.length ? (
                <List dense disablePadding>
                  {insights.slowestWorkflows.map((w) => (
                    <ListItem key={w.workflowId} disableGutters sx={{ py: 0.25, display: 'block' }}>
                      <Link
                        component={RouterLink}
                        to={`/workflows/by/${w.workflowId}`}
                        underline="hover"
                        fontWeight={600}
                        variant="body2"
                        sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {w.name}
                      </Link>
                      <Typography variant="caption" color="text.secondary">
                        avg {formatDurationSeconds(w.avgDurationSeconds)}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Not enough duration data.
                </Typography>
              )}
            </Grid>

            <Grid size={{ xs: 12, md: 6, lg: 3 }}>
              <Typography variant="overline" color="text.secondary">
                Release & train
              </Typography>
              <Stack spacing={1} sx={{ mt: 0.5 }}>
                <Typography variant="body2">
                  Gap since last release:{' '}
                  <BoxMono>{formatDurationHours(insights.releaseGapHours)}</BoxMono>
                </Typography>
                {orch && orch.runsWithState > 0 ? (
                  <>
                    <Typography variant="body2" color="text.secondary">
                      Orchestration: {orch.runsWithState}/{orch.sampleSize} runs with state
                    </Typography>
                    {orch.stageStats.filter((s) => s.failureRate > 0).slice(0, 3).map((s) => (
                      <Chip
                        key={s.stageId}
                        size="small"
                        color={s.failureRate >= 50 ? 'error' : 'warning'}
                        label={`${s.name} ${s.failureRate}% fail`}
                        sx={{ alignSelf: 'flex-start' }}
                      />
                    ))}
                    <Link component={RouterLink} to="/releases" variant="body2">
                      View releases →
                    </Link>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No orchestration state in recent release workflow runs.
                  </Typography>
                )}
              </Stack>
            </Grid>
          </Grid>
        </Paper>
      ) : null}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Paper sx={{ p: 2.5, height: '100%' }}>
            <Typography variant="overline" color="text.secondary">
              Pull requests
            </Typography>
            <Typography variant="h3" sx={{ fontFamily: '"IBM Plex Mono", monospace', my: 1 }}>
              {prs.total}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {prs.open} open · {prs.merged} merged
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              merge avg {formatDurationHours(prs.mergeTiming.avgHours)}
              {prs.mergeTiming.medianHours != null
                ? ` · median ${formatDurationHours(prs.mergeTiming.medianHours)} · p90 ${formatDurationHours(prs.mergeTiming.p90Hours)}`
                : ''}
            </Typography>
            <Link component={RouterLink} to="/prs" sx={{ mt: 1.5, display: 'inline-block' }}>
              View PRs →
            </Link>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Paper sx={{ p: 2.5, height: '100%' }}>
            <Typography variant="overline" color="text.secondary">
              Commits
            </Typography>
            <Typography variant="h3" sx={{ fontFamily: '"IBM Plex Mono", monospace', my: 1 }}>
              {commits.total}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {commits.verified} verified · {commits.topAuthors[0]?.login ?? '—'} leads
            </Typography>
            <Link component={RouterLink} to="/commits" sx={{ mt: 1.5, display: 'inline-block' }}>
              View commits →
            </Link>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Paper sx={{ p: 2.5, height: '100%' }}>
            <Typography variant="overline" color="text.secondary">
              Releases
            </Typography>
            <Typography variant="h3" sx={{ fontFamily: '"IBM Plex Mono", monospace', my: 1 }}>
              {releases.total}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              cadence {formatDurationHours(releases.releaseCadence.avgHours)} · {releases.associatedPrTotal} PRs in
              notes
              {releases.creatingRunsMatched
                ? ` · ${releases.creatingRunSuccessRate}% ${releases.creatingWorkflowFile} success`
                : ''}
            </Typography>
            <Link component={RouterLink} to="/releases" sx={{ mt: 1.5, display: 'inline-block' }}>
              View releases →
            </Link>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Paper sx={{ p: 2.5, height: '100%' }}>
            <Typography variant="overline" color="text.secondary">
              Workflows
            </Typography>
            <Typography variant="h3" sx={{ fontFamily: '"IBM Plex Mono", monospace', my: 1 }}>
              {workflows.successRate}%
            </Typography>
            <Typography variant="body2" color="text.secondary">
              success · avg run {formatDurationSeconds((workflows.duration.avgHours ?? 0) * 3600 || null)} ·{' '}
              {workflows.totalRuns} runs
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              p90 {formatDurationSeconds((workflows.duration.p90Hours ?? 0) * 3600 || null)}
            </Typography>
            <Link component={RouterLink} to="/workflows" sx={{ mt: 1.5, display: 'inline-block' }}>
              View workflows →
            </Link>
          </Paper>
        </Grid>
      </Grid>

      {pinnedIds.length > 0 ? (
        <Stack spacing={1.5}>
          <Typography variant="h6">Pinned workflows</Typography>
          <Typography variant="body2" color="text.secondary">
            Pin from the Workflows page. Cards reuse the same cookie as that view.
          </Typography>
          <Grid container spacing={2}>
            {pinnedIds.map((id) => (
              <Grid key={id} size={{ xs: 12, sm: 6, lg: 4 }}>
                <WorkflowSummaryCard
                  workflowId={id}
                  fallbackName={nameById.get(id)}
                  onRemove={() => unpin(id)}
                />
              </Grid>
            ))}
          </Grid>
        </Stack>
      ) : null}

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Commits per day
        </Typography>
        {commits.commitsPerDay.length ? (
          <BarChart
            height={260}
            series={[{ data: commits.commitsPerDay.map((d) => d.count), label: 'Commits', color: '#0F4C5C' }]}
            xAxis={[
              {
                data: commits.commitsPerDay.map((d) => d.date.slice(5)),
                scaleType: 'band',
              },
            ]}
            margin={{ left: 40, right: 10, top: 20, bottom: 40 }}
          />
        ) : (
          <Typography color="text.secondary">No commit activity in this window.</Typography>
        )}
      </Paper>
    </Stack>
  );
}

function BoxMono({ children }: { children: ReactNode }) {
  return (
    <Typography component="span" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
      {children}
    </Typography>
  );
}
