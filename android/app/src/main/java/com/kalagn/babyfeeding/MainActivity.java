package com.kalagn.babyfeeding;

import android.app.Activity;
import android.app.AlertDialog;
import android.widget.Toast;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.FrameLayout;
import java.io.*;
import java.util.Collections;

public class MainActivity extends Activity {
    private static final String ORIGIN = "https://board.local";
    private WebView webView;
    private StateStore store;
    private AppUpdater updater;
    private static final int EXPORT_CSV = 701, IMPORT_CSV = 702;
    private String pendingCsv;
    private boolean filePickerOpen;


    public final class StorageBridge {
        @JavascriptInterface public String request(String method, String payload) { return store.request(method, payload); }
        @JavascriptInterface public String version() { try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception error) { return "未知"; } }
        @JavascriptInterface public String serverAddress() { return getSharedPreferences("dashboard", MODE_PRIVATE).getString("server", "http://192.168.0.104:4173"); }
        @JavascriptInterface public void openSettings() { runOnUiThread(() -> webView.evaluateJavascript("window.MilkSettings&&window.MilkSettings.open()", null)); }
        @JavascriptInterface public void checkUpdate() { runOnUiThread(() -> updater.check(true)); }
        @JavascriptInterface public void exportCsv(String csv, String name) { runOnUiThread(() -> createCsv(csv, name)); }
        @JavascriptInterface public void importCsv() { runOnUiThread(() -> chooseCsv()); }
        @JavascriptInterface public void readServer(String address) { runOnUiThread(() -> readServerRecords(address)); }
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        store = new StateStore(getFilesDir());
        updater = new AppUpdater(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(245, 242, 233));
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setUseWideViewPort(true);
        webView.addJavascriptInterface(new StorageBridge(), "AndroidStore");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !internal(request.getUrl()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !internal(Uri.parse(url)); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return asset(request.getUrl()); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, String url) { return asset(Uri.parse(url)); }
            @Override public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript("(function(){var b=document.getElementById('fullscreenButton');if(b)b.style.display='none';var f=document.querySelector('.footer span');if(f)f.textContent='记录保存在这台平板，无需电脑或网络';}())", null);
            }
        });
        setContentView(root);
        enterFullscreen(); loadBoard();
        android.content.SharedPreferences preferences = getSharedPreferences("dashboard", MODE_PRIVATE);
        if (savedInstanceState == null && preferences.contains("server") && !preferences.getBoolean("migrationPromptShown", false)) {
            preferences.edit().putBoolean("migrationPromptShown", true).apply();
            new AlertDialog.Builder(this).setTitle("导入旧记录？")
                .setMessage("旧记录仍保存在电脑。可先读取并查看条数，确认后导入到这台平板。也可以稍后在顶部“喝奶看板”右侧的设置中选择“备份与还原 → 从服务器还原”。")
                .setPositiveButton("打开备份与还原", (d, which) -> webView.evaluateJavascript("window.MilkSettings&&window.MilkSettings.open()", null)).setNegativeButton("暂不导入", null).show();
        }
    }
    private boolean internal(Uri uri) {
        return "https".equals(uri.getScheme()) && "board.local".equals(uri.getHost()) && uri.getPort() == -1;
    }
    private WebResourceResponse asset(Uri uri) {
        String path = uri.getPath();
        String file = "/".equals(path) ? "index.html" : path == null ? "" : path.substring(1);
        String mime;
        switch (file) {
            case "index.html": mime = "text/html"; break;
            case "style.css": mime = "text/css"; break;
            case "app.js": case "backup.js": case "settings.js": mime = "application/javascript"; break;
            case "manifest.webmanifest": mime = "application/manifest+json"; break;
            case "icon-192.png": case "icon-512.png": mime = "image/png"; break;
            default: return blocked();
        }
        if (!internal(uri)) return blocked();
        try { return new WebResourceResponse(mime, file.endsWith(".png") ? null : "UTF-8", 200, "OK",
                assetHeaders(), getAssets().open("board/" + file)); }
        catch (IOException error) { return blocked(); }
    }
    private java.util.Map<String, String> assetHeaders() {
        java.util.Map<String, String> headers = new java.util.HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'");
        return headers;
    }
    private WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    private void loadBoard() { webView.loadUrl(ORIGIN + "/?app=android&v=41"); }
    private void message(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    private void fileReply(String operation, JSONObject result) {
        if (!isFinishing()) webView.evaluateJavascript("window.MilkFilesReply&&window.MilkFilesReply(" + JSONObject.quote(operation) + "," + result.toString() + ")", null);
    }
    private void fileError(String operation, String error) {
        try { fileReply(operation, new JSONObject().put("error", error)); } catch (Exception ignored) { message(error); }
    }
    private void createCsv(String csv, String name) {
        if (filePickerOpen) { fileError("export", "请先关闭当前文件选择器"); return; }
        if (csv == null || csv.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 1024 * 1024) { fileError("export", "备份不能超过 1 MB"); return; }
        pendingCsv = csv;
        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(android.content.Intent.CATEGORY_OPENABLE); intent.setType("text/csv");
        intent.putExtra(android.content.Intent.EXTRA_TITLE, name.matches("baby-feeding-[0-9-]+\\.csv") ? name : "baby-feeding-backup.csv");
        try { filePickerOpen = true; startActivityForResult(intent, EXPORT_CSV); }
        catch (Exception error) { filePickerOpen = false; pendingCsv = null; fileError("export", "无法打开文件保存器"); }
    }
    private void chooseCsv() {
        if (filePickerOpen) { fileError("import", "请先关闭当前文件选择器"); return; }
        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(android.content.Intent.CATEGORY_OPENABLE); intent.setType("*/*");
        intent.putExtra(android.content.Intent.EXTRA_MIME_TYPES, new String[]{"text/csv", "text/comma-separated-values", "text/plain", "application/octet-stream", "application/vnd.ms-excel"});
        try { filePickerOpen = true; startActivityForResult(intent, IMPORT_CSV); }
        catch (Exception error) { filePickerOpen = false; fileError("import", "无法打开文件选择器"); }
    }
    private void documentResult(int request, int result, android.content.Intent data) {
        filePickerOpen = false;
        String operation = request == EXPORT_CSV ? "export" : "import";
        String csv = pendingCsv; pendingCsv = null;
        if (result != RESULT_OK || data == null || data.getData() == null) {
            try { fileReply(operation, new JSONObject().put("cancelled", true)); } catch (Exception ignored) {} return;
        }
        Uri uri = data.getData();
        new Thread(() -> {
            try {
                JSONObject reply = new JSONObject();
                if (request == EXPORT_CSV) {
                    if (csv == null) throw new IOException("备份已失效，请重试");
                    try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                        if (out == null) throw new IOException("无法保存文件");
                        out.write(csv.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    }
                } else {
                    reply.put("text", StateStore.read(getContentResolver().openInputStream(uri))).put("name", "所选 CSV 文件");
                }
                runOnUiThread(() -> fileReply(operation, reply));
            } catch (Exception error) { runOnUiThread(() -> fileError(operation, "无法读取或保存 CSV，请检查文件及存储空间")); }
        }, "CsvDocument").start();
    }
    private void readServerRecords(String raw) {
        String address = raw.trim().replaceAll("/+$", "");
        Uri uri = Uri.parse(address);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null
            || uri.getUserInfo() != null || (uri.getPath() != null && !uri.getPath().isEmpty()) || uri.getQuery() != null || uri.getFragment() != null
            || address.matches(".*\\s.*") || uri.getPort() == 0 || uri.getPort() > 65535) {
            fileError("server", "请输入有效的 http:// 或 https:// 服务地址"); return;
        }
        getSharedPreferences("dashboard", MODE_PRIVATE).edit().putString("server", address).apply();
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(address + "/api/state").openConnection();
                connection.setConnectTimeout(8000); connection.setReadTimeout(8000); connection.setInstanceFollowRedirects(false);
                if (connection.getResponseCode() != 200) throw new IOException("服务器未返回记录");
                JSONObject state = StateStore.parseImport(StateStore.read(connection.getInputStream()));
                JSONObject reply = new JSONObject().put("state", state);
                runOnUiThread(() -> fileReply("server", reply));
            } catch (Exception error) { runOnUiThread(() -> fileError("server", "无法读取服务器记录，请确认服务地址和 Wi-Fi")); }
            finally { if (connection != null) connection.disconnect(); }
        }, "ReadServerBackup").start();
    }
    private void enterFullscreen() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused) enterFullscreen(); }
    @Override protected void onStart() { super.onStart(); updater.foreground(true); updater.check(false); }
    @Override protected void onStop() { updater.foreground(false); super.onStop(); }
    @Override protected void onActivityResult(int request, int result, android.content.Intent data) {
        super.onActivityResult(request, result, data);
        if (request == EXPORT_CSV || request == IMPORT_CSV) documentResult(request, result, data);
        if (request == AppUpdater.INSTALL_PERMISSION) updater.permissionResult();
        if (request == AppUpdater.INSTALL_RESULT) updater.installResult();
    }
    @Override protected void onResume() { super.onResume(); webView.onResume(); webView.resumeTimers(); enterFullscreen(); }
    @Override protected void onPause() { webView.pauseTimers(); webView.onPause(); super.onPause(); }
    @Override protected void onDestroy() { updater.close(); webView.removeJavascriptInterface("AndroidStore"); webView.destroy(); super.onDestroy(); }
}
