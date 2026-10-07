import com.harry.redditlurker.MediaFile;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

public class MediaFileTest {
    private static void same(String actual, String expected) {
        if (!expected.equals(actual)) throw new AssertionError(actual + " != " + expected);
    }
    private static void reject(byte[] bytes, String mime) {
        try { MediaFile.validate(bytes, mime); }
        catch (IOException expected) { return; }
        throw new AssertionError("Accepted invalid " + mime);
    }
    public static void main(String[] args) throws Exception {
        String[] mimes = {"video/mp4", "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"};
        String[] extensions = {"mp4", "png", "jpg", "gif", "webp", "avif"};
        byte[][] headers = {
            new byte[]{0,0,0,24,'f','t','y','p','i','s','o','m'},
            new byte[]{(byte)137,'P','N','G',13,10,26,10},
            new byte[]{(byte)255,(byte)216,(byte)255,(byte)224},
            "GIF89a".getBytes(StandardCharsets.US_ASCII),
            "RIFF1234WEBP".getBytes(StandardCharsets.US_ASCII),
            "1234ftypavif".getBytes(StandardCharsets.US_ASCII)
        };
        for (int i = 0; i < mimes.length; i++) {
            MediaFile.validate(headers[i], mimes[i]);
            same(MediaFile.extension(mimes[i]), extensions[i]);
            same(MediaFile.mime("uuid." + extensions[i]), mimes[i]);
            same(MediaFile.displayName(mimes[i]), (i == 0 ? "reddit-video." : "reddit-image.") + extensions[i]);
            reject(new byte[0], mimes[i]);
            reject("<html>error</html>".getBytes(StandardCharsets.US_ASCII), mimes[i]);
        }
        reject(headers[1], "image/jpeg");
        reject(headers[0], "image/png");
        reject(headers[0], "image/avif");
        reject(headers[1], "text/html");
        try { MediaFile.extension("text/html"); throw new AssertionError("Accepted HTML"); }
        catch (IOException expected) {}
        System.out.println("Native media MIME, signatures and file names passed.");
    }
}
