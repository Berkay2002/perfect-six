# Issue tracker: GitHub

Issues and product specifications for this repository live in GitHub Issues. Use the `gh` CLI for all operations and infer `Berkay2002/perfect-six` from the repository remote.

## Conventions

- Create issues with `gh issue create` and use multiline bodies for specifications and tickets.
- Read issues and their comments with `gh issue view <number> --comments`.
- Apply and remove labels with `gh issue edit`.
- Close issues only when the relevant workflow explicitly calls for it.
- Pull requests are not treated as a triage request surface.

## Publishing

When an engineering skill says to publish to the issue tracker, create a GitHub issue. Specifications are parent issues. Implementation tickets should use GitHub sub-issue relationships when available and native issue dependencies for blocking edges; otherwise include explicit `Part of #<parent>` and `Blocked by: #<issue>` references in issue bodies.

## Native relationships

- Add a sub-issue through GitHub's sub-issues API using the child issue database ID.
- Add blocking edges through GitHub's issue dependencies API using the blocker issue database ID.
- If either API is unavailable, preserve the relationship in the issue body.
