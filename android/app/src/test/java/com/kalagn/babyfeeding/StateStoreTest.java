package com.kalagn.babyfeeding;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import org.json.*;
import java.io.*;
import static org.junit.Assert.*;

public class StateStoreTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private JSONObject state(int amount) throws Exception {
        return new JSONObject("{\"intervalHours\":3.1,\"intervalStartedAt\":1000,\"entries\":[{\"id\":\"one\",\"at\":1000,\"amount\":" + amount + ",\"auto\":true}]}");
    }
    private JSONObject body(StateStore store) throws Exception { return new JSONObject(store.request("GET", "")).getJSONObject("body"); }
    private int save(StateStore store,long revision,JSONObject state) throws Exception {
        return new JSONObject(store.request("PUT",new JSONObject().put("revision",revision).put("state",state).toString())).getInt("status");
    }
    @Test public void saveReopenConflictAndUpdate() throws Exception {
        File directory = temporary.newFolder(); StateStore store = new StateStore(directory);
        assertFalse(body(store).getBoolean("initialized"));
        assertEquals(200,save(store,0,state(120)));
        store = new StateStore(directory);
        assertEquals(120, body(store).getJSONObject("state").getJSONArray("entries").getJSONObject(0).getInt("amount"));
        assertEquals(409,save(store,0,state(150)));
        assertEquals(200,save(store,1,state(150)));
        assertEquals(2,body(new StateStore(directory)).getLong("revision"));
    }
    @Test public void rejectsMalformedWithoutReplacingData() throws Exception {
        StateStore store = new StateStore(temporary.newFolder()); assertEquals(200,save(store,0,state(120)));
        JSONObject bad = state(130); bad.getJSONArray("entries").put(bad.getJSONArray("entries").getJSONObject(0));
        assertEquals(500,save(store,1,bad));
        assertEquals(500,save(store,1,state(0)));
        JSONObject large = state(120); large.getJSONArray("entries").getJSONObject(0).put("amount",4294967416L);
        assertEquals(500,save(store,1,large));
        assertEquals(120,body(store).getJSONObject("state").getJSONArray("entries").getJSONObject(0).getInt("amount"));
    }
    @Test public void failedWriteLeavesLastSnapshot() throws Exception {
        File directory = temporary.newFolder(); StateStore store = new StateStore(directory); assertEquals(200,save(store,0,state(120)));
        assertTrue(new File(directory,"state.json.tmp").mkdir());
        assertEquals(500,save(store,1,state(180)));
        assertEquals(1,body(store).getLong("revision"));
        assertEquals(120,body(new StateStore(directory)).getJSONObject("state").getJSONArray("entries").getJSONObject(0).getInt("amount"));
    }
    @Test public void corruptFileFailsClosed() throws Exception {
        File directory = temporary.newFolder();
        try(FileWriter writer = new FileWriter(new File(directory,"state.json"))) { writer.write("broken"); }
        StateStore store = new StateStore(directory);
        assertEquals(500,new JSONObject(store.request("GET", "")).getInt("status"));
        assertEquals(500,save(store,0,state(120)));
        assertEquals("broken",StateStore.read(new FileInputStream(new File(directory,"state.json"))));
    }
    @Test public void readingMigrationDoesNotWriteUntilConfirmedAndKeepsPrevious() throws Exception {
        File directory = temporary.newFolder(); StateStore store = new StateStore(directory);
        assertEquals(200,save(store,0,state(120)));
        JSONObject old = StateStore.parseImport(new JSONObject().put("revision",42).put("state",state(180)).toString());
        assertEquals(120,body(store).getJSONObject("state").getJSONArray("entries").getJSONObject(0).getInt("amount"));
        store.importState(old);
        assertEquals(180,body(new StateStore(directory)).getJSONObject("state").getJSONArray("entries").getJSONObject(0).getInt("amount"));
        JSONObject previous = new JSONObject(StateStore.read(new FileInputStream(new File(directory,"state.before-migration.json"))));
        assertEquals(120,previous.getJSONObject("state").getJSONArray("entries").getJSONObject(0).getInt("amount"));
    }
}
