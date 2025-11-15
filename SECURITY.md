# Security and Secrets

- No secrets are kept client-side. All API keys must be provided via environment variables.
- Configure a local `.env` file (not committed) based on `.env.example`.
- If a secret is ever committed, rotate it immediately and force-push a cleaned history.
