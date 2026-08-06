import {
  Chip,
  Link,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
  Grid,
  Button,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import { formatDurationHours } from '../../shared/utils';

export default function PrDetailPage() {
  const { number } = useParams();
  const prNumber = Number(number);
  const { data, error, loading } = useAsyncData(() => api.pr(prNumber), [prNumber]);

  if (loading) return <LoadingBlock />;
  if (error || !data) return <ErrorState message={error ?? 'PR not found'} />;

  return (
    <Stack spacing={3}>
      <Button
        component={RouterLink}
        to="/prs"
        startIcon={<ArrowBackIcon />}
        sx={{ alignSelf: 'flex-start' }}
      >
        All PRs
      </Button>

      <PageHeader
        title={`#${data.number} ${data.title}`}
        subtitle={`${data.base} ← ${data.head}`}
        action={
          <Button
            href={data.htmlUrl}
            target="_blank"
            rel="noreferrer"
            endIcon={<OpenInNewIcon />}
            variant="outlined"
          >
            GitHub
          </Button>
        }
      />

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {data.merged ? <Chip label="merged" color="secondary" /> : <Chip label={data.state} />}
        {data.draft ? <Chip label="draft" variant="outlined" /> : null}
        {data.labels.map((l) => (
          <Chip key={l} label={l} size="small" variant="outlined" />
        ))}
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Author" value={data.author ?? '—'} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Time to merge"
            value={formatDurationHours(data.timeToMergeHours)}
            hint={`created ${formatDate(data.createdAt)}`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Diff"
            value={`+${data.additions} / −${data.deletions}`}
            hint={`${data.changedFiles} files · ${data.commits} commits`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Merged at"
            value={formatDate(data.mergedAt)}
            hint={data.closedAt && !data.merged ? `closed ${formatDate(data.closedAt)}` : undefined}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h6" gutterBottom>
              Description
            </Typography>
            <Typography
              component="pre"
              variant="body2"
              sx={{
                whiteSpace: 'pre-wrap',
                fontFamily: '"IBM Plex Sans", sans-serif',
                m: 0,
                color: data.body ? 'text.primary' : 'text.secondary',
              }}
            >
              {data.body || 'No description.'}
            </Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper sx={{ p: 2.5, mb: 2 }}>
            <Typography variant="h6" gutterBottom>
              Reviewers
            </Typography>
            {data.reviewers.length || data.requestedReviewers.length ? (
              <Typography variant="body2">
                {[...new Set([...data.reviewers, ...data.requestedReviewers])].join(', ')}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No reviewers recorded.
              </Typography>
            )}
          </Paper>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h6" gutterBottom>
              Timeline
            </Typography>
            <List dense disablePadding>
              {data.timeline.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No timeline events.
                </Typography>
              ) : (
                data.timeline.map((ev, i) => (
                  <ListItem key={`${ev.event}-${ev.createdAt}-${i}`} disableGutters>
                    <ListItemText
                      primary={
                        <Typography variant="body2">
                          <strong>{ev.event}</strong>
                          {ev.actor ? ` · ${ev.actor}` : ''}
                        </Typography>
                      }
                      secondary={formatDate(ev.createdAt)}
                    />
                  </ListItem>
                ))
              )}
            </List>
          </Paper>
        </Grid>
      </Grid>

      <Typography variant="body2" color="text.secondary">
        Comments: {data.comments} ·{' '}
        <Link href={data.htmlUrl} target="_blank" rel="noreferrer">
          open on GitHub
        </Link>
      </Typography>
    </Stack>
  );
}
