# Security

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository.

Include what you found, how to reproduce it, and what an attacker could do
with it. You'll get a reply once the report has been looked at, and credit
in the fix if you'd like it.

## Supported versions

Scry has no releases yet: fixes go to `main`. Run a recent `main` and
rebuild after pulling.

## Running Scry safely

`docs/pilot.md` lists the settings that matter for a real install: HTTPS,
a random `SESSION_SECRET` and `SETTINGS_ENCRYPTION_KEY`, `INITIAL_ADMIN_EMAILS`
set before anyone signs in, `LLM_ALLOWED_HOSTS`, and ports bound to
localhost behind a reverse proxy.

The demo (`docker-compose.demo.yml` and the Keycloak overlay) ships
well-known passwords and a fixed session secret. Never expose it to a
network.
