# Emdash to Buffer Plugin Status

## Current Release: `emdash-to-buffer-plugin@1.1.1`

MVP: Emdash CMS plugin that sends published `posts` entries to Buffer, queues them on discovered/enabled channels, and prefers the content canonical URL with `/posts/{slug}` as fallback. Posts include title, excerpt, URL, and featured/OG image when available. Supported channels include LinkedIn, Facebook, and Google Business.

---

## Revision History

- 1.1.1: Stable cut of first-publish-only Buffer delivery. Skip sends when EmDash re-fires `content:afterPublish` for already-live posts (`state:watchSince` watermark + delivery claim); optional `repostOnRepublish` settings toggle. Graduates `1.1.1-beta.1` / `1.1.1-beta.2`.
- 1.1.1-beta.2: Prerelease validation of the first-publish-only gate on a live site.
- 1.1.1-beta.1: First-publish-only default. Skip Buffer sends when EmDash re-fires `content:afterPublish` for already-live posts (observation watermark + delivery claim); optional `repostOnRepublish` settings toggle.
- 1.1.0-beta.1: Prerelease of the 1.1.0 install-shape / EmDash 0.30+ / publish-hook contract update.
- 1.1.0: Breaking install-shape update (default export, drop `/native`), EmDash 0.30+ peer, publish-hook contract fix (`content:afterPublish` primary + delivery claim; no republish-after-unpublish by default), packaging via `emdash-plugin` CLI + `emdash-plugin.jsonc`.
- 1.0.1: Patch release aligning plugin descriptor/native versions with package.json and tightening admin interaction typing (unreleased / superseded by 1.1.0).
- 1.0.0: Stable release cut after validating the native wrapper, sandbox entrypoint, Buffer image handling, and first-publish gating.
- 0.1.7-beta.3: Sandboxed entrypoint now exports the shared plugin object directly for EmDash 0.13.0 compatibility.
- 0.1.7-beta.3: Added a native wrapper entrypoint for sites that want the same plugin in native mode.
- 0.1.7-beta.2: Default post text is newline-separated (`{title}\n{excerpt}\n{url}`) for clearer Buffer previews.
- 0.1.7-beta.2: Featured image extraction now handles MediaValue/local-media objects, not just bare URLs.
- 0.1.7-beta.2: Relative featured and OG image URLs continue to resolve against the site origin.
- 0.1.7-beta.1: `ctx.site.url` now takes priority for origin resolution, with admin `siteUrl` as fallback.
- 0.1.7-beta.1: Canonical-first post URLs still fall back to `https://<site-origin>/posts/{slug}` when needed.
- 0.1.7-beta.1: Google Business posts now include `detailsWhatsNew` plus a `learn_more` button.
- 0.1.6-beta.3: Delivery logs added with 200-entry retention and clear action.
- 0.1.6-beta.3: Channel discovery, channel toggles, and Buffer GraphQL publishing.
- 0.1.6-beta.3: Facebook / Google Business metadata added for network-specific posts.

---

Working:

- Successfully sends posts to linked Buffer channels on first publish.
- Delivery claim (`state:delivered:{postId}`) prevents double-queue and republish-after-unpublish.
- Observation watermark (`state:watchSince`) keeps republishes of posts that were already live at install time from sending. EmDash re-fires `content:afterPublish` on every republish and the event carries no previous publish state, so posts that predate the watermark are claimed and skipped instead of queued.
- `settings:repostOnRepublish` (default off) opts into a new Buffer update per republish, deduped per revision via the claim's `updatedAt`.
- Delivery logs capture success/failure with channel, code, and message.
- Settings page shows discovered channels with on/off toggles.
- Channel discovery is automatic once the Buffer token is saved.
- Canonical URL is preferred; `/posts/{slug}` is the fallback.
- `ctx.site.url` is preferred as the site origin, with admin `siteUrl` as fallback.
- Featured image / OG image fallback is implemented and handles local MediaValue objects.
- Relative image URLs resolve against the site origin.
- Default post text is title, excerpt, and URL on separate lines.
- Google Business posts include `detailsWhatsNew` metadata and a learn-more button.

---

Current Issues:

- No known blocking issues in the current implementation.
- Follow-up: `ctx.url()` / `trailingSlash` alignment.
- Marketplace publish needs a real Atmosphere `publisher` DID in `emdash-plugin.jsonc` (placeholder `did:plc:abc123def456` is for local validate/build only).

---

Debugging:

- Publish attempts log `hook`, `collection`, `contentId`, `contentStatus`, and `isNew`.
- Skipped sends log `emdash-to-buffer skipped send; not a first publish` with a `reason` (`already delivered`, `already delivered for this revision`, or `published before this install started tracking deliveries`).
- Image extraction logs `contentKeys`, `dataKeys`, `seoKeys`, `pickedImageUrl`, and the resolved post URL.
- Delivery log retention is capped at 200 rows.

---

Of Scope of MVP:

- Confirmed support for other channels: Twitter, Threads, Bluesky.
- Prep to submit to Emdash Plugin Marketplace.
- Per-site URL builder settings beyond canonical + `/posts/{slug}` fallback.
