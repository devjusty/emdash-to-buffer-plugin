# Emdash to Buffer Plugin Status

## Current Release: `emdash-to-buffer-plugin@0.1.8-beta.2`

MVP: Emdash CMS plugin that sends published `posts` entries to Buffer, queues them on discovered/enabled channels, and prefers the content canonical URL with `/posts/{slug}` as fallback. Posts include title, excerpt, URL, and featured/OG image when available. Supported channels include LinkedIn, Facebook, and Google Business.

---

## Revision History

- 0.1.8-beta.2: Version bumped to match the new release tag.
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

- Successfully sends posts to linked Buffer channels.
- Delivery logs capture success/failure with channel, code, and message.
- Settings page shows discovered channels with on/off toggles.
- Channel discovery is automatic once the Buffer token is saved.
- Canonical URL is preferred; `/posts/{slug}` is the fallback.
- `ctx.site.url` is preferred as the site origin, with admin `siteUrl` as fallback.
- Featured image / OG image fallback is implemented and handles local MediaValue objects.
- Relative image URLs resolve against the site origin.
- Default post text is title, excerpt, and URL on separate lines.
- Native wrapper export is available for the same plugin definition.
- Google Business posts include `detailsWhatsNew` metadata and a learn-more button.

---

Current Issues:

- No known blocking issues in the current implementation.
- Follow-up idea: optional best-effort redirect probe if canonical is missing and the site does not use `/posts/{slug}`.

---

Debugging:

- Publish attempts log `hook`, `collection`, `contentId`, `contentStatus`, `hasBefore`, and `isNew`.
- Image extraction logs `contentKeys`, `dataKeys`, `seoKeys`, `pickedImageUrl`, and the resolved post URL.
- Delivery log retention is capped at 200 rows.

---

Of Scope of MVP:

- Confirmed support for other channels: Twitter, Threads, Bluesky.
- Prep to submit to Emdash Plugin Marketplace.
- Per-site URL builder settings beyond canonical + `/posts/{slug}` fallback.
