package cn.campus.platform;

import static cn.campus.platform.ApiError.check;
import static cn.campus.platform.Rules.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.http.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class ApiController implements ApplicationRunner {

  private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(
    ApiController.class
  );
  private static final String LOG_SALT = UUID.randomUUID().toString();
  private final PlatformService service;

  @Value("${campus.maintenance:false}")
  boolean maintenance;

  public ApiController(PlatformService service) {
    this.service = service;
  }

  @Override
  public void run(ApplicationArguments arguments) throws Exception {
    service.initialize();
  }

  @Scheduled(fixedDelay = 30000, initialDelay = 30000)
  public void tick() {
    service.scheduled();
  }

  private String user(HttpServletRequest request) {
    var session = request.getSession(false);
    return session == null ? null : (String) session.getAttribute("userId");
  }

  private void ready() {
    check(!maintenance, 503, "系统维护中，归档清理完成后再开放访问");
  }

  @GetMapping("/health")
  public Map<String, String> health() {
    return Map.of("status", maintenance ? "maintenance" : "up");
  }

  @GetMapping("/csrf")
  public Map<String, String> csrf(CsrfToken token) {
    return Map.of("token", token.getToken());
  }

  @GetMapping("/snapshot")
  public ObjectNode view(HttpServletRequest request) {
    ready();
    return service.view(user(request));
  }

  @PostMapping("/session")
  public ObjectNode login(@RequestBody ObjectNode p, HttpServletRequest request) {
    ready();
    var u = service.userByNo(text(p, "studentNo"));
    if (u == null || !service.passwordMatches(text(p, "password"), text(u, "passwordHash"))) {
      service.event(null, "登录失败");
      throw new ApiError(401, "学号或密码错误");
    }
    var old = request.getSession(false);
    if (old != null) old.invalidate();
    var session = request.getSession(true);
    session.setMaxInactiveInterval(1800);
    session.setAttribute("userId", text(u, "id"));
    service.event(text(u, "id"), "登录");
    return obj().put("ok", true);
  }

  @DeleteMapping("/session")
  public ObjectNode logout(HttpServletRequest request) {
    service.event(user(request), "退出登录");
    var session = request.getSession(false);
    if (session != null) session.invalidate();
    return obj().put("ok", true);
  }

  @PostMapping("/commands/{action}")
  public ObjectNode command(
    @PathVariable String action,
    @RequestBody ObjectNode p,
    HttpServletRequest request
  ) {
    ready();
    if (action.equals("register")) return service.register(p);
    return service.mutate(user(request), action, p);
  }

  @PostMapping("/files")
  public ObjectNode upload(@RequestBody ObjectNode p, HttpServletRequest request) throws Exception {
    ready();
    return service.upload(user(request), p);
  }

  @GetMapping("/files/{id}")
  public ResponseEntity<byte[]> file(@PathVariable String id, HttpServletRequest request)
    throws Exception {
    ready();
    byte[] body = service.file(user(request), id);
    var f = find(service.state(), "attachments", id);
    return ResponseEntity.ok()
      .contentType(MediaType.parseMediaType(text(f, "mime")))
      .header(
        "Content-Disposition",
        "attachment; filename*=UTF-8''" + URLEncoder.encode(text(f, "name"), StandardCharsets.UTF_8)
      )
      .header("Cache-Control", "no-store")
      .body(body);
  }

  @PostMapping("/demo/reset")
  public ObjectNode reset(HttpServletRequest request) throws Exception {
    ready();
    service.reset(user(request));
    var session = request.getSession(false);
    if (session != null) session.invalidate();
    return obj().put("ok", true);
  }

  @ExceptionHandler(ApiError.class)
  public ResponseEntity<?> domain(ApiError error, HttpServletRequest request) {
    String requestId = UUID.randomUUID().toString();
    if (error.status == 403) service.event(user(request), "拒绝越权访问");
    return ResponseEntity.status(error.status).body(
      Map.of("message", error.getMessage(), "requestId", requestId)
    );
  }

  @ExceptionHandler({
    org.springframework.http.converter.HttpMessageNotReadableException.class,
    IllegalArgumentException.class,
  })
  public ResponseEntity<?> malformed(Exception error) {
    return ResponseEntity.unprocessableEntity().body(Map.of("message", "请求格式不正确"));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<?> unexpected(Exception error, HttpServletRequest request) {
    String requestId = UUID.randomUUID().toString();
    String pseudonym;
    try {
      pseudonym = HexFormat.of()
        .formatHex(
          java.security.MessageDigest.getInstance("SHA-256").digest(
            (LOG_SALT + Objects.toString(user(request), "anonymous")).getBytes(
              StandardCharsets.UTF_8
            )
          )
        )
        .substring(0, 16);
    } catch (Exception impossible) {
      pseudonym = "anonymous";
    }
    LOG.error(
      "requestId={} user={} module={} error={}",
      requestId,
      pseudonym,
      request.getRequestURI(),
      error.getClass().getSimpleName()
    );
    return ResponseEntity.status(500).body(
      Map.of("message", "服务暂时无法完成请求，请稍后重试", "requestId", requestId)
    );
  }
}
