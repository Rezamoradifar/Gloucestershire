# Global Drop Trade — Vercel visual preview

Deploy this branch's `website` directory as a Vite project. The tracked
`website/vercel.json` defines installation, build and `dist` output. Select
**Root Directory: website**, **Framework: Vite**, and **Node.js: 22.x**.
Use the preview environment; this does not move GlobalDropTrade.com or change
the existing Ubuntu deployment.

The preview adds more consistent image cards, warmer contrast, clearer active
workflow steps, softer borders, and mobile spacing. All 18 supplied FAQ entries,
local images and existing wallet confirmation behavior are preserved.

The Vercel route `/api/trades` intentionally serves `preview-trades.json` with
`status: not_configured` and no records. It does not impersonate a working
marketplace or blockchain connection. Leave `VITE_VAULT_ADDRESS` unset for this
visual preview. Never add private RPC credentials or keys to `VITE_*` variables.
The actual Node settlement API remains under `server/`; an authenticated live
backend connection is a separate deployment task.

The prepackaged Ubuntu website is retained from the previous release. This
preview is built from frontend source using the Vercel configuration above.
Rebuild and repackage before deploying these additional visual changes to Ubuntu.

Validation completed: TypeScript/Vite production build, all five existing
frontend tests, output asset checks, preview-route payload checks and
`git diff --check`. Browser visual QA could not run because the local preview
endpoint refused the browser connection; no visual-device pass is claimed.

## Current publication blocker

On 2026-10-11, the Vercel connector identified user `rusekingdom-4810` but denied
project access to that user's default team `team_SVPQW7E2B5TyY4Aw5BI2MoIt` with
HTTP 403 (`forbidden`, insufficient scope). No authenticated CLI session was
available. No project or deployment was created on Vercel by this change.
The account owner must grant the connector access to the intended workspace,
or import this branch through their own Vercel dashboard.
