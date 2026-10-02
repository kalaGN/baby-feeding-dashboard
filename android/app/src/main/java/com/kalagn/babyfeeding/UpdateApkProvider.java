package com.kalagn.babyfeeding;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Grants the installer read access to one APK, never to dashboard records. */
public final class UpdateApkProvider extends ContentProvider {
    static File apk(android.content.Context context) { return new File(context.getCacheDir(), "update.apk"); }
    private File file(Uri uri) {
        if (!"/update.apk".equals(uri.getPath()) || uri.getQuery() != null || uri.getFragment() != null)
            throw new IllegalArgumentException("Unsupported APK path");
        return apk(getContext());
    }
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { file(uri); return "application/vnd.android.package-archive"; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        File file = file(uri);
        String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns);
        Object[] values = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) values[i] = "baby-feeding-dashboard.apk";
            if (OpenableColumns.SIZE.equals(columns[i])) values[i] = file.length();
        }
        cursor.addRow(values); return cursor;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
}
