# How Studio names dev servers

When Studio finds a dev server without a portless name, it suggests one, and auto mode gives that
name without asking. Studio builds the name from the project the server runs in: its git branch,
its `package.json` and its repository folder. A server started from `@acme/web` in the repository
`acme-monorepo`, on the branch `feat/ED-1234-add-login`, gets `ed-1234.web.acme`, which opens at
`http://ed-1234.web.acme.localhost:1355`.

The name follows a template you can change in Settings, under Naming, or as `nameTemplate` in the
config file. The default is:

```text
{work}.{package}.{repo}
```

## Why this order

portless names a dev server started in a git worktree `<branch>.<name>.localhost`, so two
checkouts of the same app never share a hostname. The default template keeps that order: what the
work is comes first, then the app, then the repository. Names from portless and from Studio read
the same way, and the label that changes most often, the work, sits where you start typing.

## Tokens

The examples use a server in `apps/web` of the repository `acme-monorepo`, package `@acme/web`,
running in the linked worktree `falcon` on the branch `feat/ED-1234-add-login`, on port 5173.

| Token | Value | Example |
| --- | --- | --- |
| `{work}` | The ticket key in the branch, else the branch's last segment. On `main`, `master`, `develop`, `trunk` or a detached HEAD, the linked worktree's folder, else nothing. | `ed-1234` |
| `{branch}` | The whole branch, with `/` and other characters a name cannot hold turned into `-`. | `feat-ed-1234-add-login` |
| `{ticket}` | Only the ticket key in the branch, such as `ED-1234` or `run-51`; nothing when there is none. | `ed-1234` |
| `{package}` | The `name` of the nearest `package.json`, without its scope. | `web` |
| `{repo}` | The repository folder. When the branch gives the work, a `-monorepo`, `-mono` or `-repo` suffix is dropped; on the default branch the full folder stays, so names given there do not change. Outside a repository and a package, the server's folder. | `acme` |
| `{worktree}` | The linked worktree's folder; nothing in the main checkout. | `falcon` |
| `{folder}` | The folder the server runs in. | `web` |
| `{port}` | The port the server listens on. | `5173` |

A template may also hold letters, digits and dashes between tokens, such as `dev.{package}` or
`{package}-{port}`. Dots split the name into labels.

## How a template becomes a name

1. Each token is replaced by its value, or by nothing when the value is unknown.
2. Each label is lowercased, characters a hostname cannot hold become `-`, and the label is cut to
   63 characters, the most a hostname label allows.
3. Labels left empty are dropped with the dot around them: on `main`, `{work}.{package}.{repo}`
   gives `web.acme-monorepo`, not `.web.acme-monorepo`.
4. A label equal to the one before it is dropped, so the package `shop-admin` in the repository
   `shop-admin` gives `shop-admin`, not `shop-admin.shop-admin`.
5. When no label comes from `{package}`, `{repo}`, `{folder}` or `{port}`, there is no suggestion:
   a name made only of the branch would be the same for every app on that branch.

Studio rejects a template with an unknown token, a `{` without its `}`, or other characters, and
the error names the problem. A template also needs at least one of `{package}`, `{repo}`,
`{folder}` or `{port}`.

## Sample templates

| Template | Example name | When it helps |
| --- | --- | --- |
| `{work}.{package}.{repo}` | `ed-1234.web.acme` | The default. |
| `{ticket}.{repo}` | `ed-1234.acme` | One app per repository, named by ticket. |
| `{package}-{port}` | `web-5173` | Every server keeps a different name, whatever the branch. |
| `{worktree}.{package}` | `falcon.web` | Worktrees are named after the task already. |
| `{branch}.{package}` | `feat-ed-1234-add-login.web` | Branches without ticket keys. |

## Naming from agents

Agents name ports through the MCP tools in [mcp.md](mcp.md). The suggested name from
`list_detected_ports` already follows the template, so an agent that uses it gets the same names
as auto mode. When an agent picks a name itself with `name_port`, it should follow the same order:
the ticket key or pull request number first, then the app, then the repository, such as
`ed-1234.web.acme` or `pr-87.web.acme`.
