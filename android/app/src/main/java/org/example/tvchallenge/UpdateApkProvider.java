package org.example.tvchallenge;

import android.content.*;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.FileNotFoundException;

/** Shares only the verified update, using a one-URI read grant to the installer. */
public class UpdateApkProvider extends ContentProvider {

  static final Uri URI = Uri.parse(
    "content://org.example.tvchallenge.update/update.apk"
  );

  @Override
  public boolean onCreate() {
    return true;
  }

  @Override
  public String getType(Uri uri) {
    return URI.equals(uri) ? "application/vnd.android.package-archive" : null;
  }

  @Override
  public ParcelFileDescriptor openFile(Uri uri, String mode)
    throws FileNotFoundException {
    if (URI.equals(uri) && "r".equals(mode)) {
      try {
        synchronized (SelfUpdate.class) {
          return ParcelFileDescriptor.open(
            SelfUpdate.verifiedApk(getContext()),
            ParcelFileDescriptor.MODE_READ_ONLY
          );
        }
      } catch (Exception ignored) {}
    }
    throw new FileNotFoundException("Verified update unavailable");
  }

  @Override
  public Cursor query(
    Uri uri,
    String[] projection,
    String selection,
    String[] args,
    String order
  ) {
    if (!URI.equals(uri)) return null;
    try {
      long size = SelfUpdate.verifiedApk(getContext()).length();
      String[] columns =
        projection == null
          ? new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }
          : projection;
      MatrixCursor cursor = new MatrixCursor(columns);
      MatrixCursor.RowBuilder row = cursor.newRow();
      for (String column : columns) {
        if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add("update.apk");
        else if (OpenableColumns.SIZE.equals(column)) row.add(size);
        else row.add(null);
      }
      return cursor;
    } catch (Exception ignored) {
      return null;
    }
  }

  @Override
  public Uri insert(Uri uri, ContentValues values) {
    throw new UnsupportedOperationException();
  }

  @Override
  public int update(
    Uri uri,
    ContentValues values,
    String selection,
    String[] args
  ) {
    throw new UnsupportedOperationException();
  }

  @Override
  public int delete(Uri uri, String selection, String[] args) {
    throw new UnsupportedOperationException();
  }
}
