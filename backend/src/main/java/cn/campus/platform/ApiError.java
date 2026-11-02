package cn.campus.platform;

public class ApiError extends RuntimeException {

  public final int status;
  public final Integer retryAfter;

  public ApiError(int status, String message) {
    this(status, message, null);
  }

  public ApiError(int status, String message, Integer retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }

  public static void check(boolean ok, String message) {
    check(ok, 422, message);
  }

  public static void check(boolean ok, int status, String message) {
    if (!ok) throw new ApiError(status, message);
  }
}
