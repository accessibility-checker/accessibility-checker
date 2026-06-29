import type { CallbackBody, Env, ScanJobRecord, ScanRequestBody, ScanResult } from "./types";

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^\[::1\]$/i
];

export function validateScanRequest(body: Partial<ScanRequestBody>): { ok: true } | { ok: false; error: string } {
  if (!body.url || typeof body.url !== "string") {
    return { ok: false, error: "A public website URL is required." };
  }

  if (body.standard !== "wcag22aa") {
    return { ok: false, error: "Only WCAG 2.2 AA is supported in this MVP." };
  }

  try {
    const parsed = new URL(body.url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, error: "Only http and https URLs are supported." };
    }

    if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) {
      return { ok: false, error: "Private or local network URLs are not allowed." };
    }
  } catch {
    return { ok: false, error: "The provided URL is not valid." };
  }

  return { ok: true };
}

export async function enforceRateLimit(env: Env, ip: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `rate:${today}:${ip}`;
  const current = Number((await env.SCAN_JOBS.get(key)) ?? "0");
  const max = Number(env.RATE_LIMIT_MAX_PER_DAY || "25");

  if (current >= max) {
    return { ok: false, error: "Daily scan limit reached for this IP. Please try again tomorrow." };
  }

  await env.SCAN_JOBS.put(key, String(current + 1), { expirationTtl: 60 * 60 * 30 });
  return { ok: true };
}

export function createQueuedJob(url: string, standard: "wcag22aa", ip: string, env: Env): ScanJobRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    status: "queued",
    scannedUrl: url,
    standard,
    createdAt: now,
    updatedAt: now,
    requesterIp: ip,
    workflow: {
      owner: env.GITHUB_OWNER,
      repo: env.GITHUB_REPO,
      file: env.GITHUB_WORKFLOW_FILE
    }
  };
}

export async function saveJob(env: Env, job: ScanJobRecord) {
  await env.SCAN_JOBS.put(`job:${job.id}`, JSON.stringify(job), { expirationTtl: 60 * 60 * 24 * 7 });
}

export async function readJob(env: Env, jobId: string): Promise<ScanJobRecord | null> {
  const raw = await env.SCAN_JOBS.get(`job:${jobId}`);
  return raw ? (JSON.parse(raw) as ScanJobRecord) : null;
}

export async function verifyTurnstile(secret: string | undefined, token: string | undefined, ip: string): Promise<boolean> {
  if (!secret) {
    return true;
  }

  if (!token) {
    return false;
  }

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: ip
  });

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body
  });

  const result = await response.json<{ success?: boolean }>();
  return result.success === true;
}

export async function dispatchGitHubWorkflow(env: Env, job: ScanJobRecord, callbackOrigin: string) {
  const dispatchUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW_FILE}/dispatches`;
  const callbackUrl = `${callbackOrigin.replace(/\/$/, "")}/api/internal/scan-callback`;

  const response = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_API_TOKEN}`,
      "content-type": "application/json",
      accept: "application/vnd.github+json",
      "user-agent": "accessibility-checker-worker"
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        scan_id: job.id,
        target_url: job.scannedUrl,
        callback_url: callbackUrl
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub dispatch failed: ${response.status} ${text}`);
  }
}

export function summarizeByImpact(result: ScanResult) {
  return result.issues.reduce<Record<string, number>>((acc, issue) => {
    const key = issue.impact ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

export function makeCallbackUpdate(existing: ScanJobRecord, payload: CallbackBody): ScanJobRecord {
  return {
    ...existing,
    status: payload.status,
    updatedAt: new Date().toISOString(),
    result: payload.result,
    error: payload.error,
    pdfBase64: payload.pdfBase64
  };
}
