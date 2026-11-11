# Security

This repository contains no credentials.

- API keys are read from the environment variable named by the pack
  (`pack.auth.apiKeyEnv`). Nothing is written to disk by this project.
- Fixtures are sanitised `/models` payloads; account identifiers, keys and
  headers are removed before they are committed.
- `task check` runs a secret-shaped-literal scan over the repository.
- Live checks (`task check:catalog -- --live`, `task probe:*`) run locally and
  read the key from your environment. They are not part of CI.

If you find a leaked credential in the repository or its history, open an issue
without quoting the value, or contact the maintainer directly.
