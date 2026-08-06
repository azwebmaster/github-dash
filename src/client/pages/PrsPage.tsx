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
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import { formatDurationHours } from '../../shared/utils';

export default function PrsPage() {
  const { data, error, loading } = useAsyncData(() => api.prs(), []);

  if (loading) return <LoadingBlock rows={8} />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} />;

  const { items, stats } = data;

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Pull requests"
        subtitle="Timing, merge rates, and drill-down into each PR"
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Total loaded" value={stats.total} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Open" value={stats.open} hint={`${stats.draft} drafts`} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Avg time to merge"
            value={formatDurationHours(stats.mergeTiming.avgHours)}
            hint={`median ${formatDurationHours(stats.mergeTiming.medianHours)} · p90 ${formatDurationHours(stats.mergeTiming.p90Hours)}`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Merged"
            value={stats.merged}
            hint={`${stats.closed} closed without merge`}
          />
        </Grid>
      </Grid>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>PR</TableCell>
              <TableCell>Author</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Time to merge</TableCell>
              <TableCell align="right">Δ</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((pr) => (
              <TableRow key={pr.number} hover>
                <TableCell>
                  <Link component={RouterLink} to={`/prs/${pr.number}`} underline="hover" fontWeight={600}>
                    #{pr.number} {pr.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                    {pr.author ?? '—'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5}>
                    {pr.merged ? (
                      <Chip size="small" label="merged" color="secondary" />
                    ) : pr.state === 'open' ? (
                      <Chip size="small" label={pr.draft ? 'draft' : 'open'} color="success" variant="outlined" />
                    ) : (
                      <Chip size="small" label="closed" variant="outlined" />
                    )}
                  </Stack>
                </TableCell>
                <TableCell>{formatDate(pr.createdAt)}</TableCell>
                <TableCell sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                  {formatDurationHours(pr.timeToMergeHours)}
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: '"IBM Plex Mono", monospace', whiteSpace: 'nowrap' }}>
                  <Typography component="span" color="success.main" variant="body2">
                    +{pr.additions}
                  </Typography>{' '}
                  <Typography component="span" color="error.main" variant="body2">
                    −{pr.deletions}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
