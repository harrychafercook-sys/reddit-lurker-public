package com.harry.redditlurker;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class AppUpdater {
    private final Activity activity;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private long lastCheck;
    private boolean checking, downloading, waitingForPermission;
    private volatile boolean closed, cancelled;
    private AlertDialog offer, permissionDialog;
    private ProgressDialog progress;
    private UpdateSpec ready;
    public AppUpdater(Activity activity) { this.activity = activity; }
    private void post(Runnable action) {
        activity.runOnUiThread(() -> { if (!closed && !activity.isFinishing()) action.run(); });
    }
    private void message(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }
    public void resume() {
        if (waitingForPermission) {
            waitingForPermission = false;
            if (activity.getPackageManager().canRequestPackageInstalls()) installReady();
            else message("Installation permission was not enabled. Use Check for updates to try again.");
            return;
        }
        check(false);
    }
    public void check(final boolean manual) {
        if (closed || checking || downloading || (offer != null && offer.isShowing())) return;
        if (!manual && lastCheck != 0 && SystemClock.elapsedRealtime() - lastCheck < 30 * 60 * 1000L) return;
        checking = true;
        if (manual) message("Checking for updates…");
        lastCheck = SystemClock.elapsedRealtime();
        io.execute(() -> {
            try {
                HttpURLConnection connection = open(UpdateSpec.MANIFEST_URL);
                UpdateSpec spec;
                try (InputStream input = connection.getInputStream()) {
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    byte[] bytes = new byte[4096]; int count;
                    while ((count = input.read(bytes)) != -1) {
                        if (closed || output.size() + count > 65536) throw new IOException("Invalid manifest");
                        output.write(bytes, 0, count);
                    }
                    JSONObject json = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
                    spec = new UpdateSpec(json.getLong("versionCode"), json.getString("versionName"),
                        json.getString("url"), json.getString("sha256"), json.getLong("size"));
                } finally { connection.disconnect(); }
                PackageInfo installed = installed();
                final UpdateSpec update = spec;
                post(() -> {
                    checking = false;
                    if (update.versionCode > installed.getLongVersionCode()) showOffer(update, installed.versionName);
                    else if (manual) message("Reddit Lurker " + installed.versionName + " is up to date.");
                });
            } catch (Exception error) {
                post(() -> {
                    checking = false;
                    // Retry sooner following a connection failure; reading stays available.
                    lastCheck = SystemClock.elapsedRealtime() - 25 * 60 * 1000L;
                    if (manual) message("Could not check for updates. Check your connection and try again.");
                });
            }
        });
    }
    private void showOffer(UpdateSpec spec, String installedVersion) {
        offer = new AlertDialog.Builder(activity).setTitle("Your app is out of date")
            .setMessage("Reddit Lurker " + spec.versionName + " is available. You have " + installedVersion +
                ".\n\nDownload the update, then approve installation in Android. Your saved settings will be kept.")
            .setNegativeButton("Later", (dialog, which) -> {})
            .setPositiveButton("Download update", (dialog, which) -> download(spec)).create();
        offer.show();
    }
    private File directory() throws IOException {
        File directory = new File(activity.getCacheDir(), "app-updates");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("No update cache");
        return directory;
    }
    private void download(final UpdateSpec spec) {
        if (downloading || closed) return;
        downloading = true; cancelled = false;
        progress = new ProgressDialog(activity);
        progress.setTitle("Downloading Reddit Lurker " + spec.versionName);
        progress.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
        progress.setMax(100); progress.setCancelable(true);
        progress.setOnCancelListener(dialog -> cancelled = true);
        progress.show();
        io.execute(() -> {
            File partial = null;
            try {
                File directory = directory();
                partial = new File(directory, "download.part");
                HttpURLConnection connection = open(spec.url);
                long received = 0, deadline = SystemClock.elapsedRealtime() + 6 * 60 * 1000L, lastProgress = 0;
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                    if (connection.getContentLengthLong() != -1 && connection.getContentLengthLong() != spec.size) throw new IOException("Unexpected update size");
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        received += count;
                        if (closed || cancelled || received > spec.size || SystemClock.elapsedRealtime() > deadline) throw new IOException("Download interrupted");
                        digest.update(buffer, 0, count); output.write(buffer, 0, count);
                        if (SystemClock.elapsedRealtime() - lastProgress > 150) {
                            lastProgress = SystemClock.elapsedRealtime();
                            final int percent = (int) (received * 100 / spec.size);
                            post(() -> { if (progress != null) progress.setProgress(percent); });
                        }
                    }
                    output.getFD().sync();
                } finally { connection.disconnect(); }
                if (received != spec.size || !hex(digest.digest()).equals(spec.sha256) || cancelled || closed) throw new IOException("Update checksum mismatch");
                verifyPackage(partial, spec);
                File complete = new File(directory, "latest.apk");
                if (complete.exists() && !complete.delete()) throw new IOException("Cannot replace update");
                if (!partial.renameTo(complete)) throw new IOException("Cannot finish update");
                partial = null;
                post(() -> { downloading = false; dismissProgress(); ready = spec; installReady(); });
            } catch (Exception error) {
                post(() -> {
                    downloading = false; dismissProgress();
                    if (!cancelled) message("The update could not be downloaded or verified. Check your connection and free space, then try again.");
                });
            } finally { if (partial != null) partial.delete(); }
        });
    }
    private void installReady() {
        if (ready == null || closed) return;
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            if (permissionDialog != null && permissionDialog.isShowing()) return;
            permissionDialog = new AlertDialog.Builder(activity).setTitle("Allow this app to install updates")
                .setMessage("Android needs you to allow updates from Reddit Lurker. Enable Allow from this source, then return here to install.")
                .setNegativeButton("Later", (dialog, which) -> {})
                .setPositiveButton("Open settings", (dialog, which) -> {
                    try {
                        waitingForPermission = true;
                        activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
                    } catch (Exception error) { waitingForPermission = false; message("Could not open installation settings."); }
                }).create();
            permissionDialog.show();
            return;
        }
        // Recheck the exact cached bytes before granting the installer read access.
        final UpdateSpec spec = ready;
        io.execute(() -> {
            try {
                File apk = new File(directory(), "latest.apk");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream input = new FileInputStream(apk)) {
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
                }
                if (apk.length() != spec.size || !hex(digest.digest()).equals(spec.sha256)) throw new IOException("Cached update changed");
                verifyPackage(apk, spec);
                post(() -> {
                    Uri uri = Uri.parse("content://" + activity.getPackageName() + ".updates/latest.apk");
                    Intent install = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    install.setClipData(ClipData.newRawUri("Reddit Lurker update", uri));
                    try { activity.startActivity(install); }
                    catch (Exception error) { message("Android could not open the update installer."); }
                });
            } catch (Exception error) { post(() -> message("The saved update is no longer valid. Check for updates to download it again.")); }
        });
    }
    private PackageInfo installed() throws PackageManager.NameNotFoundException {
        return activity.getPackageManager().getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
    }
    private void verifyPackage(File apk, UpdateSpec spec) throws Exception {
        PackageInfo current = installed();
        PackageInfo candidate = activity.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (candidate == null || !activity.getPackageName().equals(candidate.packageName) ||
            candidate.getLongVersionCode() != spec.versionCode || !spec.versionName.equals(candidate.versionName) ||
            candidate.getLongVersionCode() <= current.getLongVersionCode() || candidate.applicationInfo == null ||
            candidate.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT || candidate.signingInfo == null || current.signingInfo == null) throw new IOException("Incompatible update");
        HashSet<Signature> expected = new HashSet<>(Arrays.asList(current.signingInfo.getApkContentsSigners()));
        HashSet<Signature> actual = new HashSet<>(Arrays.asList(candidate.signingInfo.getApkContentsSigners()));
        if (expected.isEmpty() || !expected.equals(actual)) throw new IOException("Different signing certificate");
    }
    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(10000); connection.setReadTimeout(20000);
        connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("Cache-Control", "no-cache");
        connection.setRequestProperty("User-Agent", "RedditLurker/Android-updater");
        if (connection.getResponseCode() != 200) { connection.disconnect(); throw new IOException("Update server unavailable"); }
        return connection;
    }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
    private void dismissProgress() { if (progress != null) { progress.dismiss(); progress = null; } }
    public void destroy() {
        closed = true; cancelled = true;
        if (offer != null) offer.dismiss();
        if (permissionDialog != null) permissionDialog.dismiss();
        dismissProgress(); io.shutdownNow();
    }
}
