# Accessibility Checker MVP

Zero-budget accessibility checker MVP using:

- `Cloudflare Pages` for the public website
- `Cloudflare Worker` for the async API
- `GitHub Actions` for Playwright + `axe-core` scanning
- Cloudflare `KV` for short-lived job/report storage

## Project structure

- `apps/web`: Astro marketing site and scan UI
- `apps/worker`: Worker API and callback endpoints
- `packages/scan-runner`: GitHub Actions scan script

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run the web app:

   ```bash
   npm run dev:web
   ```

3. Run the Worker locally:

   ```bash
   npm run dev:worker
   ```

## Required services

### Cloudflare

- Create a Cloudflare account
- Create a KV namespace for job storage
- Create a Worker and bind the KV namespace as `SCAN_JOBS`
- Add Worker secrets:
  - `GITHUB_OWNER`
  - `GITHUB_REPO`
  - `GITHUB_WORKFLOW_FILE`
  - `GITHUB_API_TOKEN`
  - `SCAN_CALLBACK_SECRET`
  - `TURNSTILE_SECRET` (optional for local dev, recommended in production)
  - `RATE_LIMIT_MAX_PER_DAY`

### GitHub

- Create a GitHub repository for this project
- Add repository secrets:
  - `SCAN_CALLBACK_SECRET`
  - `SCAN_CALLBACK_URL`
- Enable GitHub Actions
- If using a private dispatch token, create a fine-grained PAT and set it as `GITHUB_API_TOKEN` in Worker secrets

## Async scan flow

1. Visitor submits a URL on the Astro site
2. Frontend calls `POST /api/scan` on the Worker
3. Worker validates the URL, rate limits the request, stores a queued job in KV, and dispatches GitHub Actions
4. GitHub Action runs Playwright + `axe-core`, builds a JSON result, generates a PDF, then POSTs the finished payload to the Worker callback
5. Worker updates KV and exposes:
   - `GET /api/jobs/:id`
   - `GET /api/report/:id.pdf`

## Deployment order

1. Push repo to GitHub
2. Deploy `apps/web` to Cloudflare Pages
3. Deploy `apps/worker` to Cloudflare Workers
4. Configure the Worker URL as `PUBLIC_API_BASE_URL` in the Pages project
5. Add the callback secret in GitHub:

   ```text
   SCAN_CALLBACK_SECRET=<same value used in the Worker secret>
   ```

6. Run a manual GitHub Actions workflow test

## Important notes

- This is an automated scanner, not legal certification
- `axe-core` catches many issues, but manual review is still necessary
- GitHub Actions makes this MVP asynchronous and queue-based by design
