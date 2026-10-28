package cn.campus.platform;

import static cn.campus.platform.ApiError.check;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.time.*;
import java.util.*;
import java.util.stream.*;

/** Commands operate on a transaction-local document; persistence publishes only after commit. */
public class Rules {

  public static final ObjectMapper JSON = new ObjectMapper();

  public static String text(JsonNode n, String k) {
    return n == null ? "" : n.path(k).asText("");
  }

  public static boolean flag(JsonNode n, String k) {
    return n != null && n.path(k).asBoolean(false);
  }

  public static int num(JsonNode n, String k) {
    return n == null ? 0 : n.path(k).asInt();
  }

  public static ObjectNode obj() {
    return JSON.createObjectNode();
  }

  public static ArrayNode arr() {
    return JSON.createArrayNode();
  }

  public static List<ObjectNode> list(JsonNode s, String k) {
    var result = new ArrayList<ObjectNode>();
    s.path(k).forEach(v -> result.add((ObjectNode) v));
    return result;
  }

  public static ObjectNode find(JsonNode s, String k, String id) {
    return list(s, k)
      .stream()
      .filter(v -> text(v, "id").equals(id))
      .findFirst()
      .orElse(null);
  }

  public static boolean contains(JsonNode values, String v) {
    if (!values.isArray()) return false;
    for (var n : values) if (n.asText().equals(v)) return true;
    return false;
  }

  public static boolean admin(JsonNode u) {
    return u != null && contains(u.path("roles"), "admin");
  }

  public static boolean manages(JsonNode u, JsonNode a) {
    return admin(u) || (u != null && contains(u.path("orgIds"), text(a, "orgId")));
  }

  public static Instant instant(String t) {
    try {
      return OffsetDateTime.parse(t).toInstant();
    } catch (Exception e) {
      try {
        return LocalDate.parse(t).atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant();
      } catch (Exception ex) {
        throw new ApiError(422, "日期格式不正确");
      }
    }
  }

  public static Instant now(JsonNode s) {
    return text(s, "now").isEmpty() ? Instant.now() : instant(text(s, "now"));
  }

  public static String stamp(JsonNode s) {
    return now(s).toString();
  }

  public static String id() {
    return UUID.randomUUID().toString();
  }

  public static void add(ObjectNode s, String key, ObjectNode value) {
    ((ArrayNode) s.get(key)).add(value);
  }

  public static void remove(
    ObjectNode s,
    String key,
    java.util.function.Predicate<ObjectNode> filter
  ) {
    ArrayNode a = arr();
    list(s, key).stream().filter(filter.negate()).forEach(a::add);
    s.set(key, a);
  }

  public static void upsert(ObjectNode s, String key, ObjectNode value) {
    remove(s, key, v -> text(v, "id").equals(text(value, "id")));
    add(s, key, value);
  }

  static void manage(JsonNode u, JsonNode a) {
    check(manages(u, a), 403, "没有该组织的管理权限");
  }

  static void writable(JsonNode a) {
    check(
      !flag(a, "archived") && !flag(a, "removed") && text(a, "closedAt").isEmpty(),
      409,
      "活动已结项、归档或下架"
    );
  }

  static void within(JsonNode s, JsonNode a) {
    writable(a);
    check(
      flag(a, "published") && !flag(a, "external") && !flag(a, "resultPublished"),
      409,
      "活动未开放报名"
    );
    check(
      !now(s).isBefore(instant(text(a, "start"))) && now(s).isBefore(instant(text(a, "end"))),
      409,
      "当前不在报名时间内"
    );
  }

  static List<ObjectNode> applications(JsonNode s, JsonNode a) {
    return list(s, "applications")
      .stream()
      .filter(r -> text(r, "activityId").equals(text(a, "id")))
      .toList();
  }

  static List<ObjectNode> members(JsonNode s, JsonNode r) {
    return list(s, "users")
      .stream()
      .filter(u -> contains(r.path("memberNos"), text(u, "studentNo")))
      .toList();
  }

  static void notice(ObjectNode s, String userId, String message, String activityId) {
    var n = obj()
      .put("id", id())
      .put("userId", userId)
      .put("text", message)
      .put("read", false)
      .put("at", stamp(s));
    if (activityId != null) n.put("activityId", activityId);
    add(s, "notices", n);
  }

  static void appNotice(ObjectNode s, JsonNode r, String message) {
    members(s, r).forEach(u -> notice(s, text(u, "id"), message, text(r, "activityId")));
  }

