package com.harry.redditlurker;

import java.io.IOException;
import java.net.URI;

/** Pure validation shared by update discovery and the download path. */
public final class UpdateSpec {
    public static final String MANIFEST_URL = "https://english-grammar-homework.com/rlurker-downloads/latest.json";
    public static final long MAX_APK_BYTES = 128L * 1024 * 1024;
    public final long versionCode, size;
    public final String versionName, url, sha256;
    public UpdateSpec(long code, String name, String url, String hash, long size) throws IOException {
        if (code <= 0 || name == null || !name.matches("[0-9]{1,4}\\.[0-9]{1,2}\\.[0-9]{1,2}") ||
            hash == null || !hash.matches("[a-f0-9]{64}") || size <= 0 || size > MAX_APK_BYTES) throw new IOException("Invalid update metadata");
        String[] parts = name.split("\\.");
        long expected = Long.parseLong(parts[0]) * 10000 + Long.parseLong(parts[1]) * 100 + Long.parseLong(parts[2]);
        if (code != expected) throw new IOException("Inconsistent update version");
        validateUrl(url);
        this.versionCode = code; this.versionName = name; this.url = url; this.sha256 = hash; this.size = size;
    }
    public static void validateUrl(String url) throws IOException {
        try {
            URI uri = new URI(url);
            if (!"https".equals(uri.getScheme()) || !"english-grammar-homework.com".equals(uri.getHost()) ||
                uri.getRawUserInfo() != null || uri.getPort() != -1 || uri.getRawQuery() != null || uri.getRawFragment() != null ||
                !uri.getRawPath().matches("/rlurker-downloads/Reddit-Lurker-[0-9]+\\.[0-9]+\\.[0-9]+\\.apk")) throw new IOException("Untrusted update URL");
        } catch (Exception error) { throw new IOException("Invalid update URL", error); }
    }
}
