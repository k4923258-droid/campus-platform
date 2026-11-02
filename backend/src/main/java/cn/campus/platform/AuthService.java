package cn.campus.platform;

import static cn.campus.platform.ApiError.check;
import static cn.campus.platform.Rules.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Instant;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AuthService {

  private final PlatformService platform;
  private final JdbcTemplate db;
  private final JavaMailSender mail;
  private final TransactionTemplate independent;
  private final Environment env;
  private final SecureRandom random = new SecureRandom();
  private final byte[] ephemeralKey = new byte[32];

  @Value("${campus.mail-enabled:false}")
  boolean mailEnabled;

  @Value("${campus.mail-from:campus@localhost}")
  String from;

  @Value("${campus.otp-secret:}")
  String configuredSecret;

  @Value("${campus.email-domains:stu.neu.edu.cn,mails.neu.edu.cn}")
  String domains;

  @Value("${campus.auth-send-ip-hour:120}")
  int sendIpLimit;

  @Value("${campus.auth-send-email-hour:20}")
  int sendEmailLimit;

  @Value("${campus.auth-login-ip-quarter:300}")
  int loginIpLimit;

  @Value("${campus.auth-login-account-quarter:15}")
  int loginAccountLimit;

  public AuthService(
    PlatformService platform,
    JdbcTemplate db,
    JavaMailSender mail,
    PlatformTransactionManager tx,
    Environment env
  ) {
    this.platform = platform;
    this.db = db;
    this.mail = mail;
    this.env = env;
    independent = new TransactionTemplate(tx);
    independent.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    random.nextBytes(ephemeralKey);
  }

  @PostConstruct
  void configuration() {
    check(
      !platform.mode().equals("local-mail") ||
        Arrays.asList(env.getActiveProfiles()).contains("local"),
      503,
      "本地邮件身份仅可在local配置中运行"
    );
    if (platform.mode().equals("formal") && mailEnabled) {
      check(configuredSecret.length() >= 32, 503, "正式邮件核验须配置至少32字符的验证码密钥");
      check(
        env.getProperty(
          "spring.mail.properties.mail.smtp.starttls.required",
          Boolean.class,
          false
        ) || env.getProperty("spring.mail.properties.mail.smtp.ssl.enable", Boolean.class, false),
        503,
        "正式SMTP须使用TLS"
      );
    }
  }

  long now() {
    return System.currentTimeMillis();
  }

  String digest(String input) {
    try {
      var h = Mac.getInstance("HmacSHA256");
      h.init(
        new SecretKeySpec(
          configuredSecret.isEmpty()
            ? ephemeralKey
            : configuredSecret.getBytes(StandardCharsets.UTF_8),
          "HmacSHA256"
        )
      );
      return HexFormat.of().formatHex(h.doFinal(input.getBytes(StandardCharsets.UTF_8)));
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  String email(String value) {
    String input = value.trim();
    int at = input.indexOf('@');
    check(at > 0 && at == input.lastIndexOf('@') && input.length() <= 254, "校园邮箱格式错误");
    String domain = input.substring(at + 1).toLowerCase(Locale.ROOT),
      local = input.substring(0, at);
    check(
      Arrays.stream(domains.split(",")).map(String::trim).anyMatch(domain::equals),
      "请使用允许的校园邮箱域名"
    );
    check(local.matches("[A-Za-z0-9._+-]{1,64}"), "校园邮箱格式错误");
    return local + "@" + domain;
  }

  String trustedNo(String address) {
    // Only the documented old-domain mapping is enabled. No guessed new-domain mapping.
    if (address.matches("[0-9]{6,20}@stu\\.neu\\.edu\\.cn")) return address.substring(
      0,
      address.indexOf('@')
    );
    return "";
  }

  void limit(String scope, String value, int max, long window) {
    Long retry = independent.execute(status -> {
      String key = scope + ":" + digest(value);
      db.update(
        "INSERT INTO security_rate(rate_key,window_start,hits) VALUES (?,?,0) ON DUPLICATE KEY UPDATE rate_key=rate_key",
        key,
        now()
      );
      var row = db.queryForMap(
        "SELECT window_start,hits FROM security_rate WHERE rate_key=? FOR UPDATE",
        key
      );
      boolean expired = now() - ((Number) row.get("window_start")).longValue() >= window;
      int count = expired ? 0 : ((Number) row.get("hits")).intValue();
      if (count >= max) return Math.max(
        1L,
        (((Number) row.get("window_start")).longValue() + window - now() + 999) / 1000
      );
      db.update(
        "UPDATE security_rate SET hits=?,window_start=? WHERE rate_key=?",
        count + 1,
        expired ? now() : row.get("window_start"),
        key
      );
      return 0L;
    });
    if (retry != null && retry > 0) throw new ApiError(
      429,
      "操作频繁，请在" + retry + "秒后重试",
      retry.intValue()
    );
  }

  public void loginLimit(String ip, String login) {
    limit("login-ip", ip, loginIpLimit, 900000);
    limit("login-account", login.trim().toLowerCase(Locale.ROOT), loginAccountLimit, 900000);
  }

  public ObjectNode providers() {
    var out = obj()
      .put("mode", platform.mode())
      .put("emailAvailable", mailEnabled)
      .put("schoolAvailable", false);
    out.set(
      "emailDomains",
      JSON.valueToTree(Arrays.stream(domains.split(",")).map(String::trim).toList())
    );
    return out;
  }

  public String sessionUser(HttpServletRequest request) {
    var session = request.getSession(false);
    if (session == null) return null;
    var id = (String) session.getAttribute("userId");
    var u = find(platform.state(), "users", id == null ? "" : id);
    Object version = session.getAttribute("securityVersion");
    if (
      u == null ||
      !platform.accepts(u) ||
      text(u, "accountStatus").equals("disabled") ||
      !(version instanceof Integer) ||
      (Integer) version != num(u, "sessionVersion")
    ) {
      session.invalidate();
      return null;
    }
    return id;
  }

  ObjectNode user(String userId) {
    var u = find(platform.state(), "users", userId == null ? "" : userId);
    check(u != null && platform.accepts(u), 401, "请先登录");
    return u;
  }

  public ObjectNode requestChallenge(ObjectNode p, String ip, String userId) {
    check(mailEnabled, 503, "邮件验证服务尚未配置");
    String address = email(text(p, "email")),
      purpose = text(p, "purpose");
    check(
      List.of("register", "password-reset", "bind", "email-change").contains(purpose),
      "验证用途无效"
    );
    if (List.of("bind", "email-change").contains(purpose)) {
      var u = user(userId);
      limit("reauth", userId, 10, 900000);
      check(
        Passwords.matches(text(p, "password"), text(u, "passwordHash")),
        403,
        "请重新验证当前密码"
      );
    }
    limit("send-ip", ip, sendIpLimit, 3600000);
    limit("send-email", address, sendEmailLimit, 3600000);
    return platform.identityMutation(s -> {
      var last = db.queryForList(
        "SELECT created_at FROM email_challenge WHERE email=? ORDER BY created_at DESC LIMIT 1",
        address
      );
      check(
        last.isEmpty() || now() - ((Number) last.getFirst().get("created_at")).longValue() >= 60000,
        429,
        "请等待60秒后重发"
      );
      String challengeId = id(),
        code = String.format(Locale.ROOT, "%06d", random.nextInt(1000000));
      long expires = now() + 300000;
      db.update(
        "INSERT INTO email_challenge(id,email,purpose,digest,expires_at,created_at,delivery_status) VALUES (?,?,?,?,?,?,?)",
        challengeId,
        address,
        purpose,
        digest(challengeId + "|" + address + "|" + purpose + "|" + code),
        expires,
        now(),
        "pending"
      );
      try {
        var message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(address);
        message.setSubject(
          (platform.mode().equals("formal") ? "" : "[本地测试] ") + "校园平台验证码"
        );
        message.setText(
          "验证码：" +
            code +
            "\n用途：" +
            purpose +
            "\n5分钟有效，一次使用。若非本人操作，请忽略此邮件。"
        );
        mail.send(message);
      } catch (Exception error) {
        throw new ApiError(503, "验证码邮件投递失败，请稍后重试");
      }
      db.update(
        "UPDATE email_challenge SET used=TRUE WHERE email=? AND purpose=? AND id<>?",
        address,
        purpose,
        challengeId
      );
      db.update("UPDATE email_challenge SET delivery_status='sent' WHERE id=?", challengeId);
      db.update("DELETE FROM email_challenge WHERE expires_at<?", now() - 86400000L);
      db.update("DELETE FROM security_rate WHERE window_start<?", now() - 86400000L);
      return obj()
        .put("challengeId", challengeId)
        .put("expiresAt", Instant.ofEpochMilli(expires).toString())
        .put("retryAfter", 60);
    });
  }

  Map<String, Object> challenge(String challengeId) {
    var rows = db.queryForList("SELECT * FROM email_challenge WHERE id=? FOR UPDATE", challengeId);
    check(!rows.isEmpty(), 422, "验证码申请无效或已过期");
    return rows.getFirst();
  }

  boolean used(Map<String, Object> c) {
    return (
      Boolean.TRUE.equals(c.get("used")) || (c.get("used") instanceof Number n && n.intValue() != 0)
    );
  }

  boolean valid(Map<String, Object> c, String purpose, String code) {
    if (!code.matches("[0-9]{6}")) return false;
    String expected = digest(c.get("id") + "|" + c.get("email") + "|" + purpose + "|" + code);
    return (
      purpose.equals(c.get("purpose")) &&
      !used(c) &&
      ((Number) c.get("attempts")).intValue() < 5 &&
      ((Number) c.get("expires_at")).longValue() > now() &&
      "sent".equals(c.get("delivery_status")) &&
      MessageDigest.isEqual(
        expected.getBytes(StandardCharsets.US_ASCII),
        c.get("digest").toString().getBytes(StandardCharsets.US_ASCII)
      )
    );
  }

  void verify(String challengeId, String purpose, String code) {
    boolean ok = Boolean.TRUE.equals(
      independent.execute(status -> {
        var rows = db.queryForList(
          "SELECT * FROM email_challenge WHERE id=? FOR UPDATE",
          challengeId
        );
        if (rows.isEmpty()) return false;
        var c = rows.getFirst();
        if (valid(c, purpose, code)) return true;
        db.update(
          "UPDATE email_challenge SET attempts=LEAST(attempts+1,5) WHERE id=?",
          challengeId
        );
        return false;
      })
    );
    if (!ok) org.slf4j.LoggerFactory.getLogger(AuthService.class).info(
      "event=identity-verification-failed requestId={} subject={}",
      UUID.randomUUID(),
      digest(challengeId).substring(0, 16)
    );
    check(ok, 422, "验证码无效、已过期、已使用或尝试超限，请重新申请");
  }

  Map<String, Object> consume(ObjectNode p, String purpose) {
    var c = challenge(text(p, "challengeId"));
    check(valid(c, purpose, text(p, "code")), 422, "验证码已失效，请重新申请");
    check(!p.has("email") || email(text(p, "email")).equals(c.get("email")), "邮箱与验证申请不符");
    db.update("UPDATE email_challenge SET used=TRUE WHERE id=?", text(p, "challengeId"));
    return c;
  }

  void insertUser(ObjectNode s, ObjectNode u, String address, String no) {
    db.update("INSERT INTO campus_users(id,body) VALUES (?,?)", text(u, "id"), u.toString());
    add(s, "users", u);
    db.update(
      "INSERT INTO account_identity(user_id,email,student_no) VALUES (?,?,?)",
      text(u, "id"),
      address,
      no.isEmpty() ? null : no
    );
  }

  public ObjectNode register(ObjectNode p, String ip) {
    check(mailEnabled, 503, "邮件验证服务尚未配置");
    limit("register-ip", ip, 60, 3600000);
    Passwords.validate(text(p, "password"));
    check(
      !text(p, "name").isBlank() && text(p, "name").length() <= 60,
      "请填写显示姓名（最多60字）"
    );
    verify(text(p, "challengeId"), "register", text(p, "code"));
    return platform.identityMutation(s -> {
      var c = consume(p, "register");
      String address = c.get("email").toString(),
        no = trustedNo(address);
      check(
        !p.has("studentNo") || text(p, "studentNo").equals(no),
        "学号必须来自已验证邮箱的可信映射"
      );
      check(
        db.queryForObject(
          "SELECT COUNT(*) FROM account_identity WHERE email=?",
          Integer.class,
          address
        ) == 0,
        409,
        "该邮箱已绑定账号，请登录或恢复密码"
      );
      var existing = no.isEmpty()
        ? null
        : list(s, "users")
            .stream()
            .filter(
              u -> text(u, "studentNo").equals(no) && !text(u, "accountStatus").equals("disabled")
            )
            .findFirst()
            .orElse(null);
      boolean ready = !no.isEmpty() && existing == null;
      var u = obj()
        .put("id", id())
        .put("studentNo", ready ? no : "")
        .put("email", address)
        .put("name", text(p, "name").trim())
        .put("passwordHash", Passwords.encode(text(p, "password")))
        .put("accountStatus", ready ? "active" : "pending")
        .put("bindingStatus", existing != null ? "conflict" : ready ? "bound" : "pending")
        .put("emailVerifiedAt", Instant.now().toString())
        .put("identitySource", platform.mode().equals("formal") ? "campus-email" : platform.mode())
        .put("sessionVersion", 0);
      u.set("roles", ready ? arr().add("student") : arr());
      u.set("orgIds", arr());
      insertUser(s, u, address, ready ? no : "");
      if (existing != null) db.update(
        "INSERT INTO identity_conflict(id,claimant_id,existing_id,student_no,status,created_at) VALUES (?,?,?,?,?,?)",
        id(),
        text(u, "id"),
        text(existing, "id"),
        no,
        "pending",
        now()
      );
      audit(s, text(u, "id"), "校邮注册", null, ready ? "身份已绑定" : "身份待核验");
      return obj()
        .put("id", text(u, "id"))
        .put("status", text(u, "bindingStatus"))
        .put(
          "message",
          ready ? "注册成功，请登录" : "邮箱已验证，学号绑定待核验；目前仅可浏览公开信息"
        );
    });
  }

  public ObjectNode resetPassword(ObjectNode p, String ip) {
    check(mailEnabled, 503, "邮件验证服务尚未配置");
    limit("reset-ip", ip, 60, 3600000);
    Passwords.validate(text(p, "password"));
    verify(text(p, "challengeId"), "password-reset", text(p, "code"));
    return platform.identityMutation(s -> {
      var c = consume(p, "password-reset");
      var u = list(s, "users")
        .stream()
        .filter(
          v -> text(v, "email").equals(c.get("email")) && !text(v, "emailVerifiedAt").isEmpty()
        )
        .findFirst()
        .orElse(null);
      check(
        u != null && !text(u, "accountStatus").equals("disabled"),
        422,
        "无法恢复该账号，请联系管理员核验"
      );
      u.put("passwordHash", Passwords.encode(text(p, "password"))).put(
        "sessionVersion",
        num(u, "sessionVersion") + 1
      );
      db.update("UPDATE email_challenge SET used=TRUE WHERE email=?", text(u, "email"));
      audit(s, text(u, "id"), "重置密码", null, "已撤销全部既有会话");
      return obj().put("ok", true);
    });
  }

  public ObjectNode bind(ObjectNode p, String userId, boolean change, String ip) {
    check(mailEnabled, 503, "邮件验证服务尚未配置");
    var current = user(userId);
    limit("bind-ip", ip, 30, 3600000);
    limit("reauth", userId, 10, 900000);
    check(
      change ? Identity.verified(current) : !Identity.verified(current),
      409,
      change ? "请先完成身份绑定" : "已核验账号请使用邮箱换绑入口"
    );
    check(
      Passwords.matches(text(p, "password"), text(current, "passwordHash")),
      403,
      "当前密码错误"
    );
    verify(text(p, "challengeId"), change ? "email-change" : "bind", text(p, "code"));
    return platform.identityMutation(s -> {
      var u = find(s, "users", userId);
      var c = consume(p, change ? "email-change" : "bind");
      String address = c.get("email").toString(),
        no = trustedNo(address);
      check(!no.isEmpty(), 409, "该邮箱的学号映射尚未确认");
      check(
        text(u, "studentNo").isEmpty() || text(u, "studentNo").equals(no),
        409,
        "新邮箱与原学号不匹配，须由管理员核验"
      );
      check(
        list(s, "users")
          .stream()
          .noneMatch(
            v ->
              !text(v, "id").equals(userId) &&
              text(v, "studentNo").equals(no) &&
              !text(v, "accountStatus").equals("disabled")
          ),
        409,
        "学号存在冲突，请联系管理员"
      );
      check(
        db.queryForObject(
          "SELECT COUNT(*) FROM account_identity WHERE email=? AND user_id<>?",
          Integer.class,
          address,
          userId
        ) == 0,
        409,
        "新邮箱已被占用"
      );
      if (!text(u, "email").isEmpty() && !text(u, "email").equals(address)) {
        try {
          var m = new SimpleMailMessage();
          m.setFrom(from);
          m.setTo(text(u, "email"));
          m.setSubject("校园平台邮箱换绑通知");
          m.setText("你的账号邮箱即将变更。如非本人操作，请联系管理员。");
          mail.send(m);
        } catch (Exception e) {
          throw new ApiError(503, "原邮箱安全通知投递失败，换绑未完成");
        }
      }
      if (
        db.queryForObject(
          "SELECT COUNT(*) FROM account_identity WHERE user_id=?",
          Integer.class,
          userId
        ) == 0
      ) db.update(
        "INSERT INTO account_identity(user_id,email,student_no) VALUES (?,?,?)",
        userId,
        address,
        no
      );
      else db.update(
        "UPDATE account_identity SET email=?,student_no=? WHERE user_id=?",
        address,
        no,
        userId
      );
      boolean legacy = !Identity.verified(u);
      u.put("email", address)
        .put("studentNo", no)
        .put("emailVerifiedAt", Instant.now().toString())
        .put("bindingStatus", "bound")
        .put("accountStatus", "active")
        .put("identitySource", platform.mode().equals("formal") ? "campus-email" : platform.mode())
        .put("sessionVersion", num(u, "sessionVersion") + 1);
      if (legacy) {
        u.set("roles", arr().add("student"));
        u.set("orgIds", arr());
      }
      audit(s, userId, change ? "邮箱换绑" : "补充身份核验", null, "身份已绑定；旧会话已撤销");
      return obj().put("ok", true);
    });
  }

  public ObjectNode resolveMember(String actorId, String activityId, String number, String ip) {
    var u = user(actorId);
    check(Identity.verified(u), 403, "请先完成身份核验");
    limit("member-lookup", actorId + "|" + ip, 60, 60000);
    var a = find(platform.state(), "activities", activityId);
    check(
      a != null && flag(a, "published") && flag(a, "team") && !flag(a, "removed"),
      404,
      "活动不存在或未开放团队报名"
    );
    var member = list(platform.state(), "users")
      .stream()
      .filter(
        v -> text(v, "studentNo").equals(number) && Identity.verified(v) && platform.accepts(v)
      )
      .findFirst()
      .orElse(null);
    check(member != null, 404, "未找到可加入的已核验账号");
    return obj()
      .put("id", text(member, "id"))
      .put("name", text(member, "name"))
      .put("studentNo", number);
  }

  public ObjectNode conflicts(String actorId) {
    check(admin(user(actorId)), 403, "需要管理员权限");
    var out = obj();
    out.set(
      "items",
      JSON.valueToTree(
        db.queryForList(
          "SELECT id,claimant_id,existing_id,student_no,status,reason FROM identity_conflict ORDER BY created_at DESC"
        )
      )
    );
    return out;
  }

  public ObjectNode resolveConflict(String actorId, String conflictId, ObjectNode p) {
    check(admin(user(actorId)), 403, "需要管理员权限");
    check(text(p, "reason").trim().length() >= 10, "请填写至少10字的核验依据及迁移说明");
    return platform.identityMutation(s -> {
      var rows = db.queryForList(
        "SELECT * FROM identity_conflict WHERE id=? FOR UPDATE",
        conflictId
      );
      check(
        !rows.isEmpty() && rows.getFirst().get("status").equals("pending"),
        409,
        "冲突已处理或不存在"
      );
      var c = rows.getFirst();
      var claimant = find(s, "users", c.get("claimant_id").toString());
      var existing = find(s, "users", c.get("existing_id").toString());
      check(
        claimant != null && existing != null && text(claimant, "bindingStatus").equals("conflict"),
        409,
        "账号状态已变更"
      );
      String number = c.get("student_no").toString();
      db.update(
        "UPDATE account_identity SET student_no=NULL WHERE user_id=?",
        text(existing, "id")
      );
      db.update(
        "UPDATE account_identity SET student_no=? WHERE user_id=?",
        number,
        text(claimant, "id")
      );
      existing
        .put("accountStatus", "disabled")
        .put("sessionVersion", num(existing, "sessionVersion") + 1);
      existing.set("roles", arr());
      existing.set("orgIds", arr());
      claimant
        .put("studentNo", number)
        .put("bindingStatus", "bound")
        .put("accountStatus", "active")
        .put("sessionVersion", num(claimant, "sessionVersion") + 1);
      claimant.set("roles", arr().add("student"));
      claimant.set("orgIds", arr());
      for (var item : p.path("transferApplicationIds")) {
        var r = find(s, "applications", item.asText());
        check(
          r != null && contains(r.path("memberUserIds"), text(existing, "id")),
          409,
          "迁移范围包含未关联的报名"
        );
        var ids = arr();
        r.path("memberUserIds").forEach(v ->
          ids.add(v.asText().equals(text(existing, "id")) ? text(claimant, "id") : v.asText())
        );
        r.set("memberUserIds", ids);
        if (text(r, "captainId").equals(text(existing, "id"))) r.put(
          "captainId",
          text(claimant, "id")
        );
      }
      db.update(
        "UPDATE identity_conflict SET status='resolved',reason=? WHERE id=?",
        text(p, "reason"),
        conflictId
      );
      audit(
        s,
        actorId,
        "处理身份冲突",
        null,
        "冲突记录=" + conflictId + "；仅迁移明确选择的报名；" + text(p, "reason")
      );
      return obj().put("ok", true);
    });
  }
}
