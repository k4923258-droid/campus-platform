package cn.campus.platform;

import static cn.campus.platform.Rules.*;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.*;
import org.junit.jupiter.api.*;

class RulesTest {

  @Test
  void removedActivityRetainsParticipantHistory() {
    apply("student");
    execute(
      s,
      "admin",
      "activity.remove",
      obj().put("activityId", "photo-fall").put("reason", "演练下架")
    );
    assertNull(find(snapshot(s, null), "activities", "photo-fall"));
    assertNotNull(find(snapshot(s, "student"), "activities", "photo-fall"));
    execute(s, "manager", "activity.close", obj().put("activityId", "photo-fall"));
    assertFalse(text(find(s, "activities", "photo-fall"), "closedAt").isEmpty());
  }

  ObjectNode s;

  @BeforeEach
  void init() throws Exception {
    s = (ObjectNode) JSON.readTree(getClass().getResourceAsStream("/seed.json"));
    s.put("now", "2026-10-28T10:00:00+08:00");
  }

  ObjectNode apply(String user) {
    return execute(
      s,
      user,
      "application.save",
      (ObjectNode) obj()
        .put("activityId", "photo-fall")
        .set("answers", obj().put("intro", "摄影报名").put("grade", "大一"))
    );
  }

  ObjectNode first() {
    return list(s, "applications").getFirst();
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
    );
  }

  @Test
  void duplicateAndPrivateProjection() {
    apply("student");
    assertEquals("initial", text(first(), "status"));
    assertEquals(409, assertThrows(ApiError.class, () -> apply("student")).status);
    assertEquals(0, list(snapshot(s, "member"), "applications").size());
    assertFalse(snapshot(s, "admin").toString().contains("passwordHash"));
  }

  @Test
  void draftAndStaleVersion() {
    apply("student");
    execute(
      s,
      "manager",
      "review.save",
      obj()
        .put("id", text(first(), "id"))
        .put("version", 1)
        .put("passed", true)
        .put("commit", false)
    );
    assertEquals("initial", text(first(), "status"));
    assertEquals(
      409,
      assertThrows(ApiError.class, () ->
        execute(s, "manager", "review.save", obj().put("id", text(first(), "id")).put("version", 0))
      ).status
    );
    review();
    assertEquals("interview", text(first(), "status"));
  }

  @Test
  void crossOrganizationDenied() {
    apply("student");
    assertEquals(
      403,
      assertThrows(ApiError.class, () ->
        execute(
          s,
          "other-manager",
          "review.save",
          obj().put("id", text(first(), "id")).put("version", 1)
        )
      ).status
    );
  }

  @Test
  void automaticSemesterArchive() {
    apply("student");
    list(s, "activities").getFirst().put("closedAt", "2026-11-11T10:00:00+08:00");
    s.put("now", "2027-07-19T00:00:00+08:00");
    tick(s);
    assertTrue(flag(list(s, "activities").getFirst(), "archived"));
    assertTrue(list(s, "applications").isEmpty());
  }

  @Test
  void studentCannotSeeDraftReview() {
    apply("student");
    execute(
      s,
      "manager",
      "review.save",
      obj()
        .put("id", text(first(), "id"))
        .put("version", 1)
        .put("passed", false)
        .put("commit", false)
        .put("note", "负责人草稿")
    );
    assertTrue(list(snapshot(s, "student"), "applications").getFirst().path("reviews").isEmpty());
    assertEquals(1, list(snapshot(s, "manager"), "applications").getFirst().path("reviews").size());
  }

  @Test
  void bookingDoesNotOversell() {
    apply("student");
    review();
    var first = first();
    apply("member");
    var second = list(s, "applications").get(1);
    execute(
      s,
      "manager",
      "review.save",
      obj().put("id", text(second, "id")).put("version", 1).put("passed", true).put("commit", true)
    );
    execute(
      s,
      "student",
      "slot.book",
      obj().put("id", text(first, "id")).put("slotId", "photo-slot-2")
    );
    assertEquals(
      409,
      assertThrows(ApiError.class, () ->
        execute(
          s,
          "member",
          "slot.book",
          obj().put("id", text(second, "id")).put("slotId", "photo-slot-2")
        )
      ).status
    );
    assertEquals("", text(second, "slotId"));
  }

  @Test
  void cutoffAndRequiredFields() {
    s.put("now", text(list(s, "activities").getFirst(), "end"));
    assertEquals(409, assertThrows(ApiError.class, () -> apply("student")).status);
    s.put("now", "2026-10-28T10:00:00+08:00");
    assertThrows(ApiError.class, () ->
      execute(
        s,
        "student",
        "application.save",
        (ObjectNode) obj().put("activityId", "photo-fall").set("answers", obj())
      )
    );
  }

  @Test
  void resultCorrectionAndArchive() {
    apply("student");
    review();
    review();
    s.put("now", "2026-11-11T10:00:00+08:00");
    execute(
      s,
      "manager",
      "result.publish",
      (ObjectNode) obj()
        .put("activityId", "photo-fall")
        .set("admittedIds", arr().add(text(first(), "id")))
    );
    assertEquals("admitted", text(first(), "status"));
    execute(
      s,
      "manager",
      "result.withdraw",
      obj().put("activityId", "photo-fall").put("reason", "更正")
    );
    assertEquals("eligible", text(first(), "status"));
    execute(
      s,
      "manager",
      "result.publish",
      (ObjectNode) obj().put("activityId", "photo-fall").set("admittedIds", arr())
    );
    execute(s, "manager", "activity.close", obj().put("activityId", "photo-fall"));
    execute(
      s,
      "admin",
      "activity.archive",
      obj()
        .put("activityId", "photo-fall")
        .put("confirm", text(list(s, "activities").getFirst(), "title"))
    );
    assertTrue(list(s, "applications").isEmpty());
    assertTrue(list(s, "notices").isEmpty());
  }
}
