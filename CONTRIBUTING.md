# Contributing

Thanks for helping. Issues and pull requests are welcome.

- **Set up:** the README's [Development](README.md#development) section
  gets a local stack running; `docs/demo.md` explains the sample data.
- **How the code is organised, and the rules it follows:**
  [CLAUDE.md](CLAUDE.md). It's written for people and AI coding agents
  alike. Read _What Scry is (and isn't)_ first: Scry is a register for
  finding related work, not a delivery tracker, and features stay in that
  spirit.
- **Before opening a pull request:**

  ```bash
  pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
  pnpm build && pnpm test:e2e     # wipes the database it points at
  ```

  Add tests for new behaviour (e2e for user-facing flows), and keep the
  user guide, demo guide and screenshots in step with visible changes.

- **Bigger changes:** open an issue first, so we can agree on the approach
  before you build it.
- **Security problems:** see [SECURITY.md](SECURITY.md); don't file them as
  public issues.

By contributing you agree that your work is licensed under the
[Apache License 2.0](LICENSE).
