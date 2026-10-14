# Contributing

Issues and pull requests are welcome. Keep changes focused and include tests for behavioral changes.

Before submitting a pull request, run:

```sh
npm ci
npm run check
npm test
npm run build
npm run lint:extension
npm run package
```

Pull requests from forks do not run this repository's CI. A maintainer validates proposed changes locally before merging.

Never include credentials, tokens, signing material, cookies, Firefox profiles, browsing data, or generated extension state in commits, issues, logs, or fixtures.
