package cn.campus.platform;

import static cn.campus.platform.Rules.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;

/** Version snapshots and event records are retained only until activity archival. */
public final class History {

  private History() {}

  public static ArrayNode array(ObjectNode n, String key) {
    if (!n.path(key).isArray()) n.set(key, arr());
    return (ArrayNode) n.get(key);
  }

  public static void capture(ObjectNode s, JsonNode before, String actor, String action) {
    for (var r : list(s, "applications")) {
      var old = find(before, "applications", text(r, "id"));
      if (old != null && num(old, "version") != num(r, "version")) {
        var versions = old.path("versions").isArray()
          ? (ArrayNode) old.path("versions").deepCopy()
          : arr();
        var revision = old.deepCopy();
        revision.remove(List.of("versions", "statusEvents", "history"));
        versions.add(revision);
        r.set("versions", versions);
      }
      if (
        old == null ||
        !text(old, "status").equals(text(r, "status")) ||
        num(old, "version") != num(r, "version")
      ) {
        var events =
          old != null && old.path("statusEvents").isArray()
            ? (ArrayNode) old.path("statusEvents").deepCopy()
            : arr();
        events.add(
          obj()
            .put("at", stamp(s))
            .put("actorId", actor)
            .put("action", action)
            .put("version", num(r, "version"))
            .put("from", text(old, "status"))
            .put("to", text(r, "status"))
        );
        r.set("statusEvents", events);
        r.put("updatedAt", stamp(s));
      }
    }
  }

  public static String activityStatus(JsonNode s, JsonNode a) {
    if (flag(a, "archived")) return "已归档";
    if (flag(a, "removed")) return "已下架";
    if (!flag(a, "published")) return "草稿";
    if (!text(a, "closedAt").isEmpty() || flag(a, "resultPublished")) return "已结束";
    if (now(s).isBefore(instant(text(a, "start")))) return "待开始";
    if (now(s).isBefore(instant(text(a, "end")))) return "报名中";
    if (!flag(a, "external")) {
      var rows = list(s, "applications")
        .stream()
        .filter(
          r -> text(r, "activityId").equals(text(a, "id")) && !text(r, "status").equals("withdrawn")
        )
        .toList();
      if (
        rows
          .stream()
          .anyMatch(r ->
            List.of("waiting", "initial", "written", "interview").contains(text(r, "status"))
          )
      ) return "审核中";
      if (!rows.isEmpty()) return "待发布结果";
    }
    return "已截止";
  }

  public static Set<String> files(JsonNode value) {
    Set<String> ids = new HashSet<>();
    if (value.isTextual() && value.asText().startsWith("file:")) ids.add(
      value.asText().substring(5)
    );
    else if (value.isContainerNode()) value.forEach(child -> ids.addAll(files(child)));
    return ids;
  }

  public static Set<String> applicationFiles(JsonNode r, JsonNode a, boolean history) {
    Set<String> ids = new HashSet<>();
    var records = arr().add(r);
    if (history && r.path("versions").isArray()) r.path("versions").forEach(records::add);
    records.forEach(v ->
      a.path("fields").forEach(f -> {
        if (text(f, "type").equals("file")) ids.addAll(
          files(v.path("answers").path(text(f, "id")))
        );
      })
    );
    return ids;
  }

  public static Set<String> posterFiles(JsonNode a) {
    Set<String> ids = new HashSet<>();
    a.path("changeHistory").forEach(v -> ids.addAll(files(v.path("changes").path("poster"))));
    return ids;
  }

  public static void finish(
    ObjectNode s,
    ObjectNode before,
    String actor,
    String action,
    ObjectNode p,
    String activityId
  ) {
    capture(s, before, actor, action);
    var a = find(s, "activities", activityId);
    var old = find(before, "activities", activityId);
    var logs = list(s, "audits");
    var audit = logs.getLast();
    if (action.equals("activity.save") && a != null && old != null) {
      var changes = obj();
      for (var key : List.of("title", "body", "poster", "start", "end"))
        if (!a.path(key).equals(old.path(key))) {
          var delta = obj();
          delta.set("before", old.path(key).deepCopy());
          delta.set("after", a.path(key).deepCopy());
          changes.set(key, delta);
        }
      if (!changes.isEmpty()) {
        array(a, "changeHistory").add(
          obj().put("at", stamp(s)).put("actorId", actor).set("changes", changes)
        );
        audit.set("context", obj().set("changes", changes));
        audit.put("detail", changes.toString());
      }
    }
    if (action.equals("review.save")) {
      var r = find(s, "applications", text(p, "id"));
      var prev = find(before, "applications", text(p, "id"));
      var context = obj()
        .put("applicationId", text(r, "id"))
        .put("version", num(r, "version"))
        .put("stage", text(prev, "status"))
        .put("beforeStatus", text(prev, "status"))
        .put("afterStatus", text(r, "status"));
      r.path("reviews").forEach(rev -> {
        if (
          text(rev, "stage").equals(text(prev, "status")) &&
          num(rev, "version") == num(r, "version")
        ) context.setAll((ObjectNode) rev);
      });
      audit.set("context", context);
      audit.put("detail", context.toString());
    }
  }
}
