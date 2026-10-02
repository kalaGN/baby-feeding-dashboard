package com.kalagn.babyfeeding;

import android.app.Activity;
import android.app.AlertDialog;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
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

    public final class StorageBridge {
        @JavascriptInterface public String request(String method, String payload) {
            return store.request(method, payload);
        }
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        store = new StateStore(getFilesDir());
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
        Button migrate = new Button(this);
        migrate.setText("旧记录"); migrate.setTextSize(14);
        migrate.setContentDescription("确认后导入旧服务器记录"); migrate.setAlpha(.8f);
        migrate.setOnClickListener(v -> importServer());
        FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(dp(80), dp(48), Gravity.BOTTOM | Gravity.END);
        layout.setMargins(0, 0, dp(8), dp(4)); root.addView(migrate, layout);
        setContentView(root);
        enterFullscreen(); loadBoard();
        android.content.SharedPreferences preferences = getSharedPreferences("dashboard", MODE_PRIVATE);
        if (savedInstanceState == null && preferences.contains("server") && !preferences.getBoolean("migrationPromptShown", false)) {
            preferences.edit().putBoolean("migrationPromptShown", true).apply();
            new AlertDialog.Builder(this).setTitle("导入旧记录？")
                .setMessage("旧记录仍保存在电脑。可先读取并查看条数，确认后导入到这台平板。也可以稍后点击右下角“旧记录”。")
                .setPositiveButton("读取旧记录", (d, which) -> importServer()).setNegativeButton("暂不导入", null).show();
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
            case "app.js": mime = "application/javascript"; break;
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
    private void loadBoard() { webView.loadUrl(ORIGIN + "/?app=android&v=26"); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void message(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    private void confirmImport(JSONObject state) throws Exception {
        int count = state.getJSONArray("entries").length();
        new AlertDialog.Builder(this).setTitle("确认导入 " + count + " 条旧记录？")
            .setMessage("记录将保存在这台平板，电脑原记录保留。若平板已有新记录，本次导入会替换它们，请确认后操作。")
            .setPositiveButton("确认导入", (d, which) -> {
                try {
                    store.importState(state);
                    webView.evaluateJavascript("localStorage.removeItem('milk-board-v1');localStorage.removeItem('milk-board-server-pending-v1');localStorage.removeItem('milk-board-server-revision-v1');", ignored -> { loadBoard(); message("旧记录已导入到平板"); });
                } catch (Exception error) { message("导入失败，原记录仍保留，请检查存储空间"); }
            }).setNegativeButton("取消", null).show();
    }
    private void importServer() {
        EditText input = new EditText(this); input.setTextSize(22); input.setSingleLine(true);
        input.setText(getSharedPreferences("dashboard", MODE_PRIVATE).getString("server", "http://192.168.0.104:4173"));
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("旧电脑服务地址").setView(input)
            .setPositiveButton("读取", null).setNegativeButton("取消", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String address = input.getText().toString().trim().replaceAll("/+$", "");
            Uri uri = Uri.parse(address);
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null
                || uri.getUserInfo() != null || (uri.getPath() != null && !uri.getPath().isEmpty()) || uri.getQuery() != null || uri.getFragment() != null
                || address.matches(".*\\s.*") || uri.getPort() == 0 || uri.getPort() > 65535) {
                input.setError("请输入 http:// 或 https:// 服务器地址"); return;
            }
            dialog.dismiss(); message("正在读取旧记录…");
            new Thread(() -> {
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(address + "/api/state").openConnection();
                    connection.setConnectTimeout(8000); connection.setReadTimeout(8000); connection.setInstanceFollowRedirects(false);
                    if (connection.getResponseCode() != 200) throw new IOException("服务器未返回记录");
                    JSONObject state = StateStore.parseImport(StateStore.read(connection.getInputStream()));
                    runOnUiThread(() -> { if (!isFinishing()) try { confirmImport(state); } catch (Exception error) { message("记录格式无效"); } });
                } catch (Exception error) { runOnUiThread(() -> { if (!isFinishing()) message("无法读取旧电脑记录，请确认地址和 Wi-Fi"); }); }
                finally { if (connection != null) connection.disconnect(); }
            }, "ImportRecords").start();
        })); dialog.show();
    }
    private void enterFullscreen() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused) enterFullscreen(); }
    @Override protected void onResume() { super.onResume(); webView.onResume(); webView.resumeTimers(); enterFullscreen(); }
    @Override protected void onPause() { webView.pauseTimers(); webView.onPause(); super.onPause(); }
    @Override protected void onDestroy() { webView.removeJavascriptInterface("AndroidStore"); webView.destroy(); super.onDestroy(); }
}
