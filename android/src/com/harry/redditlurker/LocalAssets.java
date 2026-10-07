package com.harry.redditlurker;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/** The site's origin preserves existing storage; its app shell is APK-only. */
public final class LocalAssets {
    public static final String HOST = "rlurker.english-grammar-homework.com";
    public static final String START_URL = "https://" + HOST + "/index.html";
    private final AssetManager assets;
    public LocalAssets(AssetManager assets) { this.assets = assets; }
    public static boolean isAppOrigin(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }
    public WebResourceResponse intercept(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!isAppOrigin(uri)) return null;
        String path = uri.getPath();
        // PHP executes on the server. Only these data endpoints may bypass assets.
        if (!request.isForMainFrame() && "GET".equals(request.getMethod()) &&
            ("/api/resolve-video.php".equals(path) || "/api/fetch-image.php".equals(path))) return null;
        if (!"GET".equals(request.getMethod())) return missing();
        // Retire the hosted service worker rather than ever running remote shell code.
        if ("/sw.js".equals(path)) return text("application/javascript",
            "self.addEventListener('install',e=>self.skipWaiting());" +
            "self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));");
        if ("/".equals(path)) path = "/index.html";
        if (path == null || !path.matches("/[a-zA-Z0-9][a-zA-Z0-9._/-]*") || path.contains("..") || path.contains("//")) return missing();
        try {
            String mime = "application/octet-stream";
            if (path.endsWith(".html")) mime = "text/html";
            else if (path.endsWith(".js")) mime = "application/javascript";
            else if (path.endsWith(".css")) mime = "text/css";
            else if (path.endsWith(".json") || path.endsWith(".webmanifest")) mime = "application/json";
            else if (path.endsWith(".png")) mime = "image/png";
            else if (path.endsWith(".ico")) mime = "image/x-icon";
            return new WebResourceResponse(mime, mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") ? "UTF-8" : null,
                200, "OK", Collections.singletonMap("Cache-Control", "no-store"), assets.open("www" + path));
        } catch (IOException missing) { return missing(); }
    }
    private static WebResourceResponse text(String mime, String body) {
        return new WebResourceResponse(mime, "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"),
            new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }
    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.singletonMap("Cache-Control", "no-store"),
            new ByteArrayInputStream(new byte[0]));
    }
}
