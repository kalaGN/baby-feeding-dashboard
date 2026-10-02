package com.kalagn.babyfeeding;

import org.junit.Test;
import org.json.*;
import java.io.IOException;
import static org.junit.Assert.*;

public class ReleaseInfoTest {
    private JSONObject release() throws Exception {
        return new JSONObject().put("draft",false).put("prerelease",false).put("tag_name","v1.2.0").put("body","新版")
            .put("assets",new JSONArray().put(new JSONObject().put("name","baby-feeding-dashboard-1.2.0.apk")
            .put("browser_download_url","https://github.com/kalaGN/baby-feeding-dashboard/releases/download/v1.2.0/baby-feeding-dashboard-1.2.0.apk")
            .put("digest","sha256:" + new String(new char[64]).replace('\0','a')).put("size",100)));
    }
    @Test public void comparesNumericVersions() throws Exception {
        assertTrue(ReleaseInfo.compare("v1.10.0","1.9.8") > 0);
        assertEquals(0,ReleaseInfo.compare("v1.2.0","1.2.0"));
        assertTrue(ReleaseInfo.compare("1.1.2","1.2.0") < 0);
        try { ReleaseInfo.compare("v1.2.0-beta","1.1.2"); fail(); } catch(IOException expected) {}
    }
    @Test public void parsesNewerAndSkipsOldAndPrerelease() throws Exception {
        JSONObject input=release();
        assertEquals("1.2.0",ReleaseInfo.parse(input.toString(),"1.1.2").version);
        assertNull(ReleaseInfo.parse(input.toString(),"1.2.0"));
        assertNull(ReleaseInfo.parse(input.toString(),"2.0.0"));
        input.put("prerelease",true); assertNull(ReleaseInfo.parse(input.toString(),"1.1.2"));
        input.put("prerelease",false).put("draft",true); assertNull(ReleaseInfo.parse(input.toString(),"1.1.2"));
    }
    @Test public void rejectsForeignAssetAndMissingDigest() throws Exception {
        JSONObject input=release(); JSONObject asset=input.getJSONArray("assets").getJSONObject(0);
        asset.put("browser_download_url","https://github.com/evil/project/releases/download/v1.2.0/baby-feeding-dashboard-1.2.0.apk");
        try { ReleaseInfo.parse(input.toString(),"1.1.2"); fail(); } catch(IOException expected) {}
        input=release(); input.getJSONArray("assets").getJSONObject(0).remove("digest");
        try { ReleaseInfo.parse(input.toString(),"1.1.2"); fail(); } catch(IOException expected) {}
    }
    @Test public void rejectsOversizedAndIncompleteRelease() throws Exception {
        JSONObject input=release();input.getJSONArray("assets").getJSONObject(0).put("size",ReleaseInfo.MAX_APK_BYTES+1);
        try { ReleaseInfo.parse(input.toString(),"1.1.2"); fail(); } catch(IOException expected) {}
        input.put("assets",new JSONArray());
        try { ReleaseInfo.parse(input.toString(),"1.1.2"); fail(); } catch(IOException expected) {}
    }
}
