package com.harry.redditlurker;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebView;
import android.widget.Toast;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class MediaBridge {
    private static final long MAX_BYTES = 96L * 1024 * 1024;
    private static final Uri ORIGIN = Uri.parse("https://rlurker.english-grammar-homework.com");
    private final Activity activity;
    private final WebView webView;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private WebMessagePort port;
    private volatile int generation;
    // Transfer state is accessed only on the single IO thread.
    private String session, action, name, mime;
    private long expected, received;
    private File partial;
    private FileOutputStream stream;

    public MediaBridge(Activity activity, WebView webView) {
        this.activity = activity; this.webView = webView;
        io.execute(new Runnable() { @Override public void run() { try { prune(0); } catch (IOException ignored) {} } });
    }
    public void disconnect() {
        generation++;
        if (port != null) { port.close(); port = null; }
        io.execute(new Runnable() { @Override public void run() { abandon(); } });
    }
    public void connect() {
        disconnect();
        final int current = generation;
        WebMessagePort[] ports = webView.createWebMessageChannel();
        port = ports[0];
        final WebMessagePort replyPort = port;
        port.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override public void onMessage(WebMessagePort source, WebMessage message) {
                final String data = message.getData();
                if (current != generation || data == null || data.length() > 70000) return;
                io.execute(new Runnable() {
                    @Override public void run() {
                        if (current != generation) return;
                        JSONObject reply = new JSONObject();
                        try {
                            JSONObject command = new JSONObject(data);
                            reply.put("id", command.getLong("id"));
                            handle(command, current);
                            reply.put("ok", true);
                        } catch (Exception error) {
                            abandon();
                            try { reply.put("error", "Could not save or share this file. Check free space and try again."); } catch (Exception ignored) {}
                        }
                        final String result = reply.toString();
                        webView.post(new Runnable() { @Override public void run() {
                            if (current == generation) replyPort.postMessage(new WebMessage(result));
                        } });
                    }
                });
            }
        });
        webView.postWebMessage(new WebMessage("reddit-lurker-media-v2", new WebMessagePort[]{ports[1]}), ORIGIN);
    }
    private File directory() throws IOException {
        File directory = new File(activity.getCacheDir(), "shared-media");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cache directory unavailable");
        return directory;
    }
    private void prune(long incoming) throws IOException {
        File[] files = directory().listFiles();
        if (files == null) return;
        Arrays.sort(files, new Comparator<File>() { @Override public int compare(File a, File b) { return Long.compare(a.lastModified(), b.lastModified()); } });
        long total = incoming;
        for (File file : files) if (file.isFile()) total += file.length();
        for (File file : files) {
            if (!file.isFile()) continue;
            if (file.getName().endsWith(".part") || System.currentTimeMillis() - file.lastModified() > 86400000L || total > 128L * 1024 * 1024) {
                long size = file.length();
                if (file.delete()) total -= size;
            }
        }
        if (total > 128L * 1024 * 1024) throw new IOException("Not enough cache space");
    }
    private void handle(JSONObject command, final int current) throws Exception {
        String op = command.getString("op");
        String requested = command.getString("session");
        if (!requested.matches("[a-f0-9-]{36}")) throw new IOException("Invalid session");
        if ("begin".equals(op)) {
            if (stream != null) throw new IOException("Transfer already running");
            expected = command.getLong("size");
            action = command.getString("action");
            mime = command.getString("mime");
            String extension = MediaFile.extension(mime);
            long limit = mime.startsWith("image/") ? 24L * 1024 * 1024 : MAX_BYTES;
            if (expected <= 0 || expected > limit ||
                !("share".equals(action) || "download".equals(action))) throw new IOException("Unsupported transfer");
            name = command.optString("name", MediaFile.displayName(mime));
            if (!name.matches("[a-zA-Z0-9_-]{1,80}\\." + extension)) name = MediaFile.displayName(mime);
            prune(expected);
            session = requested;
            received = 0;
            partial = new File(directory(), session + ".part");
            if (!partial.createNewFile()) throw new IOException("Duplicate transfer");
            stream = new FileOutputStream(partial);
            return;
        }
        if (!requested.equals(session)) throw new IOException("Unknown transfer");
        if ("cancel".equals(op)) { abandon(); return; }
        if ("chunk".equals(op)) {
            if (stream == null || command.getLong("offset") != received) throw new IOException("Out-of-order transfer");
            byte[] bytes = Base64.decode(command.getString("data"), Base64.NO_WRAP);
            if (bytes.length == 0 || bytes.length > 49152 || received + bytes.length > expected) throw new IOException("Invalid chunk");
            stream.write(bytes);
            received += bytes.length;
            return;
        }
        if (!"finish".equals(op) || stream == null || received != expected) throw new IOException("Incomplete file");
        stream.close(); stream = null;
        // Match the file signature to its declared MIME before sharing it.
        try (FileInputStream input = new FileInputStream(partial)) {
            byte[] header = new byte[(int) Math.min(16, expected)];
            if (input.read(header) != header.length) throw new IOException("Invalid media");
            MediaFile.validate(header, mime);
        }
        if (current != generation) { abandon(); return; }
        if ("download".equals(action)) {
            saveDownload(partial, name, mime);
            abandon();
            webView.post(new Runnable() { @Override public void run() {
                if (current == generation) Toast.makeText(activity, "File saved in Downloads/Reddit Lurker", Toast.LENGTH_LONG).show();
            } });
        } else {
            File ready = new File(directory(), session + "." + MediaFile.extension(mime));
            if (ready.exists() || !partial.renameTo(ready)) throw new IOException("Could not finish file");
            partial = null; session = null;
            final Uri uri = Uri.parse("content://" + activity.getPackageName() + ".media/" + ready.getName());
            final String shareMime = mime;
            final String label = mime.startsWith("image/") ? "image" : "video";
            webView.post(new Runnable() { @Override public void run() {
                if (current != generation || activity.isFinishing()) return;
                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType(shareMime);
                share.putExtra(Intent.EXTRA_STREAM, uri);
                share.setClipData(ClipData.newRawUri("Reddit " + label, uri));
                share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { activity.startActivity(Intent.createChooser(share, "Share " + label)); }
                catch (Exception error) { Toast.makeText(activity, "No app available to share this " + label, Toast.LENGTH_LONG).show(); }
            } });
        }
    }
    private void saveDownload(File file, String filename, String mime) throws IOException {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        values.put(MediaStore.Downloads.MIME_TYPE, mime);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Reddit Lurker");
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("Downloads unavailable");
        boolean complete = false;
        try {
            try (FileInputStream input = new FileInputStream(file); OutputStream output = activity.getContentResolver().openOutputStream(uri)) {
                if (output == null) throw new IOException("Download could not be opened");
                byte[] buffer = new byte[65536]; int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
            ContentValues published = new ContentValues(); published.put(MediaStore.Downloads.IS_PENDING, 0);
            if (activity.getContentResolver().update(uri, published, null, null) != 1) throw new IOException("Download could not be finished");
            complete = true;
        } finally { if (!complete) activity.getContentResolver().delete(uri, null, null); }
    }
    private void abandon() {
        if (stream != null) try { stream.close(); } catch (IOException ignored) {}
        stream = null;
        if (partial != null) partial.delete();
        partial = null; session = null; received = 0;
    }
    public void destroy() { disconnect(); io.shutdown(); }
}
