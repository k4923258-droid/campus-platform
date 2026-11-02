package cn.campus.platform;

import static cn.campus.platform.Rules.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class AuthController {

  @org.springframework.beans.factory.annotation.Value("${campus.maintenance:false}")
  boolean maintenance;

  @ModelAttribute
  public void ready() {
    cn.campus.platform.ApiError.check(!maintenance, 503, "系统维护中，身份服务暂不可用");
  }

  private final AuthService auth;
  private final PlatformService platform;

  public AuthController(AuthService auth, PlatformService platform) {
    this.auth = auth;
    this.platform = platform;
  }

  @GetMapping("/auth/providers")
  public ObjectNode providers() {
    return auth.providers();
  }

  @GetMapping({ "/auth/login/neu", "/auth/callback/neu" })
  public ObjectNode school() {
    throw new ApiError(503, "学校统一认证尚未接入，当前不可用");
  }

  @GetMapping("/session")
  public ObjectNode session(HttpServletRequest request) {
    var id = auth.sessionUser(request);
    var out = obj();
    out.set(
      "me",
      id == null ? null : Identity.publicUser(find(platform.state(), "users", id), true)
    );
    return out;
  }

  @PostMapping("/auth/email/challenges")
  public ObjectNode challenge(@RequestBody ObjectNode p, HttpServletRequest r) {
    return auth.requestChallenge(p, r.getRemoteAddr(), auth.sessionUser(r));
  }

  @PostMapping("/auth/register")
  public ObjectNode register(@RequestBody ObjectNode p, HttpServletRequest r) {
    return auth.register(p, r.getRemoteAddr());
  }

  @PostMapping("/auth/password/reset")
  public ObjectNode reset(@RequestBody ObjectNode p, HttpServletRequest r) {
    return auth.resetPassword(p, r.getRemoteAddr());
  }

  @PostMapping("/auth/identity/bind")
  public ObjectNode bind(@RequestBody ObjectNode p, HttpServletRequest r) {
    return auth.bind(p, auth.sessionUser(r), false, r.getRemoteAddr());
  }

  @PostMapping("/auth/email/change")
  public ObjectNode change(@RequestBody ObjectNode p, HttpServletRequest r) {
    return auth.bind(p, auth.sessionUser(r), true, r.getRemoteAddr());
  }

  @PostMapping("/activities/{activityId}/team-members/resolve")
  public ObjectNode member(
    @PathVariable String activityId,
    @RequestBody ObjectNode p,
    HttpServletRequest r
  ) {
    return auth.resolveMember(
      auth.sessionUser(r),
      activityId,
      text(p, "studentNo"),
      r.getRemoteAddr()
    );
  }

  @GetMapping("/auth/identity-conflicts")
  public ObjectNode conflicts(HttpServletRequest r) {
    return auth.conflicts(auth.sessionUser(r));
  }

  @PostMapping("/auth/identity-conflicts/{id}/resolve")
  public ObjectNode conflict(
    @PathVariable String id,
    @RequestBody ObjectNode p,
    HttpServletRequest r
  ) {
    return auth.resolveConflict(auth.sessionUser(r), id, p);
  }
}
