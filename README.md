# emdash-to-buffer

[EmDash](https://github.com/emdash-cms/emdash) plugin that queues first-time published `posts` entries to [Buffer](https://buffer.com/).

## Features

- Publish-only trigger for `posts`
- Multi-channel fan-out
- Automatic channel discovery when channel IDs are not set
- Template tags: `{title}`, `{url}`, `{excerpt}`
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

Configure plugin settings in EmDash admin:

- Buffer access token
- Channel IDs (optional; blank means auto-discover)
- Message template
- Enable/disable switch

## Development

```bash
pnpm install
pnpm test
pnpm build
```
