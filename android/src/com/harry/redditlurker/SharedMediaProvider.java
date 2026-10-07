package com.harry.redditlurker;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

// Only completed allowlisted media in this cache directory can be shared.
public class SharedMediaProvider extends ContentProvider {
    private File file(Uri uri) throws FileNotFoundException {
        String path = uri.getPath();
        if (path == null || !path.matches("/[a-f0-9-]{36}\\.(mp4|jpg|png|gif|webp|avif)")) throw new FileNotFoundException();
        File result = new File(new File(getContext().getCacheDir(), "shared-media"), path.substring(1));
        if (!result.isFile()) throw new FileNotFoundException();
        return result;
    }
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) {
        try { return MediaFile.mime(file(uri).getName()); }
        catch (IOException error) { return null; }
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read-only media");
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        try {
            File media = file(uri);
            String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
            MatrixCursor cursor = new MatrixCursor(columns);
            MatrixCursor.RowBuilder row = cursor.newRow();
            for (String column : columns) {
                if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add(MediaFile.displayName(MediaFile.mime(media.getName())));
                else if (OpenableColumns.SIZE.equals(column)) row.add(media.length());
                else row.add(null);
            }
            return cursor;
        } catch (IOException error) { return null; }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
