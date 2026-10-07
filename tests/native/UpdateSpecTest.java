import com.harry.redditlurker.UpdateSpec;
import java.io.IOException;

public class UpdateSpecTest {
    private static final String URL = "https://english-grammar-homework.com/rlurker-downloads/Reddit-Lurker-7.6.0.apk";
    private static final String HASH = new String(new char[64]).replace('\0', 'a');
    private static void reject(long code, String name, String url, String hash, long size) {
        try { new UpdateSpec(code, name, url, hash, size); }
        catch (IOException expected) { return; }
        throw new AssertionError("Accepted unsafe update: " + url);
    }
    public static void main(String[] args) throws Exception {
        UpdateSpec valid = new UpdateSpec(70600, "7.6.0", URL, HASH, 800000);
        if (valid.versionCode != 70600 || valid.size != 800000) throw new AssertionError("Wrong version or size");
        reject(70601, "7.6.0", URL, HASH, 800000);
        reject(70600, "7.6.0", URL.replace("https:", "http:"), HASH, 800000);
        reject(70600, "7.6.0", URL.replace("english-grammar-homework.com", "example.com"), HASH, 800000);
        reject(70600, "7.6.0", URL.replace("/rlurker-downloads/", "/rlurker-downloads/../"), HASH, 800000);
        reject(70600, "7.6.0", URL.replace("/rlurker-downloads/", "/rlurker-downloads/%2e%2e/"), HASH, 800000);
        reject(70600, "7.6.0", URL.replace("https://", "https://user@"), HASH, 800000);
        reject(70600, "7.6.0", URL + "?redirect=example.com", HASH, 800000);
        reject(70600, "7.6.0", URL + "#fragment", HASH, 800000);
        reject(70600, "7.6.0", URL, "not-a-hash", 800000);
        reject(70600, "7.6.0", URL, HASH, UpdateSpec.MAX_APK_BYTES + 1);
        reject(70600, "7.6.0", URL, HASH, 0);
        System.out.println("Update metadata validation passed");
    }
}
