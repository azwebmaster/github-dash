import { unzipSync } from 'fflate';
import type { Octokit } from '@octokit/rest';
import type { WorkflowOrchestrationState } from '../../shared/types.js';

const STATE_JSON = 'state.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeOrchestrationState(value: unknown): value is WorkflowOrchestrationState {
  if (!isRecord(value) || !isRecord(value.pipeline)) return false;
  return Array.isArray(value.pipeline.stages);
}

function findStateJson(files: Record<string, Uint8Array>): string | null {
  const entries = Object.keys(files);
  const exact = entries.find((name) => name === STATE_JSON || name.endsWith(`/${STATE_JSON}`));
  if (!exact) return null;
  return new TextDecoder().decode(files[exact]);
}

function parseStateJson(raw: string): WorkflowOrchestrationState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return looksLikeOrchestrationState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function downloadArtifactZip(
  octokit: Octokit,
  owner: string,
  repo: string,
  artifactId: number,
): Promise<Uint8Array | null> {
  try {
    const response = await octokit.actions.downloadArtifact({
      owner,
      repo,
      artifact_id: artifactId,
      archive_format: 'zip',
      request: {
        redirect: 'manual',
        // Avoid Octokit trying to JSON-parse the zip body if a redirect is followed.
        parseSuccessResponseBody: false,
      },
    });

    const location =
      (typeof response.headers.location === 'string' && response.headers.location) || null;

    if (location) {
      const zipRes = await fetch(location);
      if (!zipRes.ok) return null;
      return new Uint8Array(await zipRes.arrayBuffer());
    }

    const data = response.data as unknown;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data instanceof Uint8Array) return data;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return new Uint8Array(data);
    if (typeof data === 'string' && data.length > 0) return new TextEncoder().encode(data);
    return null;
  } catch {
    return null;
  }
}

function preferArtifactOrder(
  artifacts: Array<{ id: number; name: string; expired: boolean; size_in_bytes: number }>,
): Array<{ id: number; name: string }> {
  const live = artifacts.filter((a) => !a.expired);
  const score = (name: string) => {
    const lower = name.toLowerCase();
    if (lower === 'state' || lower === 'state.json') return 0;
    if (lower.includes('state')) return 1;
    if (lower.includes('pipeline') || lower.includes('orchestr')) return 2;
    return 3;
  };
  return [...live]
    .sort((a, b) => score(a.name) - score(b.name) || a.size_in_bytes - b.size_in_bytes)
    .map((a) => ({ id: a.id, name: a.name }));
}

export async function loadOrchestrationFromArtifacts(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number,
): Promise<{
  orchestration: WorkflowOrchestrationState | null;
  orchestrationArtifact: { id: number; name: string } | null;
}> {
  try {
    const { data } = await octokit.actions.listWorkflowRunArtifacts({
      owner,
      repo,
      run_id: runId,
      per_page: 100,
    });

    const candidates = preferArtifactOrder(data.artifacts);
    for (const artifact of candidates) {
      const zipBytes = await downloadArtifactZip(octokit, owner, repo, artifact.id);
      if (!zipBytes) continue;

      let files: Record<string, Uint8Array>;
      try {
        files = unzipSync(zipBytes);
      } catch {
        continue;
      }

      const raw = findStateJson(files);
      if (!raw) continue;

      const orchestration = parseStateJson(raw);
      if (!orchestration) continue;

      return { orchestration, orchestrationArtifact: artifact };
    }
  } catch {
    // Artifact listing/download can fail (permissions, expired, rate limits) — soft-fail.
  }

  return { orchestration: null, orchestrationArtifact: null };
}
