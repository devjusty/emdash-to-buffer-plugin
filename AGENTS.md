# Repository Instructions

## Project Shape

- Single pnpm package: `emdash-to-buffer-plugin`, written in strict TypeScript.
- `src/index.ts` is the standard descriptor export; `src/plugin.ts` is the sandbox runtime entrypoint. Keep both exports aligned with `package.json` and `emdash-plugin.jsonc`.
- Runtime behavior lives in `src/runtime.ts`; Buffer GraphQL requests and retry logic live in `src/buffer.ts`; message and image normalization live in `src/render.ts` and `src/images.ts`.
- `dist/` is generated and ignored. Do not edit it manually; `pnpm build` regenerates publish artifacts from source, descriptor, and package metadata.

## Commands

- Install exactly from lockfile: `pnpm install --frozen-lockfile`.
- Run unit tests: `pnpm test`; focus a test with `pnpm exec vitest run tests/publish-hook.test.ts`.
- Typecheck: `pnpm typecheck`.
- Validate plugin descriptor: `pnpm validate`.
- Build package artifacts: `pnpm build`.
- Run unused-code analysis: `pnpm knip`.
- Local development uses `pnpm dev` through `@emdash-cms/plugin-cli`.
- CI order is `pnpm typecheck`, `pnpm test`, `pnpm build`, then `pnpm knip`.

## Behavior Constraints

- Publish only `posts`: `content:afterPublish` handles draft-to-live; `content:afterSave` handles create-as-published only (`isNew === true`).
- Delivery claims use `state:delivered:{postId}` before sending, preventing duplicate queueing and republish-after-unpublish by default. Preserve this unless behavior and tests are intentionally changed together.
- Channel selection distinguishes missing channel settings from an explicit empty list. An explicit empty `settings:enabledChannelIds` means send to no channels.
- Default template is `{title}\n{excerpt}\n{url}`. Canonical URL wins; fallback is `/posts/{slug}` resolved against `ctx.site.url`, then stored `settings:siteUrl`.
- Buffer image assets must be absolute HTTP(S) URLs; localhost and loopback URLs are intentionally omitted.
- Delivery logs are capped at 200 rows and admin settings expose discovery, channel toggles, and log clearing.

## Release Metadata

- `package.json` version, `src/index.ts` descriptor version, and release tag must agree. Publish workflow requires a `v`-prefixed tag matching `package.json`.
- Marketplace publication still requires replacing placeholder `publisher` DID in `emdash-plugin.jsonc`; local validation/build currently use the placeholder.
- `pnpm publish` is not the release path. Publishing occurs from a GitHub published release via `.github/workflows/publish.yml`, which builds and runs npm provenance publishing.

## Tests

- Tests use Vitest with Node environment and globals; tests mock EmDash context, KV, storage, and HTTP fetch. No external Buffer or EmDash service is required for the suite.
- Update focused tests when changing hook gating, delivery claims, URL/image fallback, channel selection, GraphQL payloads, or storage retention.
