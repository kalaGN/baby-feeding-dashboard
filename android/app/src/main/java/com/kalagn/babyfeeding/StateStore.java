package com.kalagn.babyfeeding;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;

/** Serialized state protocol shared with the web server, stored on this tablet. */
public final class StateStore {
    private final File file;
    private JSONObject stored;
    public StateStore(File directory) { file = new File(directory, "state.json"); }

    private void load() throws Exception {
        if (stored != null) return;
        if (file.exists()) {
            JSONObject saved = new JSONObject(read(new FileInputStream(file)));
            validate(saved.getJSONObject("state"));
            Object revision = saved.get("revision");
            if (!integer(revision) || ((Number) revision).longValue() < 1) throw new IOException("记录文件损坏，请从备份恢复");
            stored = saved;
        } else {
            stored = new JSONObject().put("revision", 0).put("state", new JSONObject()
                .put("intervalHours", JSONObject.NULL).put("intervalStartedAt", JSONObject.NULL).put("entries", new JSONArray()));
        }
    }

    public synchronized String request(String method, String payload) {
        try {
            load();
            if ("GET".equals(method)) return response(200, snapshot());
            if (!"PUT".equals(method)) return response(405, new JSONObject().put("error", "不支持的操作"));
            if (payload.length() > 1024 * 1024) throw new IOException("记录文件过大");
            JSONObject input = new JSONObject(payload);
            Object revision = input.get("revision");
            if (!integer(revision) || ((Number) revision).longValue() < 0) throw new IOException("记录版本无效");
            JSONObject state = input.getJSONObject("state");
            validate(state);
            if (((Number) revision).longValue() != stored.getLong("revision")) return response(409, snapshot());
            persist(state);
            return response(200, snapshot());
        } catch (Exception error) {
            try { return response(500, new JSONObject().put("error", "无法读取或保存平板记录，请检查文件及存储空间。")); }
            catch (Exception ignored) { return "{\"status\":500,\"body\":{}}"; }
        }
    }

    private JSONObject snapshot() throws Exception {
        return new JSONObject(stored.toString()).put("initialized", stored.getLong("revision") > 0);
    }
    private String response(int status, JSONObject body) throws Exception {
        return new JSONObject().put("status", status).put("body", body).toString();
    }
    private void persist(JSONObject state) throws Exception {
        JSONObject next = new JSONObject().put("revision", stored.getLong("revision") + 1).put("state", state);
        write(file, next.toString());
        stored = next;
    }
    public synchronized void importState(JSONObject state) throws Exception {
        validate(state);
        load();
        if (file.exists()) write(new File(file.getParentFile(), "state.before-migration.json"), read(new FileInputStream(file)));
        persist(state);
    }
    public static JSONObject parseImport(String json) throws Exception {
        JSONObject input = new JSONObject(json);
        JSONObject state = input.getJSONObject("state");
        validate(state);
        return state;
    }
    private static void write(File target, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 1024 * 1024) throw new IOException("记录文件不能超过 1 MB");
        File temp = new File(target.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(bytes);
            out.getFD().sync();
        }
        if (!temp.renameTo(target)) throw new IOException("无法写入记录文件");
    }
    public static String read(InputStream input) throws IOException {
        if (input == null) throw new IOException("无法打开文件");
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = in.read(buffer)) != -1) {
                if (out.size() + count > 1024 * 1024) throw new IOException("记录文件不能超过 1 MB");
                out.write(buffer, 0, count);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    private static boolean finite(double value) { return !Double.isNaN(value) && !Double.isInfinite(value); }
    private static boolean integer(Object value) {
        if (!(value instanceof Number)) return false;
        double number = ((Number) value).doubleValue();
        return finite(number) && number == Math.floor(number) && Math.abs(number) <= 9007199254740991d;
    }
    private static boolean positive(Object value) {
        return value instanceof Number && finite(((Number) value).doubleValue()) && ((Number) value).doubleValue() > 0;
    }
    public static void validate(JSONObject state) throws Exception {
        Object hours = state.get("intervalHours"), started = state.get("intervalStartedAt");
        if (hours != JSONObject.NULL) {
            if (!(hours instanceof Number)) throw new IOException("间隔格式无效");
            double h = ((Number) hours).doubleValue();
            if (!finite(h) || h < .5 || h > 24 || Math.abs(h * 10 - Math.round(h * 10)) > 1e-8) throw new IOException("间隔无效");
        }
        if (started != JSONObject.NULL && !positive(started)) throw new IOException("开始时间无效");
        JSONArray entries = state.getJSONArray("entries");
        if (entries.length() > 10000) throw new IOException("记录过多");
        HashSet<String> ids = new HashSet<>();
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.getJSONObject(i);
            Object id = entry.get("id"), amount = entry.get("amount");
            if (!(id instanceof String) || ((String) id).isEmpty() || ((String) id).length() > 120 || !ids.add((String) id)) throw new IOException("记录编号无效或重复");
            if (!positive(entry.get("at")) || !integer(amount) || ((Number) amount).doubleValue() < 1 || ((Number) amount).doubleValue() > 2000) throw new IOException("时间或奶量无效");
            if (entry.has("auto") && !(entry.get("auto") instanceof Boolean)) throw new IOException("自动记录标记无效");
        }
    }
}
