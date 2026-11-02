package cn.campus.platform;

import static cn.campus.platform.ApiError.check;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

public final class Passwords {

  private static final SecureRandom RANDOM = new SecureRandom();
  private static final BCryptPasswordEncoder LEGACY = new BCryptPasswordEncoder(10);
  private static final String DUMMY = encode("unassigned-" + UUID.randomUUID());

  private Passwords() {}

  public static String dummyHash() {
    return DUMMY;
  }

  public static void validate(String password) {
    int n = password.codePointCount(0, password.length());
    check(n >= 8 && n <= 128, "密码须为8～128个字符");
  }

  private static byte[] derive(String raw, byte[] salt, int rounds)
    throws GeneralSecurityException {
    var spec = new PBEKeySpec(raw.toCharArray(), salt, rounds, 256);
    try {
      return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
    } finally {
      spec.clearPassword();
    }
  }

  public static String encode(String raw) {
    validate(raw);
    byte[] salt = new byte[16];
    RANDOM.nextBytes(salt);
    try {
      return (
        "{pbkdf2}$600000$" +
        Base64.getEncoder().encodeToString(salt) +
        "$" +
        Base64.getEncoder().encodeToString(derive(raw, salt, 600000))
      );
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("密码散列服务不可用", e);
    }
  }

  public static boolean matches(String raw, String encoded) {
    if (raw.codePointCount(0, raw.length()) > 128) return false;
    try {
      if (encoded.startsWith("{pbkdf2}$")) {
        var parts = encoded.split("\\$");
        int rounds = Integer.parseInt(parts[1]);
        if (rounds < 600000 || rounds > 2000000) return false;
        return MessageDigest.isEqual(
          Base64.getDecoder().decode(parts[3]),
          derive(raw, Base64.getDecoder().decode(parts[2]), rounds)
        );
      }
      return raw.getBytes(StandardCharsets.UTF_8).length <= 72 && LEGACY.matches(raw, encoded);
    } catch (Exception e) {
      return false;
    }
  }
}
