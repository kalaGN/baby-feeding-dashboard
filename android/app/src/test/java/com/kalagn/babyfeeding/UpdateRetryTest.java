package com.kalagn.babyfeeding;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class UpdateRetryTest {
    @Test public void transientFailureUsesTwoAndFiveSecondsThenSucceeds() throws Exception {
        int[] attempts = {0}; List<Long> waits = new ArrayList<>();
        String value = UpdateRetry.run(() -> { if (++attempts[0] < 3) throw new UpdateRetry.NetworkFailure("超时"); return "ok"; }, () -> false, waits::add, (number, delay) -> {});
        assertEquals("ok", value); assertEquals(3, attempts[0]); assertEquals(Arrays.asList(2000L, 5000L), waits);
    }
    @Test public void exhaustedFailureStopsAfterThreeAttempts() throws Exception {
        int[] attempts = {0}; List<Long> waits = new ArrayList<>();
        try { UpdateRetry.run(() -> { attempts[0]++; throw new UpdateRetry.NetworkFailure("断流"); }, () -> false, waits::add, (number, delay) -> {}); fail(); }
        catch (UpdateRetry.NetworkFailure expected) { assertEquals(3, attempts[0]); assertEquals(2, waits.size()); }
    }
    @Test public void permanentFailureDoesNotRetry() throws Exception {
        int[] attempts = {0};
        try { UpdateRetry.run(() -> { attempts[0]++; throw new IOException("签名不符"); }, () -> false, delay -> fail(), (number, delay) -> fail()); fail(); }
        catch (IOException expected) { assertEquals(1, attempts[0]); }
    }
    @Test public void cancellationDuringWaitPreventsNextRequest() throws Exception {
        int[] attempts = {0}; boolean[] cancelled = {false};
        try { UpdateRetry.run(() -> { attempts[0]++; throw new UpdateRetry.NetworkFailure("超时"); }, () -> cancelled[0], delay -> cancelled[0] = true, (number, delay) -> {}); fail(); }
        catch (UpdateRetry.Cancelled expected) { assertEquals(1, attempts[0]); }
    }
    @Test public void cancelledBeforeStartMakesNoRequest() throws Exception {
        try { UpdateRetry.run(() -> { fail(); return null; }, () -> true, delay -> fail(), (number, delay) -> fail()); fail(); }
        catch (UpdateRetry.Cancelled expected) {}
    }
    @Test public void immediateSuccessDoesNotWait() throws Exception {
        assertEquals("ok", UpdateRetry.run(() -> "ok", () -> false, delay -> fail(), (number, delay) -> fail()));
    }
    @Test public void httpClassificationRejectsPermanentAndCertificateErrors() {
        for (int status : new int[]{408,429,500,502,503,504}) assertTrue(UpdateRetry.transientStatus(status));
        for (int status : new int[]{400,401,403,404,422}) assertFalse(UpdateRetry.transientStatus(status));
        assertTrue(UpdateRetry.network(new java.net.SocketTimeoutException()) instanceof UpdateRetry.NetworkFailure);
        assertFalse(UpdateRetry.network(new javax.net.ssl.SSLHandshakeException("证书")) instanceof UpdateRetry.NetworkFailure);
    }
}
