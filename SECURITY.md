# Security

## Reporting a problem

Report security problems privately through GitHub: open the repository's **Security** tab and
choose **Report a vulnerability**. Please do not open a public issue for them. Include the
version (`portless-studio --version`), your operating system and the steps that show the problem.
You will get an answer within a week.

## What Studio protects against

Studio is a local tool. It assumes that you and the programs you run as your own user are trusted,
and protects you from everything else, mainly other websites open in the same browser.

- The server listens on `127.0.0.1` only, so other machines on the network cannot reach it.
- Every request must use a loopback or `.localhost` `Host`, and a browser `Origin`, when present,
  must match it. This blocks DNS rebinding and requests from other sites.
- Every change, and every terminal request, needs a token that changes on every run. Only pages
  served by Studio itself can read it.
- Installing portless always runs the same fixed `npm install -g portless`; nothing from the
  request reaches that command.
- A dev server can be stopped only when it belongs to your user and listens on a port Studio
  shows. Studio never runs a command that needs sudo.

Out of scope: a program already running as your user can do anything Studio can, with or without
Studio. Terminals run commands as you by design. [docs/architecture.md](docs/architecture.md) and
[docs/terminals.md](docs/terminals.md) describe the checks in more detail.
