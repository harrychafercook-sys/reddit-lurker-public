package com.harry.redditlurker;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ServiceWorkerController;
import android.webkit.ServiceWorkerClient;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.FrameLayout;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.view.Gravity;
import android.window.OnBackInvokedDispatcher;
import android.window.OnBackInvokedCallback;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String HOST = LocalAssets.HOST;
    private static final String START_URL = LocalAssets.START_URL;
    private static final String BOOTSTRAP_URL = "https://" + HOST + "/native-bootstrap.html";
    private static final String LEGACY_URL = "https://appassets.androidplatform.net/migrate-settings.html";
    private static final String MIGRATION_PAGE = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body style='background:#0f172a;color:white;font-family:sans-serif'>Updating Reddit Lurker…</body></html>";
    private WebView webView;
    private FrameLayout root;
    private View fullScreen;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private int safeTop, safeBottom, safeLeft, safeRight;
    private int migrationStage;
    private String migrationCode;
    private String pendingSettings;
    private boolean clearInitialHistory = true;
    private View connectionError;
    private MediaBridge mediaBridge;
    private LocalAssets localAssets;
    private AppUpdater updater;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarDividerColor(Color.TRANSPARENT);
        getWindow().setNavigationBarContrastEnforced(false);
        getWindow().setStatusBarContrastEnforced(false);
        getWindow().setDecorFitsSystemWindows(false);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(15, 23, 42));
        webView = new WebView(this);
        localAssets = new LocalAssets(getAssets());
        updater = new AppUpdater(this);
        mediaBridge = new MediaBridge(this, webView, () -> updater.check(true));
        webView.setBackgroundColor(Color.rgb(15, 23, 42));
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        WindowInsetsController controller = getWindow().getInsetsController();
        if (controller != null) {
            controller.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMediaPlaybackRequiresUserGesture(true);
        // Content caches are managed and bounded by the app. Discard WebView's
        // independent HTTP/media cache on each launch as well as disabling writes.
        webView.clearCache(true);
        ServiceWorkerController workers = ServiceWorkerController.getInstance();
        workers.getServiceWorkerWebSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        workers.getServiceWorkerWebSettings().setAllowFileAccess(false);
        workers.getServiceWorkerWebSettings().setAllowContentAccess(false);
        workers.setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return localAssets.intercept(request);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return localAssets.intercept(request);
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) { mediaBridge.disconnect(); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isHosted(uri)) return false;
                if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException error) { Toast.makeText(MainActivity.this, "No browser available", Toast.LENGTH_SHORT).show(); }
                }
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (continueMigration(url)) return;
                if (migrationStage == 0 && START_URL.equals(url)) {
                    applySafeArea();
                    mediaBridge.connect();
                    if (clearInitialHistory) { view.clearHistory(); clearInitialHistory = false; }
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (migrationStage == 0 && request.isForMainFrame()) showConnectionError();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (migrationStage == 0 && request.isForMainFrame()) showConnectionError();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullScreen != null) { callback.onCustomViewHidden(); return; }
                fullScreen = view;
                fullScreenCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
                view.setPadding(safeLeft, safeTop, safeRight, safeBottom);
                webView.setVisibility(View.GONE);
            }
            @Override public void onHideCustomView() { closeFullScreen(); }
        });
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
          @Override public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            safeTop = bars.top;
            safeLeft = bars.left;
            safeRight = bars.right;
            boolean keyboard = insets.isVisible(WindowInsets.Type.ime());
            safeBottom = keyboard ? 0 : bars.bottom;
            FrameLayout.LayoutParams layout = (FrameLayout.LayoutParams) webView.getLayoutParams();
            int bottom = keyboard ? insets.getInsets(WindowInsets.Type.ime()).bottom : 0;
            if (layout.bottomMargin != bottom) { layout.bottomMargin = bottom; webView.setLayoutParams(layout); }
            applySafeArea();
            if (fullScreen != null) fullScreen.setPadding(safeLeft, safeTop, safeRight, safeBottom);
            return insets;
          }
        });
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
            OnBackInvokedDispatcher.PRIORITY_DEFAULT, new OnBackInvokedCallback() {
                @Override public void onBackInvoked() { navigateBack(); }
            });
        if (getPreferences(MODE_PRIVATE).getBoolean("hosted_storage_ready", false)) loadBundledApp();
        else beginMigration();
        root.requestApplyInsets();
    }

    private static boolean isHosted(Uri uri) {
        return LocalAssets.isAppOrigin(uri) && ("/".equals(uri.getPath()) || "/index.html".equals(uri.getPath()));
    }

    private void loadBundledApp() {
        // Retire the hosted shell's worker before navigation. Preserve credentials,
        // favourites and bounded content caches at their existing origin.
        String script = "(async function(){try{" +
            "if('serviceWorker' in navigator){var r=await navigator.serviceWorker.getRegistrations();await Promise.all(r.map(x=>x.unregister()));}" +
            "if('caches' in window){var n=await caches.keys();await Promise.all(n.filter(x=>x.startsWith('reddit-lurker-shell-%2F-')||x==='reddit-lurker-runtime-%2F').map(x=>caches.delete(x)));}" +
            "}finally{window.location.replace('" + START_URL + "');}})();";
        webView.loadDataWithBaseURL(BOOTSTRAP_URL, MIGRATION_PAGE.replace("</body>", "<script>" + script + "</script></body>"),
            "text/html", "UTF-8", BOOTSTRAP_URL);
    }

    private void beginMigration() {
        // Load only our static document at each origin. Settings stay in memory
        // and localStorage; they are never put in URLs, logs or a native JS bridge.
        try (InputStream input = getAssets().open("migrate-settings.js")) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            migrationCode = new String(output.toByteArray(), StandardCharsets.UTF_8);
            migrationStage = 1;
            webView.loadDataWithBaseURL(LEGACY_URL, MIGRATION_PAGE, "text/html", "UTF-8", LEGACY_URL);
        } catch (IOException error) { migrationFailed(); }
    }

    private boolean continueMigration(String url) {
        if (migrationStage == 1 && LEGACY_URL.equals(url)) {
            migrationStage = 2;
            webView.evaluateJavascript("(" + migrationCode + ").read()", new ValueCallback<String>() {
              @Override public void onReceiveValue(String result) {
                try { pendingSettings = new JSONObject(result).toString(); }
                catch (Exception error) { migrationFailed(); return; }
                migrationStage = 3;
                webView.loadDataWithBaseURL(START_URL, MIGRATION_PAGE, "text/html", "UTF-8", START_URL);
              }
            });
            return true;
        }
        if (migrationStage == 3 && START_URL.equals(url)) {
            migrationStage = 4;
            webView.evaluateJavascript("(" + migrationCode + ").write(" + pendingSettings + ")", new ValueCallback<String>() {
              @Override public void onReceiveValue(String result) {
                if (!"true".equals(result)) { migrationFailed(); return; }
                getPreferences(MODE_PRIVATE).edit().putBoolean("hosted_storage_ready", true).apply();
                finishMigration();
              }
            });
            return true;
        }
        return migrationStage != 0;
    }

    private void migrationFailed() {
        Toast.makeText(this, "Saved settings could not be copied. Your original settings are still kept.", Toast.LENGTH_LONG).show();
        finishMigration();
    }

    private void finishMigration() {
        pendingSettings = null;
        migrationCode = null;
        migrationStage = 0;
        loadBundledApp();
    }

    private void showConnectionError() {
        if (connectionError != null) return;
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(32 + safeLeft, 32 + safeTop, 32 + safeRight, 32 + safeBottom);
        panel.setBackgroundColor(Color.rgb(15, 23, 42));
        TextView message = new TextView(this);
        message.setText("Reddit Lurker could not load its installed files. Try again or reinstall the APK.");
        message.setTextColor(Color.WHITE);
        message.setTextSize(18);
        message.setGravity(Gravity.CENTER);
        panel.addView(message);
        Button retry = new Button(this);
        retry.setText("Retry");
        retry.setOnClickListener(new View.OnClickListener() {
          @Override public void onClick(View view) {
            root.removeView(connectionError);
            connectionError = null;
            loadBundledApp();
          }
        });
        panel.addView(retry);
        connectionError = panel;
        root.addView(panel, new FrameLayout.LayoutParams(-1, -1));
    }

    private void applySafeArea() {
        if (webView == null) return;
        float density = getResources().getDisplayMetrics().density;
        String script = "(function(){var s=document.documentElement.style;" +
            "s.setProperty('--native-safe-area-top','" + (safeTop / density) + "px');" +
            "s.setProperty('--native-safe-area-bottom','" + (safeBottom / density) + "px');" +
            "s.setProperty('--native-safe-area-left','" + (safeLeft / density) + "px');" +
            "s.setProperty('--native-safe-area-right','" + (safeRight / density) + "px');})();";
        webView.evaluateJavascript(script, null);
    }

    private void closeFullScreen() {
        if (fullScreen == null) return;
        root.removeView(fullScreen);
        fullScreen = null;
        webView.setVisibility(View.VISIBLE);
        fullScreenCallback.onCustomViewHidden();
        fullScreenCallback = null;
    }
    private void navigateBack() {
        if (fullScreen != null) closeFullScreen();
        else if (webView.canGoBack()) webView.goBack();
        else finish();
    }
    @Override public void onBackPressed() { navigateBack(); }
    @Override protected void onPause() { webView.onPause(); super.onPause(); }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
        if (updater != null) updater.resume();
    }
    @Override protected void onDestroy() {
        closeFullScreen();
        updater.destroy();
        mediaBridge.destroy();
        root.removeView(webView);
        webView.destroy();
        super.onDestroy();
    }
}