  public static void audit(
    ObjectNode s,
    String actor,
    String action,
    String activityId,
    String detail
  ) {
    var log = obj()
      .put("id", id())
      .put("actorId", actor)
      .put("action", action)
      .put("detail", detail)
      .put("at", stamp(s));
    if (activityId != null) log.put("activityId", activityId);
    add(s, "audits", log);
  }

  static ObjectNode activity(ObjectNode s, String id) {
    var a = find(s, "activities", id);
    check(a != null, 404, "活动不存在");
    return a;
  }

  static ObjectNode application(ObjectNode s, String id) {
    var r = find(s, "applications", id);
    check(r != null, 404, "报名不存在");
    return r;
  }

  static void captain(JsonNode u, JsonNode r) {
    check(text(u, "id").equals(text(r, "captainId")), 403, "仅队长或本人可操作");
  }

  static void history(ObjectNode s, ObjectNode r, String msg) {
    ((ArrayNode) r.get("history")).add(stamp(s) + " " + msg);
    r.put("updatedAt", stamp(s));
  }

  static void advance(ObjectNode s, ObjectNode a, ObjectNode r) {
    while (num(r, "stageIndex") < a.path("stages").size()) {
      var st = a.path("stages").get(num(r, "stageIndex"));
      if (!flag(st, "enabled") || flag(st, "automatic")) {
        if (flag(st, "enabled")) {
          var review = obj()
            .put("stage", text(st, "key"))
            .put("version", num(r, "version"))
            .put("passed", true)
            .put("committed", true)
            .put("note", "默认通过");
          ((ArrayNode) r.get("reviews")).add(review);
        }
        r.put("stageIndex", num(r, "stageIndex") + 1);
      } else {
        r.put("status", text(st, "key"));
        return;
      }
    }
    r.put("status", "eligible");
  }

  public static void tick(ObjectNode s) {
    for (var a : list(s, "activities")) {
      if (
        !flag(a, "published") ||
        flag(a, "archived") ||
        flag(a, "removed") ||
        flag(a, "resultPublished") ||
        !text(a, "closedAt").isEmpty()
      ) continue;
      for (var r : applications(s, a)) {
        if (
          List.of("withdrawn", "admitted", "unselected", "rejected").contains(text(r, "status"))
        ) continue;
        if (
          flag(a, "team") &&
          r.path("memberNos").size() < num(a, "minTeam") &&
          !now(s).isBefore(instant(text(a, "end")))
        ) {
          r.put("status", "rejected");
          r.remove("slotId");
          history(s, r, "截止时团队人数不足");
          appNotice(s, r, text(a, "title") + "：截止时团队人数不足，未通过。");
        } else if (
          text(r, "status").equals("waiting") &&
          (flag(a, "rolling") || !now(s).isBefore(instant(text(a, "end"))))
        ) advance(s, a, r);
      }
    }
    for (var a : list(s, "activities")) {
      if (text(a, "closedAt").isEmpty() || flag(a, "archived")) continue;
      Instant closed = instant(text(a, "closedAt"));
      var future = list(s, "semesters")
        .stream()
        .filter(t -> instant(text(t, "start")).isAfter(closed))
        .sorted(Comparator.comparing(t -> text(t, "start")))
        .findFirst();
      if (
        future.isPresent() &&
        !now(s).isBefore(instant(text(future.get(), "end")).plusSeconds(86400))
      ) archive(s, a);
    }
  }

