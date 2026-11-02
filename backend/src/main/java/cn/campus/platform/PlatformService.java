package cn.campus.platform;

import static cn.campus.platform.ApiError.check;
import static cn.campus.platform.Rules.*;

import com.fasterxml.jackson.databind.node.*;
import jakarta.persistence.EntityManager;
import java.nio.file.*;
import java.util.*;
import java.util.function.Function;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.*;

@Service
public class PlatformService {

  public static final Map<String, String> TABLES = new LinkedHashMap<>();

  static {
    for (String name : List.of(
      "users",
      "organizations",
      "activities",
      "applications",
      "slots",
      "notices",
      "grants",
      "audits",
      "attachments",
      "semesters"
    ))
      TABLES.put(name, "campus_" + name);
  }

  private final EntityManager em;
  private final LockRepository locks;
  private volatile ObjectNode cached;

  @Value("${campus.files}")
  String files;

  @Value("${campus.demo:false}")
  boolean demo;

  @Value("${campus.identity-mode:formal}")
  String identityMode;

  @Value("${campus.bootstrap-admin-password:}")
  String bootstrapPassword;

  public String mode() {
    return demo ? "demo" : identityMode;
  }

  public boolean accepts(ObjectNode u) {
    if (u == null) return false;
    var source = text(u, "identitySource");
    return mode().equals("demo")
      ? source.equals("demo")
      : mode().equals("local-mail")
        ? source.equals("local-mail")
        : java.util.List.of("campus-email", "school", "bootstrap", "legacy").contains(source);
  }

  @Transactional
  public ObjectNode identityMutation(Function<ObjectNode, ObjectNode> operation) {
    return transaction(operation);
  }

  public PlatformService(EntityManager em, LockRepository locks) {
    this.em = em;
    this.locks = locks;
  }

  @Transactional
  public void initialize() throws Exception {
    Files.createDirectories(Path.of(files));
    locks.acquire();
    var s = load();
    boolean fresh = list(s, "users").isEmpty();
    if (fresh) {
      s = (ObjectNode) JSON.readTree(new ClassPathResource("seed.json").getInputStream());
      s.remove("now");
      s.put("identityMode", mode());
      if (mode().equals("formal")) {
        for (String key : TABLES.keySet()) s.set(key, arr());
        if (!bootstrapPassword.isEmpty()) {
          var admin = obj()
            .put("id", id())
            .put("studentNo", "admin")
            .put("name", "平台管理员")
            .put("passwordHash", Passwords.encode(bootstrapPassword))
            .put("identitySource", "bootstrap")
            .put("accountStatus", "active")
            .put("bindingStatus", "unbound")
            .put("sessionVersion", 0);
          admin.set("roles", arr().add("admin"));
          admin.set("orgIds", arr());
          add(s, "users", admin);
        }
      }
    }
    for (var u : list(s, "users")) {
      if (mode().equals("demo") || (fresh && mode().equals("local-mail"))) {
        if (!u.has("identitySource") || fresh) u.put("identitySource", mode());
        if (!u.has("accountStatus")) u.put("accountStatus", "active");
        if (!u.has("bindingStatus")) u.put("bindingStatus", "bound");
        if (!u.has("emailVerifiedAt")) u.put("emailVerifiedAt", java.time.Instant.now().toString());
        if (!u.has("email")) u.put("email", text(u, "studentNo") + "@stu.neu.edu.cn");
        if (fresh) u.put("passwordHash", Passwords.encode("Demo123!"));
      } else if (!u.has("identitySource")) {
        u.put("identitySource", "legacy")
          .put("accountStatus", "pending")
          .put("bindingStatus", "unbound");
      }
      check(accepts(u), 503, "身份环境与数据库不匹配，请使用独立数据库和文件目录");
    }
    if (!mode().equals("formal")) for (var r : list(s, "applications"))
      if (!r.has("memberUserIds")) {
        var ids = arr();
        list(s, "users")
          .stream()
          .filter(u -> contains(r.path("memberNos"), text(u, "studentNo")) && Identity.verified(u))
          .forEach(u -> ids.add(text(u, "id")));
        r.set("memberUserIds", ids);
      }
    reconcile(s);
    tick(s);
    save(s);
    publish(s);
  }

  public ObjectNode state() {
    check(cached != null, 503, "服务正在初始化");
    return cached;
  }

  public ObjectNode view(String userId) {
    return snapshot(state(), userId);
  }

  public ObjectNode userByNo(String studentNo) {
    if (studentNo.isBlank()) return null;
    return list(state(), "users")
      .stream()
      .filter(
        u ->
          !text(u, "accountStatus").equals("disabled") &&
          (text(u, "studentNo").equals(studentNo) || text(u, "email").equals(studentNo))
      )
      .findFirst()
      .orElse(null);
  }

  public boolean passwordMatches(String raw, String encoded) {
    return Passwords.matches(raw, encoded);
  }

