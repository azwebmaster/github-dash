import { useState } from 'react';
import {
  Autocomplete,
  Chip,
  Link,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
  Grid,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { AgeFilter, ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';
import {
  DEFAULT_AGE_LOOKBACK_DAYS,
  formatDurationHours,
  type AgeLookbackDays,
} from '../../shared/utils';
import type { PrSummary } from '../../shared/types';

type StatusFilter = 'all' | 'open' | 'draft' | 'merged' | 'closed';
type SortKey = 'number' | 'author' | 'status' | 'createdAt' | 'ageHours' | 'delta';
type SortDir = 'asc' | 'desc';

function statusRank(pr: PrSummary): number {
  if (pr.merged) return 3;
  if (pr.state === 'closed') return 4;
  if (pr.draft) return 1;
  return 2;
}

function statusLabel(pr: PrSummary): string {
  if (pr.merged) return 'merged';
  if (pr.state === 'closed') return 'closed';
  return pr.draft ? 'draft' : 'open';
}

function matchesStatus(pr: PrSummary, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'merged') return pr.merged;
  if (filter === 'draft') return pr.state === 'open' && pr.draft;
  if (filter === 'open') return pr.state === 'open' && !pr.draft;
  return pr.state === 'closed' && !pr.merged;
}

function comparePrs(a: PrSummary, b: PrSummary, key: SortKey, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1;
  let cmp = 0;
  switch (key) {
    case 'number':
      cmp = a.number - b.number;
      break;
    case 'author':
      cmp = (a.author ?? '').localeCompare(b.author ?? '', undefined, { sensitivity: 'base' });
      break;
    case 'status':
      cmp = statusRank(a) - statusRank(b);
      break;
    case 'createdAt':
      cmp = a.createdAt.localeCompare(b.createdAt);
      break;
    case 'ageHours': {
      const ah = a.ageHours;
      const bh = b.ageHours;
      if (ah == null && bh == null) cmp = 0;
      else if (ah == null) cmp = 1;
      else if (bh == null) cmp = -1;
      else cmp = ah - bh;
      break;
    }
    case 'delta':
      cmp = a.additions + a.deletions - (b.additions + b.deletions);
      break;
  }
  if (cmp === 0) cmp = b.number - a.number;
  return cmp * mul;
}

export default function PrsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [ageFilter, setAgeFilter] = useState<AgeLookbackDays>(DEFAULT_AGE_LOOKBACK_DAYS);
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const { data, error, loading } = useAsyncData(() => api.prs(ageFilter), [ageFilter]);

  if (loading) return <LoadingBlock rows={8} />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} />;

  const { items, stats } = data;

  const allLabels = [...new Set(items.flatMap((pr) => pr.labels))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );

  const q = search.trim().toLowerCase();
  const filteredItems = items
    .filter((pr) => {
      if (!matchesStatus(pr, statusFilter)) return false;
      if (labelFilter.length > 0 && !labelFilter.every((l) => pr.labels.includes(l))) return false;
      if (!q) return true;
      return (
        String(pr.number).includes(q) ||
        pr.title.toLowerCase().includes(q) ||
        (pr.author?.toLowerCase().includes(q) ?? false) ||
        pr.labels.some((l) => l.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => comparePrs(a, b, sortKey, sortDir));

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'author' || key === 'status' ? 'asc' : 'desc');
  };

  const toggleLabelFilter = (label: string) => {
    setLabelFilter((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  };

  const filtersActive =
    search.trim() !== '' || statusFilter !== 'all' || labelFilter.length > 0;

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Pull requests"
        subtitle="Timing, merge rates, and drill-down into each PR"
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 4, lg: 2 }}>
          <StatTile label="Total loaded" value={stats.total} />
        </Grid>
        <Grid size={{ xs: 6, md: 4, lg: 2 }}>
          <StatTile label="Open" value={stats.open} hint={`${stats.draft} drafts`} />
        </Grid>
        <Grid size={{ xs: 6, md: 4, lg: 2 }}>
          <StatTile
            label="Avg time to merge"
            value={formatDurationHours(stats.mergeTiming.avgHours)}
            hint={`median ${formatDurationHours(stats.mergeTiming.medianHours)} · p90 ${formatDurationHours(stats.mergeTiming.p90Hours)}`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 4, lg: 2 }}>
          <StatTile
            label="Avg age"
            value={formatDurationHours(stats.ageTiming.avgHours)}
            hint={`median ${formatDurationHours(stats.ageTiming.medianHours)} · p90 ${formatDurationHours(stats.ageTiming.p90Hours)}`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 4, lg: 2 }}>
          <StatTile
            label="Merged"
            value={stats.merged}
            hint={`${stats.closed} closed without merge`}
          />
        </Grid>
      </Grid>

      <Paper sx={{ p: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'flex-start' } }}
        >
          <TextField
            size="small"
            label="Search"
            placeholder="Title, author, #, label…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: { md: 220 }, flex: 1 }}
          />
          <TextField
            select
            size="small"
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            sx={{ minWidth: { md: 140 } }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="open">Open</MenuItem>
            <MenuItem value="draft">Draft</MenuItem>
            <MenuItem value="merged">Merged</MenuItem>
            <MenuItem value="closed">Closed</MenuItem>
          </TextField>
          <AgeFilter value={ageFilter} onChange={setAgeFilter} />
          <Autocomplete
            multiple
            size="small"
            options={allLabels}
            value={labelFilter}
            onChange={(_, value) => setLabelFilter(value)}
            renderInput={(params) => <TextField {...params} label="Labels" placeholder="Filter…" />}
            renderValue={(value, getItemProps) =>
              value.map((option, index) => {
                const { key, ...itemProps } = getItemProps({ index });
                return <Chip key={key} size="small" label={option} variant="outlined" {...itemProps} />;
              })
            }
            sx={{ minWidth: { md: 260 }, flex: 1.2 }}
            disabled={allLabels.length === 0}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Showing {filteredItems.length} of {items.length}
          {filtersActive ? ' (filtered)' : ''}
        </Typography>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sortDirection={sortKey === 'number' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'number'}
                  direction={sortKey === 'number' ? sortDir : 'asc'}
                  onClick={() => handleSort('number')}
                >
                  PR
                </TableSortLabel>
              </TableCell>
              <TableCell sortDirection={sortKey === 'author' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'author'}
                  direction={sortKey === 'author' ? sortDir : 'asc'}
                  onClick={() => handleSort('author')}
                >
                  Author
                </TableSortLabel>
              </TableCell>
              <TableCell sortDirection={sortKey === 'status' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'status'}
                  direction={sortKey === 'status' ? sortDir : 'asc'}
                  onClick={() => handleSort('status')}
                >
                  Status
                </TableSortLabel>
              </TableCell>
              <TableCell>Labels</TableCell>
              <TableCell sortDirection={sortKey === 'createdAt' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'createdAt'}
                  direction={sortKey === 'createdAt' ? sortDir : 'asc'}
                  onClick={() => handleSort('createdAt')}
                >
                  Created
                </TableSortLabel>
              </TableCell>
              <TableCell sortDirection={sortKey === 'ageHours' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'ageHours'}
                  direction={sortKey === 'ageHours' ? sortDir : 'asc'}
                  onClick={() => handleSort('ageHours')}
                >
                  Age
                </TableSortLabel>
              </TableCell>
              <TableCell align="right" sortDirection={sortKey === 'delta' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'delta'}
                  direction={sortKey === 'delta' ? sortDir : 'asc'}
                  onClick={() => handleSort('delta')}
                >
                  Δ
                </TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    No pull requests match the current filters.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredItems.map((pr) => (
                <TableRow key={pr.number} hover>
                  <TableCell>
                    <Link
                      component={RouterLink}
                      to={`/prs/${pr.number}`}
                      underline="hover"
                      sx={{ fontWeight: 600 }}
                    >
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
                        <Chip
                          size="small"
                          label={statusLabel(pr)}
                          color="success"
                          variant="outlined"
                        />
                      ) : (
                        <Chip size="small" label="closed" variant="outlined" />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {pr.labels.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        —
                      </Typography>
                    ) : (
                      <Stack
                        direction="row"
                        spacing={0.5}
                        useFlexGap
                        sx={{ maxWidth: 280, flexWrap: 'wrap' }}
                      >
                        {pr.labels.map((label) => (
                          <Chip
                            key={label}
                            size="small"
                            label={label}
                            variant={labelFilter.includes(label) ? 'filled' : 'outlined'}
                            color={labelFilter.includes(label) ? 'primary' : 'default'}
                            onClick={() => toggleLabelFilter(label)}
                            sx={{ cursor: 'pointer' }}
                          />
                        ))}
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(pr.createdAt)}</TableCell>
                  <TableCell sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                    {formatDurationHours(pr.ageHours)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontFamily: '"IBM Plex Mono", monospace', whiteSpace: 'nowrap' }}
                  >
                    <Typography component="span" color="success.main" variant="body2">
                      +{pr.additions}
                    </Typography>{' '}
                    <Typography component="span" color="error.main" variant="body2">
                      −{pr.deletions}
                    </Typography>
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
