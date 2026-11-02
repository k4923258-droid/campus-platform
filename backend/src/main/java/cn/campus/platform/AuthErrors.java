package cn.campus.platform;

import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice(assignableTypes = AuthController.class)
public class AuthErrors {

  @ExceptionHandler(ApiError.class)
  public ResponseEntity<?> domain(ApiError error) {
    return response(error, UUID.randomUUID().toString());
  }

  public static ResponseEntity<?> response(ApiError error, String requestId) {
    var result = ResponseEntity.status(error.status);
    if (error.retryAfter != null) result.header("Retry-After", error.retryAfter.toString());
    return result.body(Map.of("message", error.getMessage(), "requestId", requestId));
  }

  @ExceptionHandler({
    org.springframework.http.converter.HttpMessageNotReadableException.class,
    IllegalArgumentException.class,
  })
  public ResponseEntity<?> malformed(Exception error) {
    return ResponseEntity.unprocessableEntity().body(Map.of("message", "请求格式不正确"));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<?> unexpected(Exception error) {
    String requestId = UUID.randomUUID().toString();
    org.slf4j.LoggerFactory.getLogger(AuthErrors.class).error(
      "requestId={} module=auth error={}",
      requestId,
      error.getClass().getSimpleName()
    );
    return ResponseEntity.internalServerError().body(
      Map.of("message", "服务暂时无法完成请求，请稍后重试", "requestId", requestId)
    );
  }
}
