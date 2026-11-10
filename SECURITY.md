# Security

## Reporting

Report vulnerabilities through GitHub's private vulnerability reporting for this repository. Do not open a public issue with a working exploit, an API key, or account data.

## Secrets

This repository contains no API keys, tokens, auth files, or personal data.

- Runtime keys come from `COMMANDCODE_API_KEY` or local auth files outside the repository.
- Verification and tests read keys from the environment; they do not write them to disk.
- Errors and logs omit request authorization headers.

If a key was exposed, revoke it in CommandCode Studio and rotate it. Removing a commit is not enough; assume the key is compromised.
