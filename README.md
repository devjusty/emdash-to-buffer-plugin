# emdash-to-buffer

[EmDash](https://github.com/emdash-cms/emdash) plugin that queues first-time published `posts` entries to [Buffer](https://buffer.com/).

This plugin is under active development. It is currently only confirmed to work with LinkedIn, Google Business, and Facebook. If you use another channel and hit an error, please [open an issue on GitHub](https://github.com/devjusty/emdash-to-buffer-plugin/issues). Contributions are welcome.

## Features

- Publish-only trigger for `posts`
- Multi-channel fan-out
- Automatic channel discovery from your Buffer account
- Settings UI with discoverable channel table and on/off channel toggles
- Delivery log table (latest attempts) with clear-log action
- Template tags: `{title}`, `{excerpt}`, `{url}` on separate lines by default
- Canonical URL fallback to `/posts/{slug}`
- Featured image fallback to Open Graph image
- Retries on transient API failures

## Install

```bash
pnpm add emdash-to-buffer-plugin
```

## Usage

```ts
import { defineConfig } from "astro/config";
import emdash from "emdash";
import { emdashToBufferPlugin } from "emdash-to-buffer-plugin";

export default defineConfig({
  integrations: [
    emdash({
      plugins: [emdashToBufferPlugin()],
    }),
  ],
});
```

Native installs can import `emdash-to-buffer-plugin/native` as a ready-to-use native plugin export.

Configure plugin settings in EmDash admin (`Plugins` -> `emdash-to-buffer` -> `Settings`):

- Buffer access token
- Discover channels and toggle enabled channels
- View recent delivery attempts and clear the log
- Message template
- Enable/disable switch

## Development

```bash
pnpm install
pnpm test
pnpm build
```
