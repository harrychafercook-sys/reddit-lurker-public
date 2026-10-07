# Reddit Lurker

A personal, read-only Reddit reader with an installable web app and an Android
WebView wrapper. It displays public subreddit feeds, posts, comments and linked
media, with sorting, favourites and bounded offline caches.

This repository began as a fresh source snapshot and now includes version 7.6.3. It contains no
private development history, account settings, deployment credentials or
site-specific SSH deployment scripts.

## Build and preview

Use Node.js 22 or newer:

```sh
npm ci
npm run build
npm test
npm run preview
```

Open http://127.0.0.1:4173/. Rebuild after source changes. Deploy only `dist/`;
the root `index.html` is a build template. The PHP media helpers need PHP 8+
with curl and DOM on the web host. For local playback, set `PHP_BINARY` to a
suitable PHP executable before starting the preview.

## Credentials and API access

Enter your own Reddit client ID and client secret directly into the app. A
RapidAPI article-extractor2 key is optional: without a nonblank saved key,
Txtify is hidden in feed and post menus, while browsing and comment caching
remain available. Adding a key enables Txtify; clearing its field removes it.
The app stores credentials in local
browser storage; they are not supplied by this repository or its build.
Never commit account settings, API credentials, SSH keys or signing keys.

The current app uses Reddit's legacy OAuth Data API with application-only
`client_credentials` access. It does not post, comment, vote, message or
moderate. Public source availability and app registration do not guarantee
API approval or continued access after Reddit's announced March 2027 closure.
Live feeds and article extraction require credentials accepted by their
respective providers.

## Android

`scripts/build-android.ps1` builds the Android app using an Android SDK, Java and
a local signing keystore. All HTML, CSS, JavaScript and icons are packaged in
the APK and render offline. Reddit data and the PHP media helpers still need
network access. The existing HTTPS origin is retained for saved settings, but
app files are intercepted and served locally, with no hosted asset fallback.

The More modal shows the version and Check for updates. The native updater
checks the server's `latest.json`, offers a newer APK, verifies its size,
SHA-256 checksum, package, version and signing certificate, then opens Android's
installer. Installation requires Android approval and, on first use, permission
to install updates from this app. Failed checks do not block reading.

The build produces a versioned APK and matching update manifest in ignored
`artifacts/`. Future releases require a version bump and a new signed APK using
the same keystore. Host versioned APKs with immutable caching and atomically
publish their matching manifest as `latest.json` with no-store caching. The
hosting publication script remains private; download headers are supplied in
`deploy/android-downloads.htaccess`.

For your own deployment, configure the origins and update URLs in `LocalAssets`,
`MediaBridge`, `UpdateSpec` and `native-media.js` consistently. No personal
settings or signing keystore are bundled in this source snapshot.

`pwsh -File scripts/test-android.ps1 -Device <adb-serial>` tests packaged assets
and offline rendering on an installed APK. `-CheckDownload` additionally tests
the native download and verification path when the server offers a newer APK.
The script removes its temporary test runner afterwards and preserves app data.

## Validation

GitHub Actions builds the web app, runs the JavaScript tests, checks the PHP
helpers, and tests the native media file validation. Hosting-specific deployment
automation remains in the private development repository.
