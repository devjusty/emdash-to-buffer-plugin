# emdash-to-buffer

EmDash plugin that queues first-time published `posts` entries to Buffer.

## Features

- Publish-only trigger for `posts`
- Multi-profile fan-out
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
- Profile IDs
- Message template
- Enable/disable switch

## Development

```bash
pnpm install
pnpm test
pnpm build
```
