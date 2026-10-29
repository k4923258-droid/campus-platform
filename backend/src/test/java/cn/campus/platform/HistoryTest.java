package cn.campus.platform;

import static cn.campus.platform.Rules.*;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.*;
import org.junit.jupiter.api.*;

class HistoryTest {

  ObjectNode s;

  @BeforeEach
  void init() throws Exception {
    s = (ObjectNode) JSON.readTree(getClass().getResourceAsStream("/seed.json"));
    s.put("now", "2026-10-28T10:00:00+08:00");
  }

  ObjectNode first() {
    return list(s, "applications").getFirst();
  }

  ObjectNode activity() {
    return find(s, "activities", "photo-fall");
  }

  void apply() {
    execute(
      s,
      "student",
      "application.save",
      (ObjectNode) obj()
        .put("activityId", "photo-fall")
        .set("answers", obj().put("intro", "旧表单").put("grade", "大一"))
    );
  }

  void review() {
    execute(
      s,
      "manager",
      "review.save",
      obj()
        .put("id", text(first(), "id"))
        .put("version", num(first(), "version"))
        .put("stage", text(first(), "status"))
        .put("passed", true)
        .put("commit", true)
        .put("note", "审核原备注")
    );
  }

  @Test
  void lifecycleUsesAllRowsWithoutExposingThem() {
    apply();
    s.put("now", text(activity(), "end"));
    assertEquals(
      "审核中",
      text(find(snapshot(s, null), "activities", "photo-fall"), "lifecycleStatus")
    );
    review();
    review();
    assertEquals(
      "待发布结果",
      text(find(snapshot(s, null), "activities", "photo-fall"), "lifecycleStatus")
    );
    assertTrue(list(snapshot(s, null), "applications").isEmpty());
  }

  @Test
  void reviewAuditContainsIdentityVersionScoreAndStatus() {
    ((ObjectNode) activity().path("stages").get(0)).put("mode", "score");
    apply();
    execute(
      s,
      "manager",
      "review.save",
      obj()
        .put("id", text(first(), "id"))
        .put("version", 1)
        .put("stage", "initial")
        .put("score", 30)
        .put("note", "分数未达线")
        .put("commit", true)
    );
    var context = list(s, "audits").getLast().path("context");
    assertEquals(text(first(), "id"), text(context, "applicationId"));
    assertEquals(30, num(context, "score"));
    assertEquals("initial", text(context, "beforeStatus"));
    assertEquals("rejected", text(context, "afterStatus"));
    assertEquals("manager", text(context, "actorId"));
    assertFalse(text(context, "at").isEmpty());
    assertEquals("分数未达线", text(context, "note"));
  }

  @Test
  void previousAnswersAndReviewsSurviveResubmissionButAreManagerOnly() {
    apply();
    review();
    var id = text(first(), "id");
    execute(
      s,
      "student",
      "application.save",
      (ObjectNode) obj()
        .put("id", id)
        .put("version", 1)
        .put("activityId", "photo-fall")
        .set("answers", obj().put("intro", "新表单").put("grade", "大一"))
    );
    assertEquals("旧表单", text(first().path("versions").get(0).path("answers"), "intro"));
    assertEquals(
      "审核原备注",
      text(first().path("versions").get(0).path("reviews").get(0), "note")
    );
    assertTrue(first().path("reviews").isEmpty());
    assertFalse(list(snapshot(s, "student"), "applications").getFirst().has("versions"));
    assertTrue(list(snapshot(s, "manager"), "applications").getFirst().has("versions"));
  }

