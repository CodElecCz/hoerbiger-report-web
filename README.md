# Hoerbiger Reports Browser

A browser for reports stored in the `hoerbiger-reports` Cloudflare R2 bucket.

## Setup

1. Install dependencies with `npm install`.
2. Configure the Worker at `https://hoerbiger-reports-api.codelec.workers.dev` to allow the site's origin, the `GET` method, and the `Authorization` header via CORS. Include the development server's origin when developing locally.
3. Open the site and enter the Worker password. A saved password logs in automatically; use **Logout** to remove it.

The password is stored unencrypted in the browser's localStorage and is accessible to scripts running on the site's origin. Use a trusted device and HTTPS; do not share the browser profile. Clearing site data also removes the password. Old browser-stored R2 keys are removed when the page loads, but their R2 token must be revoked separately if it is no longer needed.

Folders and selections can be downloaded as ZIP files. Downloads are assembled in browser memory, so large selections may exceed available memory.

Filter reports by name, type, result, or date, and optionally search subfolders. NOK markers take precedence over OK. With filters active, selected folders contribute only matching files visible in the current results; enable subfolder search to include matching descendants.

The footer displays bucket usage and remaining free-tier space from the Worker's authenticated `action=stats` response (`totalBytes`, `totalFiles`, and `limitBytes`). Usage refreshes after login and when the Refresh button is clicked.

## Commands

| Command | Action |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Build the production site |
| `npm test` | Run Worker client tests |
| `npm run preview` | Preview the production build |
