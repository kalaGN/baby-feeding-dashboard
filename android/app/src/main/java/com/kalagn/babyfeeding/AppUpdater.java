package com.kalagn.babyfeeding;

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
import android.provider.Settings;
import android.widget.Toast;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class AppUpdater {
    static final int INSTALL_PERMISSION = 703, INSTALL_RESULT = 704;
    private final Activity activity;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private boolean busy, foreground, waitingPermission, skipNextCheck;
    private volatile boolean closed, cancelled;
    private AlertDialog prompt;
    private ProgressDialog progress;
    private ReleaseInfo downloaded;

    AppUpdater(Activity activity) { this.activity = activity; }
    void foreground(boolean active) { foreground = active; }
    void check(boolean manual) {
        if (!manual && skipNextCheck) { skipNextCheck = false; return; }
        if (manual && downloaded != null && !busy && !waitingPermission && prompt == null) { install(); return; }
        if (closed || busy || waitingPermission || prompt != null || progress != null) {
            if (manual) toast("正在处理更新，请稍候"); return;
        }
        String today = new java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.ROOT).format(new java.util.Date());
        android.content.SharedPreferences preferences = activity.getSharedPreferences("dashboard",Activity.MODE_PRIVATE);
        if (!manual && today.equals(preferences.getString("updateCheckDay", ""))) return;
        preferences.edit().putString("updateCheckDay",today).apply();
        busy = true;
        if (manual) toast("正在检查更新…");
        worker.execute(() -> {
            try {
                PackageInfo installed = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
                HttpURLConnection connection = connect(new URL("https://api.github.com/repos/" + ReleaseInfo.REPO + "/releases/latest"));
                String json;
                try { json = StateStore.read(connection.getInputStream()); }
                finally { connection.disconnect(); }
                ReleaseInfo release = ReleaseInfo.parse(json, installed.versionName);
                ui(() -> {
                    busy = false;
                    if (!foreground) return;
                    if (release == null) { if (manual) toast("已经是最新版本"); return; }
                    String notes = release.notes.length() > 1800 ? release.notes.substring(0,1800) + "…" : release.notes;
                    prompt = new AlertDialog.Builder(activity).setTitle("发现新版本 " + release.version)
                        .setMessage(notes + "\n\n下载后由系统确认覆盖安装，现有记录保留。")
                        .setPositiveButton("立即更新", (d, which) -> download(release))
                        .setNegativeButton("稍后", null).create();
                    prompt.setOnDismissListener(d -> prompt = null); prompt.show();
                });
            } catch (Exception error) { ui(() -> { busy = false; if (manual) toast("检查失败，请检查网络后重试"); }); }
        });
    }
    private HttpURLConnection connect(URL url) throws Exception {
        for (int i = 0; i < 5; i++) {
            String host = url.getHost();
            if (!"https".equals(url.getProtocol()) || !(host.equals("api.github.com") || host.equals("github.com") || host.equals("release-assets.githubusercontent.com") || host.equals("objects.githubusercontent.com"))) throw new IOException("下载地址不受支持");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(8000); connection.setReadTimeout(15000); connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "BabyFeedingDashboard"); connection.setRequestProperty("Accept", "application/vnd.github+json");
            int status = connection.getResponseCode();
            if (status == 200) return connection;
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = connection.getHeaderField("Location"); connection.disconnect();
                if (location == null) throw new IOException("缺少下载地址"); url = new URL(url,location);
            } else { connection.disconnect(); throw new IOException("HTTP " + status); }
        }
        throw new IOException("下载跳转过多");
    }
    private void download(ReleaseInfo release) {
        cancelled = false; busy = true;
        progress = new ProgressDialog(activity); progress.setTitle("下载更新"); progress.setMessage("正在下载 " + release.version + "…");
        progress.setCancelable(false);
        progress.setButton(ProgressDialog.BUTTON_NEGATIVE,"取消",(d,which) -> cancelled = true); progress.show();
        worker.execute(() -> {
            File temp = new File(activity.getCacheDir(), "update.apk.partial");
            try {
                HttpURLConnection connection = connect(new URL(release.url));
                try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(temp)) {
                    byte[] buffer = new byte[16384]; long count = 0; int length;
                    while ((length = in.read(buffer)) != -1) {
                        if (closed || cancelled || Thread.currentThread().isInterrupted()) throw new IOException("下载已取消");
                        count += length; if (count > release.size) throw new IOException("安装包大小异常");
                        out.write(buffer,0,length);
                    }
                    if (count != release.size) throw new IOException("安装包下载不完整"); out.getFD().sync();
                } finally { connection.disconnect(); }
                verify(temp,release);
                if (closed || cancelled) throw new IOException("下载已取消");
                if (!temp.renameTo(UpdateApkProvider.apk(activity))) throw new IOException("无法保存安装包");
                ui(() -> { busy = false; dismissProgress(); downloaded = release; if (foreground) install(); else toast("更新已下载，请在设置中检查更新后安装"); });
            } catch (Exception error) {
                temp.delete(); ui(() -> { busy = false; dismissProgress(); if (!cancelled) toast("更新失败：" + error.getMessage()); });
            }
        });
    }
    private void verify(File file, ReleaseInfo release) throws Exception {
        if (file.length() != release.size) throw new IOException("安装包大小不符");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[16384]; int length;
            while ((length = in.read(buffer)) != -1) digest.update(buffer,0,length);
        }
        StringBuilder hash = new StringBuilder(); for(byte b : digest.digest()) hash.append(String.format(java.util.Locale.ROOT,"%02x", b & 255));
        if (!release.sha256.equalsIgnoreCase(hash.toString())) throw new IOException("安装包校验失败");
        PackageManager manager = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo current = manager.getPackageInfo(activity.getPackageName(),flags);
        PackageInfo next = manager.getPackageArchiveInfo(file.getAbsolutePath(),flags);
        if (next == null || !current.packageName.equals(next.packageName) || !release.version.equals(next.versionName)) throw new IOException("安装包版本或包名不符");
        long currentCode = Build.VERSION.SDK_INT >= 28 ? current.getLongVersionCode() : current.versionCode;
        long nextCode = Build.VERSION.SDK_INT >= 28 ? next.getLongVersionCode() : next.versionCode;
        if (nextCode <= currentCode) throw new IOException("安装包版本未提高");
        Signature[] a = Build.VERSION.SDK_INT >= 28 && current.signingInfo != null ? current.signingInfo.getApkContentsSigners() : current.signatures;
        Signature[] b = Build.VERSION.SDK_INT >= 28 && next.signingInfo != null ? next.signingInfo.getApkContentsSigners() : next.signatures;
        if (a == null || b == null || a.length != 1 || b.length != 1 || !Arrays.equals(a[0].toByteArray(),b[0].toByteArray())) throw new IOException("安装包签名不符");
    }
    private void install() {
        if (downloaded == null) return;
        try {
            verify(UpdateApkProvider.apk(activity),downloaded);
            if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
                prompt = new AlertDialog.Builder(activity).setTitle("允许安装更新")
                    .setMessage("请在下一页允许“喝奶看板”安装未知应用，返回后继续安装。")
                    .setPositiveButton("去设置", (d,which) -> {
                        try { waitingPermission = true; skipNextCheck = true; activity.startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())), INSTALL_PERMISSION); }
                        catch (Exception error) { waitingPermission = false; toast("无法打开安装授权设置"); }
                    }).setNegativeButton("取消",null).create();
                prompt.setOnDismissListener(d -> prompt = null); prompt.show(); return;
            }
            Uri uri = Uri.parse("content://" + activity.getPackageName() + ".updates/update.apk");
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("APK",uri));
            waitingPermission = true; skipNextCheck = true;
            activity.startActivityForResult(intent, INSTALL_RESULT);
        } catch (Exception error) { waitingPermission = false; toast("无法安装更新：" + error.getMessage()); }
    }
    void installResult() { waitingPermission = false; downloaded = null; }
    void permissionResult() {
        waitingPermission = false;
        if (Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls()) install();
        else toast("未授权安装，现有版本可继续使用");
    }
    private void dismissProgress() { if (progress != null) { progress.dismiss(); progress = null; } }
    private void toast(String text) { if (!closed) Toast.makeText(activity,text,Toast.LENGTH_LONG).show(); }
    private void ui(Runnable action) { activity.runOnUiThread(() -> { if (!closed && !activity.isFinishing()) action.run(); }); }
    void close() { closed = true; cancelled = true; worker.shutdownNow(); if (prompt != null) prompt.dismiss(); dismissProgress(); }
}
