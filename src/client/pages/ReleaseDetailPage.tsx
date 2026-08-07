import {
  Button,
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
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { MarkdownContent } from '../components/MarkdownContent';
import { ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import { formatDurationHours, formatDurationSeconds } from '../../shared/utils';

function conclusionColor(conclusion: string | null | undefined): 'success' | 'error' | 'warning' | 'default' {
  if (conclusion === 'success') return 'success';
  if (conclusion === 'failure') return 'error';
  if (conclusion === 'cancelled') return 'warning';
  return 'default';
}

export default function ReleaseDetailPage() {
  const { id } = useParams();
  const releaseId = Number(id);
  const { data, error, loading } = useAsyncData(() => api.release(releaseId), [releaseId]);
  const { data: meta } = useAsyncData(() => api.meta(), []);

  if (loading) return <LoadingBlock />;
  if (error || !data) return <ErrorState message={error ?? 'Release not found'} />;

  const creatingRun = data.creatingRun;
  const workflowFile = meta?.releaseWorkflowFile ?? 'release.yml';

  return (
    <Stack spacing={3}>
      <Button component={RouterLink} to="/releases" startIcon={<ArrowBackIcon />} sx={{ alignSelf: 'flex-start' }}>
        All releases
      </Button>

      <PageHeader
        title={data.name}
        subtitle={data.tagName}
        action={
          <Button href={data.htmlUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />} variant="outlined">
            GitHub
          </Button>
        }
      />

      <Stack direction="row" spacing={1}>
        {data.draft ? <Chip label="draft" /> : null}
        {data.prerelease ? <Chip label="prerelease" color="warning" /> : null}
        {!data.draft && !data.prerelease ? <Chip label="stable" color="success" variant="outlined" /> : null}
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Published" value={formatDate(data.publishedAt ?? data.createdAt)} hint={data.author ?? undefined} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Since previous" value={formatDurationHours(data.timeSincePreviousHours)} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="PRs in notes" value={data.associatedPrCount} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Assets" value={data.assets.length} />
        </Grid>
      </Grid>

      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6" gutterBottom>
          Creating workflow run
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Matched from <code>{workflowFile}</code> by release commit SHA or tag
        </Typography>
        {creatingRun ? (
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 3 }}>
              <StatTile
                label="Run"
                value={
                  <Link component={RouterLink} to={`/workflows/${creatingRun.id}`} underline="hover">
                    #{creatingRun.id}
                  </Link>
                }
                hint={creatingRun.event}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <StatTile
                label="Result"
                value={
                  <Chip
                    size="small"
                    label={creatingRun.conclusion ?? creatingRun.status ?? '—'}
                    color={conclusionColor(creatingRun.conclusion)}
                    variant="outlined"
                  />
                }
                hint={`attempt ${creatingRun.attempt}`}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <StatTile label="Duration" value={formatDurationSeconds(creatingRun.durationSeconds)} />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <StatTile
                label="Started"
                value={formatDate(creatingRun.createdAt)}
                hint={
                  <Link href={creatingRun.htmlUrl} target="_blank" rel="noreferrer" underline="hover">
                    Open on GitHub ↗
                  </Link>
                }
              />
            </Grid>
          </Grid>
        ) : (
          <Typography color="text.secondary">
            No matching run found for tag <code>{data.tagName}</code> in <code>{workflowFile}</code>.
          </Typography>
        )}
      </Paper>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h6" gutterBottom>
              Release notes
            </Typography>
            <MarkdownContent content={data.body} empty="No release notes." maxHeight={480} />
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h6" gutterBottom>
              Associated pull requests
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Parsed from release notes (#123, PR links, etc.)
            </Typography>
            {data.associatedPrs.length === 0 ? (
              <Typography color="text.secondary">No PR references found in the notes.</Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>PR</TableCell>
                      <TableCell>Author</TableCell>
                      <TableCell>Merged</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.associatedPrs.map((pr) => (
                      <TableRow key={pr.number} hover>
                        <TableCell>
                          {pr.title ? (
                            <Link component={RouterLink} to={`/prs/${pr.number}`} underline="hover" fontWeight={600}>
                              #{pr.number} {pr.title}
                            </Link>
                          ) : (
                            <Typography variant="body2">#{pr.number}</Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>{pr.author ?? '—'}</TableCell>
                        <TableCell>{formatDate(pr.mergedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>
      </Grid>

      {data.assets.length > 0 ? (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Asset</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Size</TableCell>
                <TableCell align="right">Downloads</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.assets.map((a) => (
                <TableRow key={a.name}>
                  <TableCell sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>{a.name}</TableCell>
                  <TableCell>{a.contentType}</TableCell>
                  <TableCell align="right">{(a.size / 1024).toFixed(1)} KB</TableCell>
                  <TableCell align="right">{a.downloadCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
    </Stack>
  );
}
