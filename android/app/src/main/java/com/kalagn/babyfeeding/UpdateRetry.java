package com.kalagn.babyfeeding;

import java.io.IOException;
import java.io.InterruptedIOException;
import javax.net.ssl.SSLException;

/** One update operation: initial attempt and at most two network retries. */
final class UpdateRetry {
    interface Operation<T> { T run() throws Exception; }
    interface Cancellation { boolean cancelled(); }
    interface Wait { void pause(long milliseconds) throws Exception; }
    interface Notice { void retry(int number, long milliseconds); }
    static final class NetworkFailure extends IOException {
        NetworkFailure(String message) { super(message); }
        NetworkFailure(IOException cause) { super(cause.getMessage(), cause); }
    }
    static final class Cancelled extends InterruptedIOException { Cancelled() { super("更新已取消"); } }
    static boolean transientStatus(int status) { return status == 408 || status == 429 || status == 500 || status == 502 || status == 503 || status == 504; }
    static IOException network(IOException error) {
        return error instanceof SSLException || error instanceof Cancelled || error instanceof NetworkFailure ? error : new NetworkFailure(error);
    }
    static void check(Cancellation cancellation) throws Cancelled {
        if (cancellation.cancelled() || Thread.currentThread().isInterrupted()) throw new Cancelled();
    }
    static <T> T run(Operation<T> operation, Cancellation cancellation, Wait wait, Notice notice) throws Exception {
        long[] delays = {2000, 5000};
        for (int attempt = 0; ; attempt++) {
            check(cancellation);
            try { T result = operation.run(); check(cancellation); return result; }
            catch (NetworkFailure error) {
                check(cancellation);
                if (attempt >= delays.length) throw error;
                notice.retry(attempt + 1, delays[attempt]);
                wait.pause(delays[attempt]);
                check(cancellation);
            }
        }
    }
    static void sleep(long milliseconds, Cancellation cancellation) throws Exception {
        long remaining = milliseconds;
        while (remaining > 0) {
            check(cancellation);
            long slice = Math.min(remaining, 100);
            try { Thread.sleep(slice); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new Cancelled(); }
            remaining -= slice;
        }
        check(cancellation);
    }
}
