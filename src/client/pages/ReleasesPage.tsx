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
  Grid,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import { formatDurationHours } from '../../shared/utils';

export default function ReleasesPage() {
  const { data, error, loading } = useAsyncData(() => api.releases(), []);

  if (loading) return <LoadingBlock rows={8} />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} />;

  const { items, stats } = data;

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Releases"
        subtitle="Cadence timing and PRs parsed from release notes"
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

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Release</TableCell>
              <TableCell>Published</TableCell>
              <TableCell>Since previous</TableCell>
              <TableCell>PRs in notes</TableCell>
              <TableCell>Flags</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((rel) => (
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
                  <Stack direction="row" spacing={0.5}>
                    {rel.draft ? <Chip size="small" label="draft" /> : null}
                    {rel.prerelease ? <Chip size="small" label="pre" color="warning" variant="outlined" /> : null}
                    {!rel.draft && !rel.prerelease ? <Chip size="small" label="stable" color="success" variant="outlined" /> : null}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