  public static ObjectNode snapshot(ObjectNode s, String userId) {
    var u = find(s, "users", userId == null ? "" : userId);
    var out = s.deepCopy();
    out.remove("users");
    out.remove("attachments");
    var activities = list(s, "activities")
      .stream()
      .filter(
        a ->
          manages(u, a) ||
          (u != null &&
            applications(s, a)
              .stream()
              .anyMatch(r -> contains(r.path("memberNos"), text(u, "studentNo")))) ||
          (flag(a, "published") && !flag(a, "removed") && !flag(a, "archived"))
      )
      .toList();
    out.set("activities", JSON.valueToTree(activities));
    var rows = list(s, "applications")
      .stream()
      .filter(
        r ->
          manages(u, find(s, "activities", text(r, "activityId"))) ||
          (u != null && contains(r.path("memberNos"), text(u, "studentNo")))
      )
      .toList();
    out.set("applications", JSON.valueToTree(rows));
    for (var row : list(out, "applications"))
      if (!manages(u, find(s, "activities", text(row, "activityId")))) {
        ArrayNode committed = arr();
        row.path("reviews").forEach(v -> {
          if (flag(v, "committed")) committed.add(v);
        });
        row.set("reviews", committed);
      }
    var users = arr();
    Set<String> ids = new HashSet<>();
    ids.add(userId);
    for (var r : rows) members(s, r).forEach(v -> ids.add(text(v, "id")));
    for (var v : list(s, "users"))
      if (admin(u) || ids.contains(text(v, "id"))) {
        var copy = v.deepCopy();
        copy.remove("passwordHash");
        users.add(copy);
      }
    out.set("users", users);
    if (u != null) {
      var me = u.deepCopy();
      me.remove("passwordHash");
      out.set("me", me);
    }
    out.set(
      "grants",
      JSON.valueToTree(
        list(s, "grants")
          .stream()
          .filter(g -> admin(u) || text(g, "userId").equals(userId))
          .toList()
      )
    );
    out.set(
      "notices",
      JSON.valueToTree(
        list(s, "notices")
          .stream()
          .filter(n -> text(n, "userId").equals(userId))
          .toList()
      )
    );
    out.set(
      "audits",
      JSON.valueToTree(
        list(s, "audits")
          .stream()
          .filter(
            log ->
              admin(u) ||
              activities
                .stream()
                .anyMatch(a -> text(a, "id").equals(text(log, "activityId")) && manages(u, a))
          )
          .toList()
      )
    );
    var slots = arr();
    for (var slot : list(s, "slots"))
      if (activities.stream().anyMatch(a -> text(a, "id").equals(text(slot, "activityId")))) {
        var copy = slot.deepCopy();
        copy.put(
          "booked",
          list(s, "applications")
            .stream()
            .filter(r -> text(r, "slotId").equals(text(slot, "id")))
            .count()
        );
        slots.add(copy);
      }
    out.set("slots", slots);
    Set<String> files = new HashSet<>();
    for (var r : rows)
      r.path("answers")
        .elements()
        .forEachRemaining(v -> {
          if (v.asText().startsWith("file:")) files.add(v.asText().substring(5));
        });
    for (var a : activities)
      if (text(a, "poster").startsWith("file:")) files.add(text(a, "poster").substring(5));
    out.set(
      "attachments",
      JSON.valueToTree(
        list(s, "attachments")
          .stream()
          .filter(f -> text(f, "ownerId").equals(userId) || files.contains(text(f, "id")))
          .map(f -> {
            var v = f.deepCopy();
            v.remove("data");
            return v;
          })
          .toList()
      )
    );
    return out;
  }

  static void fields(ObjectNode s, JsonNode a, JsonNode answers, JsonNode u) {
    for (var f : a.path("fields")) {
      var v = answers.path(text(f, "id"));
      boolean empty =
        v.isMissingNode() ||
        v.isNull() ||
        (v.isTextual() && v.asText().isBlank()) ||
        (v.isArray() && v.isEmpty());
      check(!flag(f, "required") || !empty, "请填写" + text(f, "label"));
      if (empty) continue;
      switch (text(f, "type")) {
        case "number" -> check(v.isNumber(), "请输入数字");
        case "radio" -> check(contains(f.path("options"), v.asText()), "选项无效");
        case "checkbox" -> {
          check(v.isArray(), "多选格式错误");
          v.forEach(n -> check(contains(f.path("options"), n.asText()), "多选选项无效"));
        }
        case "date" -> instant(v.asText());
        case "file" -> check(
          list(s, "attachments")
            .stream()
            .anyMatch(
              file ->
                ("file:" + text(file, "id")).equals(v.asText()) &&
                text(file, "ownerId").equals(text(u, "id"))
            ),
          "附件不存在或不属于本人"
        );
      }
      check(v.toString().length() < 100000, "字段内容过长");
    }
  }

