import { Hono } from "hono";
import { cors } from "hono/cors";
import type { CallbackBody, Env, ScanRequestBody } from "./types";
import {
  createQueuedJob,
  dispatchGitHubWorkflow,
  enforceRateLimit,
  makeCallbackUpdate,
  readJob,
  saveJob,
  validateScanRequest,
  verifyTurnstile
} from "./utils";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["content-type", "authorization"]
}));

app.get("/api/health", (c) => {
  return c.json({ ok: true, service: "accessibility-checker-worker" });
});

app.post("/api/scan", async (c) => {
  const body = await c.req.json<Partial<ScanRequestBody>>().catch(() => ({}));
  const validation = validateScanRequest(body);
  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const turnstileOk = await verifyTurnstile(c.env.TURNSTILE_SECRET, body.turnstileToken, ip);
  if (!turnstileOk) {
    return c.json({ error: "Turnstile verification failed." }, 400);
  }

  const limit = await enforceRateLimit(c.env, ip);
  if (!limit.ok) {
    return c.json({ error: limit.error }, 429);
  }

  const job = createQueuedJob(body.url!, "wcag22aa", ip, c.env);
  await saveJob(c.env, job);

  try {
    await dispatchGitHubWorkflow(c.env, job, new URL(c.req.url).origin);
    return c.json({
      scanId: job.id,
      status: job.status,
      scannedUrl: job.scannedUrl
    }, 202);
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Unknown dispatch error";
    await saveJob(c.env, job);
    return c.json({ error: job.error }, 502);
  }
});

app.get("/api/jobs/:id", async (c) => {
  const job = await readJob(c.env, c.req.param("id"));
  if (!job) {
    return c.json({ error: "Job not found." }, 404);
  }

  return c.json({
    id: job.id,
    status: job.status,
    scannedUrl: job.scannedUrl,
    updatedAt: job.updatedAt,
    error: job.error,
    result: job.result,
    pdfUrl: job.status === "completed" ? `/api/report/${job.id}.pdf` : undefined
  });
});

app.get("/api/report/:id.pdf", async (c) => {
  const job = await readJob(c.env, c.req.param("id"));
  if (!job?.pdfBase64) {
    return c.json({ error: "PDF not found." }, 404);
  }

  const bytes = Uint8Array.from(atob(job.pdfBase64), (char) => char.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="accessibility-report-${job.id}.pdf"`
    }
  });
});

app.post("/api/internal/scan-callback", async (c) => {
  const provided = c.req.header("x-scan-callback-secret");
  if (!provided || provided !== c.env.SCAN_CALLBACK_SECRET) {
    return c.json({ error: "Unauthorized callback." }, 401);
  }

  const payload = await c.req.json<CallbackBody>().catch(() => null);
  if (!payload?.scanId || !payload.status) {
    return c.json({ error: "Invalid callback body." }, 400);
  }

  const job = await readJob(c.env, payload.scanId);
  if (!job) {
    return c.json({ error: "Job not found." }, 404);
  }

  const updated = makeCallbackUpdate(job, payload);
  await saveJob(c.env, updated);
  return c.json({ ok: true });
});

export default app;
