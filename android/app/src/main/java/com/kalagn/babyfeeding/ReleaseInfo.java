package com.kalagn.babyfeeding;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.net.URL;

final class ReleaseInfo {
    static final String REPO = "kalaGN/baby-feeding-dashboard";
    static final long MAX_APK_BYTES = 100L * 1024 * 1024;
    final String version, notes, url, sha256;
    final long size;
    private ReleaseInfo(String version, String notes, String url, String digest, long size) {
        this.version = version; this.notes = notes; this.url = url; this.sha256 = digest; this.size = size;
    }
    static int compare(String left, String right) throws IOException {
        String[] a = parts(left), b = parts(right);
        for (int i = 0; i < 3; i++) {
            long x = Long.parseLong(a[i]), y = Long.parseLong(b[i]);
            if (x != y) return x > y ? 1 : -1;
        }
        return 0;
    }
    private static String[] parts(String value) throws IOException {
        if (!value.matches("v?[0-9]{1,9}\\.[0-9]{1,9}\\.[0-9]{1,9}")) throw new IOException("版本格式无效");
        return value.replaceFirst("^v", "").split("\\.");
    }
    static ReleaseInfo parse(String json, String installed) throws Exception {
        JSONObject release = new JSONObject(json);
        if (release.getBoolean("draft") || release.getBoolean("prerelease")) return null;
        String tag = release.getString("tag_name");
        if (compare(tag, installed) <= 0) return null;
        String version = tag.replaceFirst("^v", "");
        JSONArray assets = release.getJSONArray("assets");
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            if (!asset.getString("name").equals("baby-feeding-dashboard-" + version + ".apk")) continue;
            URL url = new URL(asset.getString("browser_download_url"));
            String expected = "/" + REPO + "/releases/download/" + tag + "/" + asset.getString("name");
            if (!"https".equals(url.getProtocol()) || !"github.com".equals(url.getHost()) || url.getPort() != -1
                || url.getUserInfo() != null || !expected.equals(url.getPath()) || url.getQuery() != null || url.getRef() != null) throw new IOException("下载地址无效");
            String digest = asset.optString("digest", "");
            long size = asset.getLong("size");
            if (!digest.matches("sha256:[a-fA-F0-9]{64}") || size < 1 || size > MAX_APK_BYTES) throw new IOException("新版附件缺少有效校验信息");
            return new ReleaseInfo(version, release.optString("body", ""), url.toString(), digest.substring(7), size);
        }
        throw new IOException("新版尚未提供 APK");
    }
}
