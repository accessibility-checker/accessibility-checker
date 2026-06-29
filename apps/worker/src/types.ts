export type ScanJobStatus = "queued" | "running" | "completed" | "failed";

export interface ScanRequestBody {
  url: string;
  standard: "wcag22aa";
  turnstileToken?: string;
}

export interface ScanJobRecord {
  id: string;
  status: ScanJobStatus;
  scannedUrl: string;
  standard: "wcag22aa";
  createdAt: string;
  updatedAt: string;
  requesterIp: string;
  workflow?: {
    owner: string;
    repo: string;
    file: string;
  };
  result?: ScanResult;
  error?: string;
  pdfBase64?: string;
}

export interface ScanViolationNode {
  target: string[];
  html: string;
  failureSummary?: string;
}

export interface ScanViolation {
  id: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: ScanViolationNode[];
}

export interface ScanResult {
  scanId: string;
  scannedAt: string;
  page: {
    requestedUrl: string;
    finalUrl: string;
    title: string;
  };
  summary: {
    totalViolations: number;
    byImpact: Record<string, number>;
  };
  issues: ScanViolation[];
  manualChecks: string[];
}

export interface CallbackBody {
  scanId: string;
  status: Extract<ScanJobStatus, "completed" | "failed">;
  result?: ScanResult;
  pdfBase64?: string;
  error?: string;
}

export interface Env {
  SCAN_JOBS: KVNamespace;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW_FILE: string;
  GITHUB_API_TOKEN: string;
  SCAN_CALLBACK_SECRET: string;
  TURNSTILE_SECRET?: string;
  RATE_LIMIT_MAX_PER_DAY: string;
}
