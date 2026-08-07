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
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { AgeFilter, ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import {
  DEFAULT_AGE_LOOKBACK_DAYS,
  type AgeLookbackDays,
} from '../../shared/utils';

export default function CommitsPage() {
  const [ageFilter, setAgeFilter] = useState<AgeLookbackDays>(DEFAULT_AGE_LOOKBACK_DAYS);
  const { data, error, loading } = useAsyncData(() => api.commits(ageFilter), [ageFilter]);

  if (loading) return <LoadingBlock rows={8} />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} />;

  const { items, stats } = data;

  return (
    <Stack spacing={3}>
      <PageHeader title="Commits" subtitle="Recent commit history and author activity" />

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Loaded" value={stats.total} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Verified"
            value={stats.verified}
            hint={`${stats.total ? Math.round((stats.verified / stats.total) * 100) : 0}% signed`}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <StatTile
            label="Top authors"
            value={
              <Typography variant="body1" sx={{ fontFamily: '"IBM Plex Mono", monospace', mt: 0.5 }}>
                {stats.topAuthors
                  .slice(0, 4)
                  .map((a) => `${a.login} (${a.count})`)
                  .join(' · ') || '—'}
              </Typography>
            }
          />
        </Grid>
      </Grid>

      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
          <AgeFilter value={ageFilter} onChange={setAgeFilter} />
          <Typography variant="body2" color="text.secondary">
            Showing {items.length} commit{items.length === 1 ? '' : 's'}
          </Typography>
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>SHA</TableCell>
              <TableCell>Message</TableCell>
              <TableCell>Author</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Verified</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    No commits match the current age filter.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              items.map((c) => (
                <TableRow key={c.sha} hover>
                  <TableCell>
                    <Link
                      component={RouterLink}
                      to={`/commits/${c.sha}`}
                      underline="hover"
                      sx={{ fontFamily: '"IBM Plex Mono", monospace' }}
                    >
                      {c.shortSha}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link component={RouterLink} to={`/commits/${c.sha}`} underline="hover" color="inherit">
                      {c.message}
                    </Link>
                  </TableCell>
                  <TableCell sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                    {c.authorLogin ?? c.authorName ?? '—'}
                  </TableCell>
                  <TableCell>{formatDate(c.authorDate)}</TableCell>
                  <TableCell>
                    {c.verified ? (
                      <Chip size="small" label="verified" color="success" variant="outlined" />
                    ) : (
                      <Chip size="small" label="unsigned" variant="outlined" />
                    )}
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