  public static ObjectNode execute(ObjectNode s, String userId, String action, ObjectNode p) {
    tick(s);
    var u = find(s, "users", userId == null ? "" : userId);
    check(u != null, 401, "请先登录");
    String activityId = null;
    switch (action) {
      case "activity.save" -> {
        var old = find(s, "activities", text(p, "id"));
        var org = find(s, "organizations", text(p, "orgId"));
        check(org != null && flag(org, "enabled"), "请选择启用的组织");
        check(admin(u) || contains(u.path("orgIds"), text(org, "id")), 403, "没有组织权限");
        if (old != null) {
          manage(u, old);
          writable(old);
        }
        check(
          !text(p, "title").isBlank() &&
            instant(text(p, "start")).isBefore(instant(text(p, "end"))),
          "活动名称或时间无效"
        );
        check(!flag(p, "external") || !text(p, "externalGuide").isBlank(), "请提供外部指引");
        check(
          !flag(p, "team") || (num(p, "minTeam") >= 2 && num(p, "maxTeam") >= num(p, "minTeam")),
          "团队人数不正确"
        );
        check(p.path("fields").isArray(), "报名字段格式不正确");
        Set<String> fieldIds = new HashSet<>();
        for (var f : p.path("fields")) {
          check(
            !text(f, "id").isBlank() &&
              fieldIds.add(text(f, "id")) &&
              !text(f, "label").isBlank() &&
              List.of("text", "textarea", "number", "radio", "checkbox", "date", "file").contains(
                text(f, "type")
              ),
            "字段名称、类型或编号无效"
          );
          if (List.of("radio", "checkbox").contains(text(f, "type"))) check(
            f.path("options").isArray() && !f.path("options").isEmpty(),
            "请填写选项"
          );
        }
        check(p.path("stages").size() == 3, "审核环节须为三项");
        int index = 0;
        for (var st : p.path("stages")) {
          check(
            text(st, "key").equals(List.of("initial", "written", "interview").get(index++)) &&
              List.of("pass", "score").contains(text(st, "mode")) &&
              st.path("threshold").isIntegralNumber() &&
              num(st, "threshold") >= 0 &&
              num(st, "threshold") <= 100,
            "审核顺序或合格线无效"
          );
        }
        if (old != null && !applications(s, old).isEmpty()) for (var key : List.of(
          "orgId",
          "external",
          "team",
          "minTeam",
          "maxTeam",
          "fields",
          "stages",
          "rolling"
        ))
          check(old.path(key).equals(p.path(key)), 409, "已有报名，结构配置已锁定");
        if (!text(p, "poster").isEmpty()) check(
          list(s, "attachments")
            .stream()
            .anyMatch(
              f ->
                ("file:" + text(f, "id")).equals(text(p, "poster")) &&
                text(f, "mime").startsWith("image/") &&
                (text(f, "ownerId").equals(userId) ||
                  (old != null && text(old, "poster").equals(text(p, "poster"))))
            ),
          "海报图片无效"
        );
        var a =
          old == null
            ? obj()
                .put("id", id())
                .put("removed", false)
                .put("resultPublished", false)
                .put("resultVersion", 0)
            : old;
        for (var k : List.of(
          "orgId",
          "title",
          "body",
          "poster",
          "start",
          "end",
          "published",
          "external",
          "externalGuide",
          "team",
          "minTeam",
          "maxTeam",
          "rolling",
          "fields",
          "stages",
          "softGrade",
          "softMaterial"
        ))
          a.set(k, p.path(k).deepCopy());
        if (flag(a, "published") && text(a, "publishedAt").isEmpty()) a.put(
          "publishedAt",
          stamp(s)
        );
        if (old == null) add(s, "activities", a);
        else applications(s, a).forEach(r ->
          appNotice(s, r, text(a, "title") + "：公告或截止时间已更新。")
        );
        activityId = text(a, "id");
      }
      case "application.save" -> {
        var a = activity(s, text(p, "activityId"));
        within(s, a);
        check(contains(u.path("roles"), "student"), 403, "需要学生身份");
        var old = text(p, "id").isEmpty() ? null : application(s, text(p, "id"));
        if (old != null) {
          check(text(old, "activityId").equals(text(a, "id")), 403, "报名不属于此活动");
          captain(u, old);
          check(!text(old, "status").equals("withdrawn"), 409, "请重新报名");
          check(num(old, "version") == num(p, "version"), 409, "报名已更新，请刷新");
        }
        List<String> nos = new ArrayList<>();
        nos.add(text(u, "studentNo"));
        if (flag(a, "team")) for (var n : p.path("memberNos")) {
          var no = n.asText().trim();
          if (!no.isEmpty() && !no.equals(text(u, "studentNo"))) nos.add(no);
        }
        check(
          new HashSet<>(nos).size() == nos.size() &&
            nos.stream().allMatch(n -> n.matches("\\d{6,20}")),
          "学号重复或格式错误"
        );
        check(
          !flag(a, "team") || (nos.size() >= num(a, "minTeam") && nos.size() <= num(a, "maxTeam")),
          "团队人数不符合要求"
        );
        for (var other : applications(s, a))
          if (
            (old == null || !text(old, "id").equals(text(other, "id"))) &&
            !text(other, "status").equals("withdrawn")
          ) check(
            nos.stream().noneMatch(no -> contains(other.path("memberNos"), no)),
            409,
            "学生已报名或属于其他团队"
          );
        fields(s, a, p.path("answers"), u);
        String gradeKey = java.util.stream.StreamSupport.stream(
          a.path("fields").spliterator(),
          false
        )
          .filter(f -> text(f, "id").equals("grade") || text(f, "label").trim().equals("年级"))
          .map(f -> text(f, "id"))
          .findFirst()
          .orElse("grade");
        var material = p.path("answers").path(text(a, "softMaterial"));
        boolean missingMaterial =
          material.isMissingNode() ||
          material.isNull() ||
          (material.isArray() && material.isEmpty()) ||
          (material.isTextual() && material.asText().isBlank());
        boolean warning =
          (!text(a, "softGrade").isEmpty() &&
            !Arrays.asList(text(a, "softGrade").split("[,，]")).contains(
              text(p.path("answers"), gradeKey)
            )) ||
          (!text(a, "softMaterial").isEmpty() && missingMaterial);
        check(!warning || flag(p, "confirmSoft"), "存在报名建议软提示，请确认后提交");
        var r = obj()
          .put("id", old == null ? id() : text(old, "id"))
          .put("activityId", text(a, "id"))
          .put("captainId", userId)
          .put("version", old == null ? 1 : num(old, "version") + 1)
          .put("stageIndex", 0)
          .put("status", "waiting")
          .put("createdAt", old == null ? stamp(s) : text(old, "createdAt"))
          .put("updatedAt", stamp(s));
        r.set("memberNos", JSON.valueToTree(nos));
        r.set("answers", p.path("answers").deepCopy());
        r.set("reviews", arr());
        r.set("history", old == null ? arr() : old.path("history").deepCopy());
        history(s, r, old == null ? "提交报名" : "修改并重新审核");
        upsert(s, "applications", r);
        if (flag(a, "rolling")) advance(s, a, r);
        appNotice(
          s,
          r,
          text(a, "title") + "：" + (old == null ? "报名成功" : "报名已修改，原结论失效并重审")
        );
        activityId = text(a, "id");
      }
      case "application.withdraw", "application.exit" -> {
        var r = application(s, text(p, "id"));
        var a = activity(s, text(r, "activityId"));
        within(s, a);
        check(!text(r, "status").equals("withdrawn"), 409, "报名已撤回");
        if (action.endsWith("withdraw")) {
          captain(u, r);
          r.put("status", "withdrawn");
          appNotice(s, r, text(a, "title") + "：报名已撤回。");
        } else {
          check(
            !text(r, "captainId").equals(userId) &&
              contains(r.path("memberNos"), text(u, "studentNo")),
            403,
            "仅非队长成员可退出"
          );
          var nos = arr();
          r.path("memberNos").forEach(n -> {
            if (!n.asText().equals(text(u, "studentNo"))) nos.add(n);
          });
          r.set("memberNos", nos);
          notice(s, userId, "已退出团队", text(a, "id"));
          appNotice(s, r, "队员已退出，请队长补齐人数。");
          r.put("version", num(r, "version") + 1)
            .put("stageIndex", 0)
            .put("status", "waiting");
          r.set("reviews", arr());
          if (flag(a, "rolling")) advance(s, a, r);
        }
        r.remove("slotId");
        history(s, r, action);
        activityId = text(a, "id");
      }
      case "review.save" -> {
        var r = application(s, text(p, "id"));
        var a = activity(s, text(r, "activityId"));
        manage(u, a);
        writable(a);
        check(num(p, "version") == num(r, "version"), 409, "报名已更新，请刷新");
        check(
          !flag(a, "team") || r.path("memberNos").size() >= num(a, "minTeam"),
          409,
          "人数不足，补齐后才能审核"
        );
        var st = a.path("stages").path(num(r, "stageIndex"));
        check(
          !st.isMissingNode() && text(st, "key").equals(text(r, "status")),
          409,
          "当前没有可审核环节"
        );
        check(
          text(p, "stage").isEmpty() || text(p, "stage").equals(text(st, "key")),
          409,
          "环节已变更"
        );
        boolean scored = text(st, "mode").equals("score");
        check(
          !scored ||
            (p.path("score").isIntegralNumber() && num(p, "score") >= 0 && num(p, "score") <= 100),
          "分数须为0—100整数"
        );
        boolean passed = scored ? num(p, "score") >= num(st, "threshold") : flag(p, "passed");
        var reviews = arr();
        for (var rev : r.path("reviews"))
          if (
            !(
              text(rev, "stage").equals(text(st, "key")) &&
              num(rev, "version") == num(r, "version") &&
              !flag(rev, "committed")
            )
          ) reviews.add(rev);
        var rev = obj()
          .put("stage", text(st, "key"))
          .put("version", num(r, "version"))
          .put("passed", passed)
          .put("note", text(p, "note"))
          .put("committed", flag(p, "commit"));
        if (scored) rev.put("score", num(p, "score"));
        reviews.add(rev);
        r.set("reviews", reviews);
        if (flag(p, "commit")) {
          if (passed) {
            r.put("stageIndex", num(r, "stageIndex") + 1);
            advance(s, a, r);
          } else {
            r.put("status", "rejected");
            r.remove("slotId");
          }
          history(s, r, text(st, "key") + (passed ? "通过" : "未通过"));
          appNotice(s, r, text(a, "title") + "：" + text(st, "key") + (passed ? "通过" : "未通过"));
        }
        r.put("updatedAt", stamp(s));
        activityId = text(a, "id");
      }
      case "slot.save" -> {
        var a = activity(s, text(p, "activityId"));
        manage(u, a);
        writable(a);
        check(
          instant(text(p, "start")).isBefore(instant(text(p, "end"))) &&
            !text(p, "place").isBlank() &&
            p.path("capacity").isIntegralNumber() &&
            num(p, "capacity") > 0,
          "时段配置无效"
        );
        var old = find(s, "slots", text(p, "id"));
        if (old != null) {
          check(text(old, "activityId").equals(text(a, "id")), 403, "时段不属于本活动");
          var affected = applications(s, a)
            .stream()
            .filter(r -> text(r, "slotId").equals(text(old, "id")))
            .toList();
          check(affected.isEmpty() || !text(p, "reason").isBlank(), "已有预约，必须填写变更原因");
          affected.forEach(r -> {
            r.remove("slotId");
            appNotice(s, r, "面试时段已变更，请重新选择。原因：" + text(p, "reason"));
          });
        }
        var slot = obj().put("id", old == null ? id() : text(old, "id"));
        for (var k : List.of("activityId", "start", "end", "place", "capacity", "cancelled"))
          slot.set(k, p.path(k).deepCopy());
        upsert(s, "slots", slot);
        activityId = text(a, "id");
      }
      case "slot.book" -> {
        var r = application(s, text(p, "id"));
        var a = activity(s, text(r, "activityId"));
        captain(u, r);
        writable(a);
        check(text(r, "status").equals("interview"), 409, "仅面试中的报名可预约");
        check(
          !flag(a, "team") || r.path("memberNos").size() >= num(a, "minTeam"),
          409,
          "团队人数不足"
        );
        var slot = find(s, "slots", text(p, "slotId"));
        check(
          slot != null &&
            !flag(slot, "cancelled") &&
            text(slot, "activityId").equals(text(a, "id")),
          404,
          "时段不存在或已取消"
        );
        check(now(s).isBefore(instant(text(slot, "start"))), 409, "时段已开始");
        var old = find(s, "slots", text(r, "slotId"));
        check(old == null || now(s).isBefore(instant(text(old, "start"))), 409, "原时段已开始");
        long booked = applications(s, a)
          .stream()
          .filter(
            v -> !text(v, "id").equals(text(r, "id")) && text(v, "slotId").equals(text(slot, "id"))
          )
          .count();
        check(booked < num(slot, "capacity"), 409, "时段已满，请重选");
        r.put("slotId", text(slot, "id"));
        history(s, r, "选择面试时段");
        appNotice(
          s,
          r,
          text(a, "title") + "：已预约 " + text(slot, "start") + " / " + text(slot, "place")
        );
        activityId = text(a, "id");
      }
      case "result.publish", "result.withdraw" -> {
        var a = activity(s, text(p, "activityId"));
        manage(u, a);
        writable(a);
        if (action.endsWith("withdraw")) {
          check(flag(a, "resultPublished"), 409, "尚未发布结果");
          check(!text(p, "reason").isBlank(), "请填写更正原因");
          a.put("resultPublished", false);
          applications(s, a)
            .stream()
            .filter(r -> List.of("admitted", "unselected").contains(text(r, "status")))
            .forEach(r -> {
              r.put("status", "eligible");
              appNotice(s, r, "录取结果已撤回更正：" + text(p, "reason"));
            });
        } else {
          check(!flag(a, "resultPublished"), 409, "结果已发布，请先撤回");
          check(!now(s).isBefore(instant(text(a, "end"))), 409, "请在报名截止后发布");
          var rows = applications(s, a)
            .stream()
            .filter(r -> !List.of("withdrawn", "rejected").contains(text(r, "status")))
            .toList();
          check(
            rows.stream().allMatch(r -> text(r, "status").equals("eligible")),
            409,
            "仍有未完成审核"
          );
          for (var v : p.path("admittedIds"))
            check(
              rows.stream().anyMatch(r -> text(r, "id").equals(v.asText())),
              "录取名单包含无效记录"
            );
          rows.forEach(r -> {
            boolean yes = contains(p.path("admittedIds"), text(r, "id"));
            r.put("status", yes ? "admitted" : "unselected");
            appNotice(s, r, text(a, "title") + "：" + (yes ? "已录取" : "未录取"));
          });
          a.put("resultPublished", true).put("resultVersion", num(a, "resultVersion") + 1);
        }
        activityId = text(a, "id");
      }
      case "notice.send" -> {
        var a = activity(s, text(p, "activityId"));
        manage(u, a);
        writable(a);
        check(!text(p, "text").isBlank(), "请输入通知内容");
        Set<String> ids = new HashSet<>();
        applications(s, a)
          .stream()
          .filter(
            r ->
              !text(r, "status").equals("withdrawn") &&
              (text(p, "status").isEmpty() || text(r, "status").equals(text(p, "status")))
          )
          .forEach(r -> members(s, r).forEach(m -> ids.add(text(m, "id"))));
        ids.forEach(id -> notice(s, id, text(p, "text"), text(a, "id")));
        activityId = text(a, "id");
      }
      case "notice.read" -> {
        var n = find(s, "notices", text(p, "id"));
        check(n != null && text(n, "userId").equals(userId), 404, "通知不存在");
        n.put("read", true);
      }
      case "grant.apply" -> {
        check(contains(u.path("roles"), "student"), 403, "需要学生身份");
        var org = find(s, "organizations", text(p, "orgId"));
        check(
          org != null && flag(org, "enabled") && !text(p, "reason").isBlank(),
          "请选择组织并填写理由"
        );
        check(
          !contains(u.path("orgIds"), text(p, "orgId")) &&
            list(s, "grants")
              .stream()
              .noneMatch(
                g ->
                  text(g, "userId").equals(userId) &&
                  text(g, "orgId").equals(text(p, "orgId")) &&
                  text(g, "status").equals("pending")
              ),
          409,
          "已授权或已有待处理申请"
        );
        add(
          s,
          "grants",
          obj()
            .put("id", id())
            .put("userId", userId)
            .put("orgId", text(p, "orgId"))
            .put("reason", text(p, "reason"))
            .put("status", "pending")
        );
      }
      case "grant.decide" -> {
        check(admin(u), 403, "需要管理员权限");
        var g = find(s, "grants", text(p, "id"));
        check(g != null && text(g, "status").equals("pending"), 409, "申请不存在或已处理");
        check(flag(p, "approved") || !text(p, "reason").isBlank(), "驳回须填写理由");
        g.put("status", flag(p, "approved") ? "approved" : "rejected").put(
          "decision",
          text(p, "reason")
        );
        if (flag(p, "approved")) {
          var applicant = find(s, "users", text(g, "userId"));
          if (!contains(applicant.path("orgIds"), text(g, "orgId"))) (
            (ArrayNode) applicant.get("orgIds")
          ).add(text(g, "orgId"));
          if (!contains(applicant.path("roles"), "manager")) (
            (ArrayNode) applicant.get("roles")
          ).add("manager");
        }
        notice(
          s,
          text(g, "userId"),
          "负责人申请" + (flag(p, "approved") ? "已通过" : "被驳回：" + text(p, "reason")),
          null
        );
      }
      case "organization.save" -> {
        check(admin(u), 403, "需要管理员权限");
        check(
          !text(p, "name").isBlank() &&
            !text(p, "campus").isBlank() &&
            List.of("club", "contest").contains(text(p, "kind")) &&
            p.path("stars").isIntegralNumber() &&
            num(p, "stars") >= 1 &&
            num(p, "stars") <= (text(p, "kind").equals("club") ? 5 : 7),
          "目录字段或星级无效"
        );
        check(
          list(s, "organizations")
            .stream()
            .noneMatch(
              o ->
                !text(o, "id").equals(text(p, "id")) &&
                text(o, "name").equals(text(p, "name").trim()) &&
                text(o, "kind").equals(text(p, "kind"))
            ),
          409,
          "目录名称重复"
        );
        var org = obj()
          .put("id", text(p, "id").isEmpty() ? id() : text(p, "id"))
          .put("name", text(p, "name").trim())
          .put("kind", text(p, "kind"))
          .put("campus", text(p, "campus"))
          .put("stars", num(p, "stars"))
          .put("enabled", !p.has("enabled") || flag(p, "enabled"));
        upsert(s, "organizations", org);
      }
      case "activity.remove" -> {
        check(admin(u), 403, "需要管理员权限");
        var a = activity(s, text(p, "activityId"));
        check(!flag(a, "archived"), 409, "已归档");
        check(!text(p, "reason").isBlank(), "下架须填写原因");
        a.put("removed", true);
        list(s, "users")
          .stream()
          .filter(v -> contains(v.path("orgIds"), text(a, "orgId")))
          .forEach(v ->
            notice(
              s,
              text(v, "id"),
              text(a, "title") + "已下架：" + text(p, "reason"),
              text(a, "id")
            )
          );
        activityId = text(a, "id");
      }
      case "activity.close" -> {
        var a = activity(s, text(p, "activityId"));
        manage(u, a);
        check(!flag(a, "archived") && text(a, "closedAt").isEmpty(), 409, "活动已结项或归档");
        check(
          flag(a, "resultPublished") || flag(a, "external") || flag(a, "removed"),
          409,
          "请先发布结果"
        );
        a.put("closedAt", stamp(s));
        activityId = text(a, "id");
      }
      case "activity.archive" -> {
        check(admin(u), 403, "需要管理员权限");
        var a = activity(s, text(p, "activityId"));
        check(!text(a, "closedAt").isEmpty() && !flag(a, "archived"), 409, "活动需先结项且未归档");
        check(text(p, "confirm").equals(text(a, "title")), "请完整输入活动标题确认");
        archive(s, a);
        activityId = text(a, "id");
      }
      case "semester.save" -> {
        check(admin(u), 403, "需要管理员权限");
        check(
          !text(p, "name").isBlank() && instant(text(p, "start")).isBefore(instant(text(p, "end"))),
          "学期名称或日期无效"
        );
        for (var t : list(s, "semesters"))
          if (!text(t, "id").equals(text(p, "id"))) check(
            instant(text(p, "end")).isBefore(instant(text(t, "start"))) ||
              instant(text(p, "start")).isAfter(instant(text(t, "end"))),
            "学期日期不可重叠"
          );
        var t = obj()
          .put("id", text(p, "id").isEmpty() ? id() : text(p, "id"))
          .put("name", text(p, "name"))
          .put("start", text(p, "start"))
          .put("end", text(p, "end"));
        upsert(s, "semesters", t);
      }
      default -> throw new ApiError(404, "未知操作");
    }
    audit(
      s,
      userId,
      action,
      activityId,
      action.equals("activity.archive") ? "仅保留汇总" : text(p, "reason")
    );
    tick(s);
    return obj().put("ok", true);
  }

