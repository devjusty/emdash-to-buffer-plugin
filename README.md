# emdash-to-buffer

[EmDash](https://github.com/emdash-cms/emdash) plugin that queues first-time published `posts` entries to [Buffer](https://buffer.com/).

This plugin is under active development. It is currently only confirmed to work with LinkedIn, Google Business, and Facebook. If you use another channel and hit an error, please [open an issue on GitHub](https://github.com/devjusty/emdash-to-buffer-plugin/issues). Contributions are welcome.

## Features

- Triggers on `content:afterPublish` (draft → live) and create-as-published saves
- Sends once, on a post's first publish. Republishing a live post, republishing after an unpublish, and posts that were already live when the plugin was installed are all skipped by default
- Optional `Send again when a published post is republished` toggle for teams that do want a new Buffer update per republish
- Multi-channel fan-out
- Automatic channel discovery from your Buffer account
- Settings UI with discoverable channel table and on/off channel toggles
- Delivery log table (latest attempts) with clear-log action
- Template tags: `{title}`, `{excerpt}`, `{url}` on separate lines by default
- Canonical URL fallback to `/posts/{slug}`
- Featured image fallback to Open Graph image
- Retries on transient API failures

## Install

Requires EmDash `>=0.30.0`.

```bash
pnpm add emdash-to-buffer-plugin
```

## Usage

```ts
import { defineConfig } from "astro/config";
import emdash from "emdash";
import emdashToBuffer from "emdash-to-buffer-plugin";

export default defineConfig({
  integrations: [
    emdash({
      // Trusted / in-process (all platforms, including Node)
      plugins: [emdashToBuffer],
      // Or sandboxed isolates on Cloudflare:
      // sandboxed: [emdashToBuffer],
    }),
  ],
});
```

Configure plugin settings in EmDash admin (`Plugins` → `emdash-to-buffer` → `Settings`):

- Buffer access token
- Discover channels and toggle enabled channels
- View recent delivery attempts and clear the log
- Message template
- Enable/disable switch
- Resend-on-republish switch (off by default)

## Breaking changes in 1.1.0

- Install uses a **default export** (no `emdashToBufferPlugin()` factory).
- The `emdash-to-buffer-plugin/native` entrypoint was removed. Use the standard export in `plugins:` or `sandboxed:`.
- Peer dependency is `emdash >= 0.30.0`.

## Development

```bash
pnpm install
pnpm test
pnpm validate
pnpm build
```