  @Transactional
  public ObjectNode mutate(String userId, String action, ObjectNode p) {
    return transaction(s -> execute(s, userId, action, p));
  }

  public ObjectNode register(ObjectNode p) {
    throw new ApiError(403, "请通过校园邮箱核验注册");
  }

  @Transactional
  public void event(String userId, String action) {
    transaction(s -> {
      audit(s, userId == null ? "anonymous" : userId, action, null, "");
      return obj();
    });
  }

  @Transactional
  public void scheduled() {
    if (cached != null) transaction(s -> {
      tick(s);
      return obj();
    });
  }

  @Transactional
  public void reset(String userId) throws Exception {
    check(demo, 403, "仅课程演示环境允许重置");
    check(admin(find(state(), "users", userId)), 403, "需要管理员权限");
    var fresh = (ObjectNode) JSON.readTree(new ClassPathResource("seed.json").getInputStream());
    fresh.remove("now");
    for (var u : list(fresh, "users")) u.put("passwordHash", Passwords.encode("Demo123!"));
    transaction(s -> {
      for (String k : TABLES.keySet()) s.set(k, fresh.path(k));
      reconcile(s);
      return obj();
    });
  }

  @Transactional
  public ObjectNode upload(String userId, ObjectNode payload) throws Exception {
    check(find(state(), "users", userId) != null, 401, "请先登录");
    check(Identity.available(find(state(), "users", userId)), 403, "请先完成身份核验");
    String name = text(payload, "name"),
      mime = text(payload, "mime"),
      data = text(payload, "data");
    check(
      name.length() > 0 && name.length() < 240 && data.length() <= 29 * 1024 * 1024,
      "文件名或大小无效"
    );
    int comma = data.indexOf(',');
    check(comma > 0 && data.substring(0, comma).endsWith(";base64"), "文件编码不正确");
    byte[] bytes;
    try {
      bytes = Base64.getDecoder().decode(data.substring(comma + 1));
    } catch (Exception e) {
      throw new ApiError(422, "文件编码无效");
    }
    check(
      bytes.length > 0 &&
        bytes.length <= 20 * 1024 * 1024 &&
        bytes.length == payload.path("size").asInt(),
      "文件大小不正确或超过20MB"
    );
    String ext = name.contains(".")
      ? name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT)
      : "";
    Map<String, String> allowed = Map.of(
      "png",
      "image/png",
      "jpg",
      "image/jpeg",
      "jpeg",
      "image/jpeg",
      "gif",
      "image/gif",
      "webp",
      "image/webp",
      "pdf",
      "application/pdf",
      "zip",
      "application/zip"
    );
    String expected = allowed.get(ext);
    String detected = new org.apache.tika.Tika().detect(bytes);
    check(
      expected != null &&
        expected.equals(detected) &&
        (expected.equals(mime) ||
          (ext.equals("zip") && mime.equals("application/x-zip-compressed"))),
      "文件扩展名、声明类型与实际内容不一致"
    );
    String id = id();
    Path target = Path.of(files).toAbsolutePath().resolve(id);
    Files.write(target, bytes, StandardOpenOption.CREATE_NEW);
    TransactionSynchronizationManager.registerSynchronization(
      new TransactionSynchronization() {
        @Override
        public void afterCompletion(int status) {
          if (status != STATUS_COMMITTED) try {
            Files.deleteIfExists(target);
          } catch (Exception ignored) {}
        }
      }
    );
    return transaction(s -> {
      add(
        s,
        "attachments",
        obj()
          .put("id", id)
          .put("ownerId", userId)
          .put("name", name)
          .put("mime", expected)
          .put("size", bytes.length)
      );
      return obj().put("id", id);
    });
  }

  public byte[] file(String userId, String id) throws Exception {
    check(
      list(view(userId), "attachments")
        .stream()
        .anyMatch(f -> text(f, "id").equals(id)),
      403,
      "无权访问此附件"
    );
    check(id.matches("[a-zA-Z0-9-]{1,64}"), 404, "文件不存在");
    Path target = Path.of(files).toAbsolutePath().resolve(id);
    check(Files.exists(target), 404, "文件不存在");
    return Files.readAllBytes(target);
  }

  private ObjectNode transaction(Function<ObjectNode, ObjectNode> f) {
    locks.acquire();
    var s = load();
    var result = f.apply(s);
    save(s);
    publish(s);
    return result;
  }

  private ObjectNode load() {
    var s = obj().put("schema", 2).put("identityMode", mode());
    for (var entry : TABLES.entrySet()) {
      var values = arr();
      for (var body : em.createNativeQuery("SELECT body FROM " + entry.getValue()).getResultList())
        try {
          values.add(JSON.readTree(body.toString()));
        } catch (Exception e) {
          throw new IllegalStateException("数据解析失败");
        }
      s.set(entry.getKey(), values);
    }
    return s;
  }

  private void save(ObjectNode s) {
    for (var entry : TABLES.entrySet()) {
      Map<String, String> old = new HashMap<>();
      for (var record : em
        .createNativeQuery("SELECT id,body FROM " + entry.getValue())
        .getResultList()) {
        Object[] pair = (Object[]) record;
        old.put(pair[0].toString(), pair[1].toString());
      }
      for (var item : list(s, entry.getKey())) {
        String id = text(item, "id"),
          body = item.toString();
        String previous = old.remove(id);
        if (previous == null) em.createNativeQuery(
          "INSERT INTO " + entry.getValue() + " (id,body) VALUES (:id,:body)"
        )
          .setParameter("id", id)
          .setParameter("body", body)
          .executeUpdate();
        else if (!previous.equals(body)) em.createNativeQuery(
          "UPDATE " + entry.getValue() + " SET body=:body WHERE id=:id"
        )
          .setParameter("id", id)
          .setParameter("body", body)
          .executeUpdate();
      }
      for (var removed : old.keySet())
        em.createNativeQuery("DELETE FROM " + entry.getValue() + " WHERE id=:id")
          .setParameter("id", removed)
          .executeUpdate();
    }
    for (var u : list(s, "users"))
      if (!text(u, "email").isEmpty() && !text(u, "emailVerifiedAt").isEmpty()) {
        long count = (
          (Number) em
            .createNativeQuery("SELECT COUNT(*) FROM account_identity WHERE user_id=:u")
            .setParameter("u", text(u, "id"))
            .getSingleResult()
        ).longValue();
        if (count == 0) em.createNativeQuery(
          "INSERT INTO account_identity(user_id,email,student_no) VALUES (:u,:e,:n)"
        )
          .setParameter("u", text(u, "id"))
          .setParameter("e", text(u, "email"))
          .setParameter("n", Identity.verified(u) ? text(u, "studentNo") : null)
          .executeUpdate();
      }
    em.createNativeQuery("DELETE FROM registration_member").executeUpdate();
    em.createNativeQuery("DELETE FROM slot_reservation").executeUpdate();
    for (var r : list(s, "applications"))
      if (!text(r, "status").equals("withdrawn")) {
        for (var n : r.path("memberNos"))
          em.createNativeQuery(
            "INSERT INTO registration_member(activity_id,student_no,application_id,user_id) VALUES (:a,:n,:r,:u)"
          )
            .setParameter("a", text(r, "activityId"))
            .setParameter("n", n.asText())
            .setParameter(
              "u",
              list(s, "users")
                .stream()
                .filter(
                  u ->
                    contains(r.path("memberUserIds"), text(u, "id")) &&
                    text(u, "studentNo").equals(n.asText())
                )
                .map(u -> text(u, "id"))
                .findFirst()
                .orElse(null)
            )
            .setParameter("r", text(r, "id"))
            .executeUpdate();
        if (!text(r, "slotId").isEmpty()) em.createNativeQuery(
          "INSERT INTO slot_reservation(application_id,slot_id) VALUES (:r,:s)"
        )
          .setParameter("r", text(r, "id"))
          .setParameter("s", text(r, "slotId"))
          .executeUpdate();
      }
  }

  private void publish(ObjectNode s) {
    var committed = s.deepCopy();
    TransactionSynchronizationManager.registerSynchronization(
      new TransactionSynchronization() {
        @Override
        public void afterCommit() {
          cached = committed;
          cleanup(committed);
        }
      }
    );
  }

  private void reconcile(ObjectNode s) {
    Path ledger = Path.of(files).resolve("archive-ledger.json");
    if (Files.exists(ledger)) try {
      for (var id : JSON.readTree(Files.readString(ledger))) {
        var a = find(s, "activities", id.asText());
        if (a != null && !flag(a, "archived")) archive(s, a);
      }
    } catch (Exception e) {
      throw new IllegalStateException("归档清理记录无法读取，已阻止启动", e);
    }
  }

  private void cleanup(ObjectNode s) {
    try {
      Path root = Path.of(files).toAbsolutePath();
      Set<String> archived = new HashSet<>();
      Path ledger = root.resolve("archive-ledger.json");
      if (Files.exists(ledger)) JSON.readTree(Files.readString(ledger)).forEach(v ->
        archived.add(v.asText())
      );
      list(s, "activities")
        .stream()
        .filter(a -> flag(a, "archived"))
        .forEach(a -> archived.add(text(a, "id")));
      Path tmp = root.resolve("archive-ledger.tmp");
      Files.writeString(tmp, JSON.writeValueAsString(archived));
      Files.move(tmp, ledger, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
      Set<String> live = list(s, "attachments")
        .stream()
        .map(f -> text(f, "id"))
        .collect(java.util.stream.Collectors.toSet());
      try (var paths = Files.list(root)) {
        for (var path : paths
          .filter(p -> p.getFileName().toString().matches("[0-9a-f-]{36}"))
          .toList())
          if (!live.contains(path.getFileName().toString())) Files.deleteIfExists(path);
      }
    } catch (Exception e) {
      throw new IllegalStateException("归档附件清理失败，需要维护", e);
    }
  }
}