  public static void archive(ObjectNode s, ObjectNode a) {
    var rows = applications(s, a);
    a.set(
      "summary",
      obj()
        .put("total", rows.size())
        .put(
          "admitted",
          rows
            .stream()
            .filter(r -> text(r, "status").equals("admitted"))
            .count()
        )
        .put(
          "failed",
          rows
            .stream()
            .filter(r -> List.of("rejected", "unselected").contains(text(r, "status")))
            .count()
        )
    );
    Set<String> files = new HashSet<>();
    rows.forEach(r ->
      r
        .path("answers")
        .elements()
        .forEachRemaining(v -> {
          if (v.asText().startsWith("file:")) files.add(v.asText().substring(5));
        })
    );
    String id = text(a, "id");
    remove(s, "applications", r -> text(r, "activityId").equals(id));
    remove(s, "slots", r -> text(r, "activityId").equals(id));
    remove(s, "notices", r -> text(r, "activityId").equals(id));
    remove(s, "audits", r -> text(r, "activityId").equals(id));
    Set<String> used = new HashSet<>();
    list(s, "applications").forEach(r ->
      r
        .path("answers")
        .elements()
        .forEachRemaining(v -> {
          if (v.asText().startsWith("file:")) used.add(v.asText().substring(5));
        })
    );
    list(s, "activities").forEach(v -> {
      if (text(v, "poster").startsWith("file:")) used.add(text(v, "poster").substring(5));
    });
    remove(s, "attachments", f -> files.contains(text(f, "id")) && !used.contains(text(f, "id")));
    a.put("archived", true);
  }
}
