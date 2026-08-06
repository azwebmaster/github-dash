import { Grid, Link, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { BarChart } from '@mui/x-charts/BarChart';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import { formatDurationHours, formatDurationSeconds } from '../../shared/utils';

export default function OverviewPage() {
  const { data, error, loading } = useAsyncData(() => api.overview(), []);

  if (loading) return <LoadingBlock rows={6} />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} />;

  const { repo, prs, commits, releases, workflows } = data;

  return (
    <Stack spacing={3}>
      <PageHeader
        title={repo.fullName}
        subtitle={repo.description ?? 'Repository overview — PRs, commits, releases, and Actions'}
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
              {prs.open} open · {prs.merged} merged · avg merge {formatDurationHours(prs.mergeTiming.avgHours)}
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
              cadence {formatDurationHours(releases.releaseCadence.avgHours)} · {releases.associatedPrTotal} PRs in notes
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
              success · avg run {formatDurationSeconds((workflows.duration.avgHours ?? 0) * 3600 || null)} · {workflows.totalRuns} runs
            </Typography>
            <Link component={RouterLink} to="/workflows" sx={{ mt: 1.5, display: 'inline-block' }}>
              View workflows →
            </Link>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
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
              <Typography color="text.secondary">No commit activity loaded.</Typography>
            )}
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Workflow conclusions
            </Typography>
            {workflows.recentConclusions.length ? (
              <BarChart
                height={260}
                series={[
                  { data: workflows.recentConclusions.map((d) => d.success), label: 'Success', color: '#0F7B4B', stack: 't' },
                  { data: workflows.recentConclusions.map((d) => d.failure), label: 'Failure', color: '#C62828', stack: 't' },
                  { data: workflows.recentConclusions.map((d) => d.other), label: 'Other', color: '#3D5560', stack: 't' },
                ]}
                xAxis={[
                  {
                    data: workflows.recentConclusions.map((d) => d.date.slice(5)),
                    scaleType: 'band',
                  },
                ]}
                margin={{ left: 40, right: 10, top: 20, bottom: 40 }}
              />
            ) : (
              <Typography color="text.secondary">No workflow runs loaded.</Typography>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Stack>
  );
}
