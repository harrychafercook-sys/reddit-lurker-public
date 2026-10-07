# Reddit Lurker

A personal, read-only Reddit reader with an installable web app and an Android
WebView wrapper. It displays public subreddit feeds, posts, comments and linked
media, with sorting, favourites and bounded offline caches.

This repository is a fresh source snapshot of version 7.5.3. It contains no
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

Enter your own Reddit client ID and client secret, and your own RapidAPI
article-extractor2 key, directly into the app. The app stores these in local
browser storage; they are not supplied by this repository or its build.
Never commit account settings, API credentials, SSH keys or signing keys.

The current app uses Reddit's legacy OAuth Data API with application-only
`client_credentials` access. It does not post, comment, vote, message or
moderate. Public source availability and app registration do not guarantee
API approval or continued access after Reddit's announced March 2027 closure.
Live feeds and article extraction require credentials accepted by their
respective providers.

## Android

`scripts/build-android.ps1` builds the hosted WebView wrapper using an Android
SDK, Java and a local signing keystore. The wrapper currently points to
https://rlurker.english-grammar-homework.com/index.html. If you host your own
copy, update the hosted URL and origin checks consistently in the Android
source and `native-media.js` before building. No personal settings or signing
keystore are bundled in this source snapshot.

## Validation

GitHub Actions builds the web app, runs the JavaScript tests, checks the PHP
helpers, and tests the native media file validation. Hosting-specific deployment
automation remains in the private development repository.
