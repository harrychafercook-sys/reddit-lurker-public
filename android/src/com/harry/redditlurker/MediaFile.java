package com.harry.redditlurker;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

// Shared allowlist for transfer validation and the read-only content provider.
public final class MediaFile {
    public static String extension(String mime) throws IOException {
        switch (mime) {
            case "video/mp4": return "mp4";
            case "image/jpeg": return "jpg";
            case "image/png": return "png";
            case "image/gif": return "gif";
            case "image/webp": return "webp";
            case "image/avif": return "avif";
            default: throw new IOException("Unsupported media type");
        }
    }
    public static String mime(String filename) throws IOException {
        switch (filename.substring(filename.lastIndexOf('.') + 1)) {
            case "mp4": return "video/mp4";
            case "jpg": return "image/jpeg";
            case "png": return "image/png";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "avif": return "image/avif";
            default: throw new IOException("Unsupported media extension");
        }
    }
    public static String displayName(String mime) throws IOException {
        return (mime.startsWith("image/") ? "reddit-image." : "reddit-video.") + extension(mime);
    }
    private static boolean text(byte[] header, int offset, String value) {
        byte[] bytes = value.getBytes(StandardCharsets.US_ASCII);
        if (header.length < offset + bytes.length) return false;
        for (int i = 0; i < bytes.length; i++) if (header[offset + i] != bytes[i]) return false;
        return true;
    }
    public static void validate(byte[] header, String mime) throws IOException {
        boolean valid;
        switch (mime) {
            case "video/mp4": valid = header.length >= 12 && text(header, 4, "ftyp"); break;
            case "image/jpeg": valid = header.length >= 3 && (header[0] & 255) == 255 && (header[1] & 255) == 216 && (header[2] & 255) == 255; break;
            case "image/png": valid = header.length >= 8 && (header[0] & 255) == 137 && text(header, 1, "PNG\r\n\u001a\n"); break;
            case "image/gif": valid = text(header, 0, "GIF87a") || text(header, 0, "GIF89a"); break;
            case "image/webp": valid = text(header, 0, "RIFF") && text(header, 8, "WEBP"); break;
            case "image/avif": valid = text(header, 4, "ftyp") && (text(header, 8, "avif") || text(header, 8, "avis")); break;
            default: valid = false;
        }
        if (!valid) throw new IOException("File content does not match its media type");
    }
}
