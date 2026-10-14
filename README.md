# Permanent Tab Actions

Permanent Tab Actions is a headless Firefox extension that makes pinning and muting persistent across browser sessions. A pinned or muted tab returns the next time Firefox starts even when Firefox itself starts a fresh session.

There is no toolbar button or settings page. Firefox's native tab actions are the interface:

- Pin or mute a tab to make it permanent.
- A tab remains permanent while either action is active.
- Unpin and unmute the tab to remove it from the permanent set.
- Closing a permanent tab keeps it closed for the current session; it returns at the next Firefox launch.

The extension preserves the tab's latest URL and Firefox container. Separately marked tabs remain separate even when they share a URL. Missing tabs are restored into the first normal Firefox window.

## Privacy and permissions

Saved URLs, action states, and container identifiers remain in the extension's local storage inside the current Firefox profile. Permanent Tab Actions has no telemetry, server, remote scripts, or network service and does not inspect page content.

The extension requests these Firefox permissions:

- **Access browser tabs** to observe URLs and pin/mute state and recreate tabs.
- **Access recently closed tabs** to attach stable extension-owned identities to restored tabs.
- **Store client-side data** to retain the permanent-tab registry.
- **Access cookies** only because Firefox requires that permission to recreate a tab in its original container. The extension never reads or writes cookie values.

Private windows are excluded entirely.

## Limitations

Firefox does not allow extensions to create some privileged addresses, including many `about:` pages. Such a tab may still return through Firefox's own session restoration, but the extension cannot recreate it in a fresh session. Its record is retained so restoration can be tried on a later launch.

Permanent tabs restore into the first normal window; window groupings are not retained. Data is local to one Firefox profile and is not synchronized between devices.

## Development

Requirements: Node.js 24 and Firefox 142 or later.

```sh
npm ci
npm run check
npm test
npm run build
npm run lint:extension
npm run package
```

To test locally, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/extension/manifest.json`. Temporary extensions disappear when Firefox restarts, so a signed build is required to test full cross-launch behavior.

Generated ZIP files are unsigned development artifacts. Permanent installation in standard Firefox requires the Mozilla-signed XPI from a project release.

## Releases

Maintainers publish through the manually triggered release workflow. The workflow validates the exact committed source, submits it to Mozilla's unlisted signing channel, and publishes the signed XPI, source archive, development ZIP, and update manifest in a GitHub release.

## License

[MIT](LICENSE)
