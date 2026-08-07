import type { Octokit } from '@octokit/rest';
import type { WorkflowRunSummary } from '../../shared/types.js';
import { secondsBetween } from '../../shared/utils.js';

/** Max workflow node IDs per GraphQL request (keeps query complexity bounded). */
export const WORKFLOW_GRAPHQL_CHUNK_SIZE = 25;

export interface WorkflowNodeRef {
  id: number;
  name: string;
  nodeId: string;
}

interface GqlWorkflowRun {
  databaseId: number | null;
  runNumber: number;
  runAttempt: number;
  event: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  headSha?: string | null;
  checkSuite: {
    status: string | null;
    conclusion: string | null;
    branch: { name: string } | null;
    commit: { oid: string } | null;
  } | null;
}

interface GqlWorkflowNode {
  databaseId: number | null;
  name: string;
  runs: { nodes: Array<GqlWorkflowRun | null> };
}

interface GqlNodesResponse {
  nodes: Array<GqlWorkflowNode | null>;
}

const RUNS_BY_WORKFLOW_QUERY = `
  query WorkflowRunsByIds($ids: [ID!]!, $perWorkflow: Int!) {
    nodes(ids: $ids) {
      ... on Workflow {
        databaseId
        name
        runs(first: $perWorkflow, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes {
            databaseId
            runNumber
            runAttempt
            event
            url
            createdAt
            updatedAt
            checkSuite {
              status
              conclusion
              branch { name }
              commit { oid }
            }
          }
        }
      }
    }
  }
`;

function lowerOrNull(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  return value.toLowerCase();
}

export function mapGraphqlWorkflowRun(
  workflowId: number,
  workflowName: string,
  run: GqlWorkflowRun,
): WorkflowRunSummary | null {
  if (run.databaseId == null) return null;
  const status = lowerOrNull(run.checkSuite?.status);
  const conclusion = lowerOrNull(run.checkSuite?.conclusion);
  return {
    id: run.databaseId,
    name: workflowName,
    workflowId,
    workflowName,
    status,
    conclusion,
    event: run.event,
    branch: run.checkSuite?.branch?.name ?? '',
    headSha: run.checkSuite?.commit?.oid ?? run.headSha ?? '',
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    runStartedAt: run.createdAt,
    durationSeconds: secondsBetween(run.createdAt, run.updatedAt),
    htmlUrl: run.url,
    attempt: run.runAttempt ?? 1,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Batch-fetch the most recent runs for many workflows in a few GraphQL calls.
 * Requires each workflow's GraphQL node id (REST `node_id`).
 */
export async function fetchRecentRunsPerWorkflowGraphql(
  octokit: Octokit,
  workflows: WorkflowNodeRef[],
  perWorkflow: number,
): Promise<Map<number, WorkflowRunSummary[]>> {
  const byId = new Map<number, WorkflowRunSummary[]>();
  for (const wf of workflows) byId.set(wf.id, []);

  const withNode = workflows.filter((w) => w.nodeId);
  if (withNode.length === 0) return byId;

  for (const group of chunk(withNode, WORKFLOW_GRAPHQL_CHUNK_SIZE)) {
    const data = await octokit.graphql<GqlNodesResponse>(RUNS_BY_WORKFLOW_QUERY, {
      ids: group.map((w) => w.nodeId),
      perWorkflow,
    });

    for (const node of data.nodes ?? []) {
      if (!node?.databaseId) continue;
      const workflowId = node.databaseId;
      const workflowName = node.name;
      const items: WorkflowRunSummary[] = [];
      for (const run of node.runs?.nodes ?? []) {
        if (!run) continue;
        const mapped = mapGraphqlWorkflowRun(workflowId, workflowName, run);
        if (mapped) items.push(mapped);
      }
      byId.set(workflowId, items);
    }
  }

  return byId;
}
