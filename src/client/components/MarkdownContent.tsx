import { Box, Link, Typography } from '@mui/material';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link as RouterLink } from 'react-router-dom';
import type { ReactNode } from 'react';

const PR_REF = /(^|[\s(])#(\d+)\b/g;

function linkifyPrRefs(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  PR_REF.lastIndex = 0;
  while ((match = PR_REF.exec(text)) !== null) {
    const start = match.index + match[1].length;
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) parts.push(match[1]);
    const num = match[2];
    parts.push(
      <Link key={`${start}-${num}`} component={RouterLink} to={`/prs/${num}`} underline="hover" fontWeight={600}>
        #{num}
      </Link>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : [text];
}

function transformChildren(children: ReactNode): ReactNode {
  if (typeof children === 'string') return linkifyPrRefs(children);
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') {
        return <span key={i}>{linkifyPrRefs(child)}</span>;
      }
      return child;
    });
  }
  return children;
}

const components: Components = {
  h1: ({ children }) => (
    <Typography variant="h5" component="h1" gutterBottom sx={{ mt: 2, '&:first-of-type': { mt: 0 } }}>
      {transformChildren(children)}
    </Typography>
  ),
  h2: ({ children }) => (
    <Typography variant="h6" component="h2" gutterBottom sx={{ mt: 2, '&:first-of-type': { mt: 0 } }}>
      {transformChildren(children)}
    </Typography>
  ),
  h3: ({ children }) => (
    <Typography variant="subtitle1" component="h3" fontWeight={600} gutterBottom sx={{ mt: 1.5 }}>
      {transformChildren(children)}
    </Typography>
  ),
  h4: ({ children }) => (
    <Typography variant="subtitle2" component="h4" fontWeight={600} gutterBottom sx={{ mt: 1.5 }}>
      {transformChildren(children)}
    </Typography>
  ),
  h5: ({ children }) => (
    <Typography variant="body1" component="h5" fontWeight={600} gutterBottom>
      {transformChildren(children)}
    </Typography>
  ),
  h6: ({ children }) => (
    <Typography variant="body2" component="h6" fontWeight={600} gutterBottom>
      {transformChildren(children)}
    </Typography>
  ),
  p: ({ children }) => (
    <Typography variant="body2" paragraph sx={{ mb: 1.5, '&:last-child': { mb: 0 } }}>
      {transformChildren(children)}
    </Typography>
  ),
  a: ({ href, children }) => {
    const prMatch = href?.match(/\/pull\/(\d+)(?:\/|$)/);
    if (prMatch) {
      return (
        <Link component={RouterLink} to={`/prs/${prMatch[1]}`} underline="hover">
          {children}
        </Link>
      );
    }
    return (
      <Link href={href} target="_blank" rel="noreferrer" underline="hover">
        {children}
      </Link>
    );
  },
  ul: ({ children }) => (
    <Box component="ul" sx={{ pl: 2.5, my: 1, '& li': { mb: 0.5 } }}>
      {children}
    </Box>
  ),
  ol: ({ children }) => (
    <Box component="ol" sx={{ pl: 2.5, my: 1, '& li': { mb: 0.5 } }}>
      {children}
    </Box>
  ),
  li: ({ children }) => (
    <Typography component="li" variant="body2">
      {transformChildren(children)}
    </Typography>
  ),
  blockquote: ({ children }) => (
    <Box
      component="blockquote"
      sx={{
        m: 0,
        my: 1.5,
        pl: 2,
        borderLeft: '3px solid',
        borderColor: 'primary.main',
        color: 'text.secondary',
        '& p': { mb: 0 },
      }}
    >
      {children}
    </Box>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      return (
        <Box
          component="code"
          className={className}
          sx={{
            display: 'block',
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: '0.8125rem',
            lineHeight: 1.55,
            whiteSpace: 'pre',
          }}
        >
          {children}
        </Box>
      );
    }
    return (
      <Box
        component="code"
        sx={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: '0.85em',
          px: 0.6,
          py: 0.15,
          borderRadius: 0.75,
          bgcolor: 'rgba(15, 76, 92, 0.08)',
        }}
      >
        {children}
      </Box>
    );
  },
  pre: ({ children }) => (
    <Box
      component="pre"
      sx={{
        my: 1.5,
        p: 1.5,
        overflow: 'auto',
        borderRadius: 1,
        bgcolor: 'rgba(15, 76, 92, 0.06)',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      {children}
    </Box>
  ),
  table: ({ children }) => (
    <Box sx={{ overflowX: 'auto', my: 1.5 }}>
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
          '& th, & td': {
            border: '1px solid',
            borderColor: 'divider',
            px: 1.25,
            py: 0.75,
            textAlign: 'left',
          },
          '& th': {
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'text.secondary',
            bgcolor: 'rgba(15, 76, 92, 0.04)',
          },
        }}
      >
        {children}
      </Box>
    </Box>
  ),
  hr: () => <Box component="hr" sx={{ border: 0, borderTop: '1px solid', borderColor: 'divider', my: 2 }} />,
  img: ({ src, alt }) => (
    <Box
      component="img"
      src={src}
      alt={alt ?? ''}
      sx={{ maxWidth: '100%', height: 'auto', borderRadius: 1, my: 1, display: 'block' }}
    />
  ),
  strong: ({ children }) => (
    <Box component="strong" sx={{ fontWeight: 650 }}>
      {transformChildren(children)}
    </Box>
  ),
  em: ({ children }) => <em>{transformChildren(children)}</em>,
  del: ({ children }) => <del>{transformChildren(children)}</del>,
};

export function MarkdownContent({
  content,
  empty = 'No content.',
  maxHeight,
}: {
  content: string | null | undefined;
  empty?: string;
  maxHeight?: number | string;
}) {
  if (!content?.trim()) {
    return (
      <Typography variant="body2" color="text.secondary">
        {empty}
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        maxHeight,
        overflow: maxHeight ? 'auto' : undefined,
        '& > :first-of-type': { mt: 0 },
        '& > :last-child': { mb: 0 },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </Box>
  );
}
