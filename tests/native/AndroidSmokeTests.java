package com.harry.redditlurker.tests;

import android.app.Instrumentation;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.harry.redditlurker.LocalAssets;
import com.harry.redditlurker.AppUpdater;
import com.harry.redditlurker.UpdateSpec;
import org.json.JSONObject;
import java.net.URL;
import java.net.HttpURLConnection;
import java.lang.reflect.Method;
import java.lang.reflect.Field;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Runs against the installed APK with WebView networking completely blocked. */
public class AndroidSmokeTests extends Instrumentation {
    private boolean checkDownload;
    @Override public void onCreate(Bundle args) { super.onCreate(args); checkDownload = "true".equals(args.getString("download")); start(); }
    private static WebResourceRequest request(String path, boolean main, String method) {
        return new WebResourceRequest() {
            public Uri getUrl() { return Uri.parse("https://" + LocalAssets.HOST + path); }
            public boolean isForMainFrame() { return main; }
            public boolean isRedirect() { return false; }
            public boolean hasGesture() { return false; }
            public String getMethod() { return method; }
            public Map<String, String> getRequestHeaders() { return Collections.emptyMap(); }
        };
    }
    private static void require(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    private static String read(InputStream input) throws Exception {
        try (InputStream stream = input) {
            ByteArrayOutputStream result = new ByteArrayOutputStream();
            byte[] bytes = new byte[4096]; int count;
            while ((count = stream.read(bytes)) != -1) result.write(bytes, 0, count);
            return result.toString("UTF-8");
        }
    }
    @Override public void onStart() {
        Bundle result = new Bundle();
        WebView[] view = new WebView[1];
        try {
            Context context = getTargetContext();
            LocalAssets local = new LocalAssets(context.getAssets());
            WebResourceResponse page = local.intercept(request("/index.html", true, "GET"));
            require(page.getStatusCode() == 200, "Local HTML is missing");
            String html = read(page.getData());
            require(html.contains("window.__REDDIT_LURKER_NATIVE__=true"), "Native build marker missing");
            Matcher assets = Pattern.compile("(?:src|href)=\"(?:\\./)?([^\"]+)\"").matcher(html);
            int count = 0;
            while (assets.find()) {
                WebResourceResponse asset = local.intercept(request("/" + assets.group(1), false, "GET"));
                require(asset != null && asset.getStatusCode() == 200 && asset.getData().read() != -1, "Missing packaged asset: " + assets.group(1));
                asset.getData().close(); count++;
            }
            require(count >= 5, "Too few packaged assets");
            require(local.intercept(request("/assets/missing.js", false, "GET")).getStatusCode() == 404, "Missing assets fall back to the server");
            require(local.intercept(request("/%2e%2e/private", false, "GET")).getStatusCode() == 404, "Traversal accepted");
            require(local.intercept(request("/api/fetch-image.php", true, "GET")).getStatusCode() == 404, "Remote main-frame content accepted");
            require(local.intercept(request("/api/fetch-image.php", false, "POST")).getStatusCode() == 404, "Remote write accepted");
            require(local.intercept(request("/api/fetch-image.php", false, "GET")) == null, "Image data helper blocked");
            CountDownLatch loaded = new CountDownLatch(1);
            AtomicReference<String> rendered = new AtomicReference<>();
            runOnMainSync(() -> {
                WebView web = new WebView(context); view[0] = web;
                web.getSettings().setJavaScriptEnabled(true);
                web.getSettings().setDomStorageEnabled(true);
                web.getSettings().setBlockNetworkLoads(true);
                web.setWebViewClient(new WebViewClient() {
                    @Override public WebResourceResponse shouldInterceptRequest(WebView web, WebResourceRequest request) { return local.intercept(request); }
                    @Override public void onPageFinished(WebView web, String url) {
                        web.evaluateJavascript("window.__REDDIT_LURKER_NATIVE__===true && document.getElementById('root').children.length>0",
                            value -> { rendered.set(value); loaded.countDown(); });
                    }
                });
                web.loadUrl(LocalAssets.START_URL);
            });
            require(loaded.await(40, TimeUnit.SECONDS), "Offline WebView timed out");
            require("true".equals(rendered.get()), "Offline React interface failed to render");
            String downloadResult = "";
            if (checkDownload) {
                HttpURLConnection connection = (HttpURLConnection) new URL(UpdateSpec.MANIFEST_URL).openConnection();
                connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
                JSONObject json;
                try { json = new JSONObject(read(connection.getInputStream())); } finally { connection.disconnect(); }
                UpdateSpec spec = new UpdateSpec(json.getLong("versionCode"), json.getString("versionName"), json.getString("url"), json.getString("sha256"), json.getLong("size"));
                require(spec.versionCode > context.getPackageManager().getPackageInfo(context.getPackageName(), 0).getLongVersionCode(), "Download test needs a newer published version");
                Activity activity = startActivitySync(new Intent().setClassName(context, "com.harry.redditlurker.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                AppUpdater[] updater = new AppUpdater[1];
                Method download = AppUpdater.class.getDeclaredMethod("download", UpdateSpec.class); download.setAccessible(true);
                Field ready = AppUpdater.class.getDeclaredField("ready"); ready.setAccessible(true);
                AtomicReference<UpdateSpec> complete = new AtomicReference<>();
                try {
                    runOnMainSync(() -> {
                        updater[0] = new AppUpdater(activity);
                        try { download.invoke(updater[0], spec); } catch (Exception error) { throw new RuntimeException(error); }
                    });
                    long deadline = System.currentTimeMillis() + 60000;
                    while (complete.get() == null && System.currentTimeMillis() < deadline) {
                        runOnMainSync(() -> { try { complete.set((UpdateSpec) ready.get(updater[0])); } catch (Exception error) { throw new RuntimeException(error); } });
                        Thread.sleep(100);
                    }
                    require(complete.get() != null && complete.get().versionCode == spec.versionCode, "Updater did not finish download/checksum/package/signing verification");
                    downloadResult = "PASS: native updater downloaded " + spec.versionName + " from the published manifest and accepted its size, SHA-256, package, version and signing certificate.\n";
                } finally { runOnMainSync(() -> { if (updater[0] != null) updater[0].destroy(); }); }
            }
            result.putString("stream", "PASS: installed APK serves all app assets locally; no remote asset fallback; React renders with networking blocked.\n" + downloadResult);
            finish(-1, result);
        } catch (Throwable error) {
            result.putString("stream", "FAIL: " + error.getClass().getSimpleName() + ": " + error.getMessage() + "\n");
            finish(1, result);
        } finally { if (view[0] != null) runOnMainSync(() -> view[0].destroy()); }
    }
}
