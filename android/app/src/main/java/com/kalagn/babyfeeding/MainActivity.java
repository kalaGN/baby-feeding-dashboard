package com.kalagn.babyfeeding;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private static final String DEFAULT_SERVER = "http://192.168.0.104:4173";
    private WebView webView;
    private LinearLayout errorPanel;
    private SharedPreferences preferences;
    private String server;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        preferences = getSharedPreferences("dashboard", MODE_PRIVATE);
        server = preferences.getString("server", DEFAULT_SERVER);

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
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (sameOrigin(Uri.parse(url))) {
                    view.evaluateJavascript("(function(){var b=document.getElementById('fullscreenButton');if(b)b.style.display='none';}())", null);
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) errorPanel.setVisibility(View.VISIBLE);
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) errorPanel.setVisibility(View.VISIBLE);
            }
        });

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(32), dp(32), dp(32), dp(32));
        errorPanel.setBackgroundColor(Color.rgb(245, 242, 233));
        TextView error = new TextView(this);
        error.setText("无法连接喝奶看板\n请确认电脑已启动服务，平板和电脑连接同一个 Wi-Fi。");
        error.setTextSize(24);
        error.setGravity(Gravity.CENTER);
        error.setTextColor(Color.rgb(38, 56, 47));
        errorPanel.addView(error);
        Button retry = new Button(this);
        retry.setText("重新连接");
        retry.setTextSize(22);
        retry.setOnClickListener(v -> loadBoard());
        errorPanel.addView(retry);
        Button changeServer = new Button(this);
        changeServer.setText("设置服务器地址");
        changeServer.setTextSize(22);
        changeServer.setOnClickListener(v -> showServerSettings());
        errorPanel.addView(changeServer);
        root.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        errorPanel.setVisibility(View.GONE);

        Button settingsButton = new Button(this);
        settingsButton.setText("设置");
        settingsButton.setTextSize(13);
        settingsButton.setContentDescription("设置服务器地址");
        settingsButton.setAlpha(0.8f);
        settingsButton.setOnClickListener(v -> showServerSettings());
        FrameLayout.LayoutParams settingsLayout = new FrameLayout.LayoutParams(dp(64), dp(44), Gravity.BOTTOM | Gravity.END);
        settingsLayout.setMargins(0, 0, dp(8), dp(4));
        root.addView(settingsButton, settingsLayout);
        setContentView(root);
        enterFullscreen();
        if (preferences.contains("server")) loadBoard();
        else showServerSettings();
    }

    private boolean sameOrigin(Uri uri) {
        Uri configured = Uri.parse(server);
        return configured.getScheme().equalsIgnoreCase(uri.getScheme())
            && configured.getHost().equalsIgnoreCase(uri.getHost() == null ? "" : uri.getHost())
            && effectivePort(configured) == effectivePort(uri);
    }

    private int effectivePort(Uri uri) {
        return uri.getPort() != -1 ? uri.getPort() : ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80);
    }

    private boolean handleNavigation(Uri uri) {
        if (sameOrigin(uri)) return false;
        if ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
            catch (ActivityNotFoundException ignored) { /* The dashboard needs no external browser. */ }
        }
        return true;
    }

    private void loadBoard() {
        errorPanel.setVisibility(View.GONE);
        webView.loadUrl(server + "/?app=android&v=23");
    }

    private void showServerSettings() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setTextSize(22);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(server);
        input.setSelectAllOnFocus(true);
        LinearLayout form = new LinearLayout(this);
        form.setPadding(dp(24), dp(8), dp(24), 0);
        form.setOrientation(LinearLayout.VERTICAL);
        TextView description = new TextView(this);
        description.setText(R.string.server_description);
        description.setTextSize(18);
        form.addView(description);
        form.addView(input);
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("服务器地址").setView(form)
            .setPositiveButton("保存并连接", null)
            .setNegativeButton("取消", (d, which) -> { if (!preferences.contains("server")) loadBoard(); })
            .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String value = input.getText().toString().trim();
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme();
            String path = uri.getPath();
            if ((!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)))
                    || uri.getHost() == null || uri.getUserInfo() != null
                    || value.matches(".*\\s.*") || uri.getPort() == 0 || uri.getPort() > 65535
                    || (path != null && !path.isEmpty() && !path.equals("/"))
                    || uri.getQuery() != null || uri.getFragment() != null) {
                input.setError("请输入完整的 http:// 或 https:// 服务器地址，不包含页面路径");
                return;
            }
            server = value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
            preferences.edit().putString("server", server).apply();
            dialog.dismiss();
            loadBoard();
        }));
        dialog.show();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void enterFullscreen() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) enterFullscreen();
    }

    @Override protected void onResume() {
        super.onResume();
        webView.onResume();
        webView.resumeTimers();
        enterFullscreen();
    }

    @Override protected void onPause() {
        webView.pauseTimers();
        webView.onPause();
        super.onPause();
    }

    @Override protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
