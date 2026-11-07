# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on the [repository](https://github.com/albert429/ChronosBible/security/advisories/new). Never report them in public issues or discussions.

In scope: cross-site scripting or HTML injection, leaked credentials, and anything that exposes readers' data or compromises deployments.

## Good to know

- Reading progress stays in the reader's browser. There are no reader accounts. Optional AI uses a same-origin Cloudflare Worker with anonymous signed cookies, server-enforced quotas and shared preset caching; see [the AI runtime](docs/ai-worker.md).
- Any `VITE_*` value is compiled into public JavaScript and is public by design.

## Supported versions

The live sites built from `main`. There is no bug bounty.
