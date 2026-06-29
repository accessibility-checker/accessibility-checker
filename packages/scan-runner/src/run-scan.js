import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "playwright";

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function summarizeByImpact(violations) {
  return violations.reduce((acc, violation) => {
    const key = violation.impact ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function createManualChecks() {
  return [
    "Review keyboard-only navigation across menus, dialogs, and custom widgets.",
    "Verify visible focus indicators on all interactive elements.",
    "Check meaningful alternative text quality for images and icons.",
    "Confirm logical reading order and screen reader announcements on dynamic components.",
    "Test form validation messaging and error recovery with assistive technology."
  ];
}

function renderReportHtml(result) {
  const issueRows = result.issues.map((issue) => `
    <tr>
      <td>${escapeHtml(issue.id)}</td>
      <td>${escapeHtml(issue.impact ?? "unknown")}</td>
      <td>${escapeHtml(issue.help)}</td>
      <td>${escapeHtml(issue.tags.filter((tag) => tag.startsWith("wcag")).join(", ") || "Needs review")}</td>
      <td>${escapeHtml(issue.nodes[0]?.target?.join(", ") || "n/a")}</td>
    </tr>
  `).join("");

  const manualChecks = result.manualChecks.map((item) => `<li>${escapeHtml(item)}</li>`).join("");

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Accessibility Report</title>
        <style>
          body { font-family: Georgia, serif; color: #17212b; margin: 32px; }
          h1, h2 { margin-bottom: 8px; }
          .meta, .note { color: #4a5865; margin-bottom: 18px; }
          .summary { display: flex; gap: 16px; margin: 24px 0; }
          .metric { border: 1px solid #d8d0c2; border-radius: 16px; padding: 12px 16px; min-width: 140px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { border: 1px solid #d8d0c2; padding: 10px; vertical-align: top; font-size: 12px; }
          th { background: #f6f3ea; text-align: left; }
          ul { padding-left: 20px; }
        </style>
      </head>
      <body>
        <h1>Accessibility Checker Report</h1>
        <p class="meta">Requested URL: ${escapeHtml(result.page.requestedUrl)}</p>
        <p class="meta">Final URL: ${escapeHtml(result.page.finalUrl)}</p>
        <p class="meta">Scanned at: ${escapeHtml(result.scannedAt)}</p>
        <p class="note">This report contains automated findings mapped to WCAG-related rule tags where available. Manual review is still required.</p>
        <div class="summary">
          <div class="metric"><strong>${result.summary.totalViolations}</strong><br />Violations</div>
          <div class="metric"><strong>${result.summary.byImpact.critical ?? 0}</strong><br />Critical</div>
          <div class="metric"><strong>${result.summary.byImpact.serious ?? 0}</strong><br />Serious</div>
          <div class="metric"><strong>${result.manualChecks.length}</strong><br />Manual checks</div>
        </div>
        <h2>Top Findings</h2>
        <table>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Impact</th>
              <th>Issue</th>
              <th>WCAG Tags</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>${issueRows || '<tr><td colspan="5">No automated violations detected.</td></tr>'}</tbody>
        </table>
        <h2>Manual Review Checklist</h2>
        <ul>${manualChecks}</ul>
      </body>
    </html>
  `;
}

async function main() {
  const scanId = process.env.SCAN_ID;
  const targetUrl = process.env.TARGET_URL;
  const callbackUrl = process.env.CALLBACK_URL;
  const callbackSecret = process.env.SCAN_CALLBACK_SECRET;

  if (!scanId || !targetUrl || !callbackUrl || !callbackSecret) {
    throw new Error("Missing required scan runner environment variables.");
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1024 }
    });
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 120000 });

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    const result = {
      scanId,
      scannedAt: new Date().toISOString(),
      page: {
        requestedUrl: targetUrl,
        finalUrl: page.url(),
        title: await page.title()
      },
      summary: {
        totalViolations: accessibilityScanResults.violations.length,
        byImpact: summarizeByImpact(accessibilityScanResults.violations)
      },
      issues: accessibilityScanResults.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        help: violation.help,
        helpUrl: violation.helpUrl,
        tags: violation.tags,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          html: node.html,
          failureSummary: node.failureSummary
        }))
      })),
      manualChecks: createManualChecks()
    };

    const reportPage = await browser.newPage();
    await reportPage.setContent(renderReportHtml(result), { waitUntil: "load" });
    const pdfBuffer = await reportPage.pdf({ format: "A4", printBackground: true });

    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-scan-callback-secret": callbackSecret
      },
      body: JSON.stringify({
        scanId,
        status: "completed",
        result,
        pdfBase64: Buffer.from(pdfBuffer).toString("base64")
      })
    });

    if (!response.ok) {
      throw new Error(`Callback failed with ${response.status}`);
    }
  } catch (error) {
    await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-scan-callback-secret": callbackSecret
      },
      body: JSON.stringify({
        scanId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown scan error"
      })
    });

    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