  @Test
  void correctionRetainsBothListsAndStudentStatusTimeline() {
    apply();
    review();
    review();
    s.put("now", text(activity(), "end"));
    String id = text(first(), "id");
    execute(
      s,
      "manager",
      "result.publish",
      (ObjectNode) obj().put("activityId", "photo-fall").set("admittedIds", arr().add(id))
    );
    execute(
      s,
      "manager",
      "result.withdraw",
      obj().put("activityId", "photo-fall").put("reason", "更正原因")
    );
    execute(
      s,
      "manager",
      "result.publish",
      (ObjectNode) obj().put("activityId", "photo-fall").set("admittedIds", arr())
    );
    assertEquals(id, activity().path("resultHistory").get(0).path("admittedIds").get(0).asText());
    assertEquals("更正原因", text(activity().path("resultHistory").get(0), "reason"));
    assertEquals(id, activity().path("resultHistory").get(1).path("unselectedIds").get(0).asText());
    assertFalse(find(snapshot(s, null), "activities", "photo-fall").has("resultHistory"));
    assertFalse(find(snapshot(s, "student"), "activities", "photo-fall").has("resultHistory"));
    assertEquals(
      "unselected",
      text(
        first()
          .path("statusEvents")
          .get(first().path("statusEvents").size() - 1),
        "to"
      )
    );
  }

  @Test
  void activityDiffsArePrivateAndKeepBeforeAndAfter() {
    var changed = activity().deepCopy().put("body", "新公告");
    String old = text(activity(), "body");
    execute(s, "manager", "activity.save", changed);
    var diff = activity().path("changeHistory").get(0).path("changes").path("body");
    assertEquals(old, text(diff, "before"));
    assertEquals("新公告", text(diff, "after"));
    assertFalse(find(snapshot(s, null), "activities", "photo-fall").has("changeHistory"));
  }

  @Test
  void automaticNotificationsDoNotRepeat() {
    activity()
      .path("stages")
      .forEach(st -> ((ObjectNode) st).put("enabled", true).put("automatic", true));
    apply();
    long auto = list(s, "notices")
      .stream()
      .filter(n -> text(n, "text").contains("默认通过"))
      .count();
    assertEquals(3, auto);
    int count = list(s, "notices").size();
    tick(s);
    tick(s);
    assertEquals(count, list(s, "notices").size());
  }

  @Test
  void archiveErasesHistoricalFilesPublicationsAndSensitiveAudit() {
    History.array(activity(), "fields").add(
      obj()
        .put("id", "old")
        .put("label", "旧附件")
        .put("type", "file")
        .put("required", false)
        .set("options", arr())
    );
    apply();
    first().withObject("answers").put("old", "file:old-file");
    add(
      s,
      "attachments",
      obj().put("id", "old-file").put("ownerId", "student").put("mime", "application/pdf")
    );
    var payload = (ObjectNode) obj()
      .put("id", text(first(), "id"))
      .put("version", 1)
      .put("activityId", "photo-fall")
      .set("answers", obj().put("intro", "新版").put("grade", "大一"));
    execute(s, "student", "application.save", payload);
    assertTrue(
      list(snapshot(s, "manager"), "attachments")
        .stream()
        .anyMatch(v -> text(v, "id").equals("old-file"))
    );
    activity().put("closedAt", stamp(s));
    History.array(activity(), "resultHistory").add(obj().put("private", "old-member"));
    execute(
      s,
      "admin",
      "activity.archive",
      obj().put("activityId", "photo-fall").put("confirm", text(activity(), "title"))
    );
    assertTrue(list(s, "applications").isEmpty());
    assertTrue(list(s, "attachments").isEmpty());
    assertFalse(activity().has("resultHistory"));
    assertEquals(
      1,
      list(s, "audits")
        .stream()
        .filter(v -> text(v, "activityId").equals("photo-fall"))
        .count()
    );
  }

  @Test
  void plainTextFileMarkerDoesNotGrantAttachmentAccess() {
    apply();
    first().withObject("answers").put("intro", "file:other-private");
    add(
      s,
      "attachments",
      obj().put("id", "other-private").put("ownerId", "member").put("mime", "application/pdf")
    );
    assertFalse(
      list(snapshot(s, "student"), "attachments")
        .stream()
        .anyMatch(f -> text(f, "id").equals("other-private"))
    );
    assertFalse(
      list(snapshot(s, "manager"), "attachments")
        .stream()
        .anyMatch(f -> text(f, "id").equals("other-private"))
    );
  }
}
