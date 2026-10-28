package cn.campus.platform;

public class ApiError extends RuntimeException {

  public final int status;

  public ApiError(int status, String message) {
    super(message);
    this.status = status;
  }

  public static void check(boolean ok, String message) {
    check(ok, 422, message);
  }

  public static void check(boolean ok, int status, String message) {
    if (!ok) throw new ApiError(status, message);
  }
}
