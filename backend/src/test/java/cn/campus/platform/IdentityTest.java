package cn.campus.platform;

import static cn.campus.platform.Rules.*;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;

class IdentityTest {

  @Test
  void schoolAndEmailVerifiedUsersCanJoinSameTeamButNotDemoUsers() {
    find(s, "users", "student").put("identitySource", "campus-email");
    find(s, "users", "member").put("identitySource", "school");
    assertDoesNotThrow(() -> team("20260002"));
    assertFalse(Identity.compatible(find(s, "users", "student"), find(s, "users", "member2")));
  }

  @Test
  void disabledMemberCannotAutoAdvanceOrPublish() {
    team("20260002");
    var r = list(s, "applications").getFirst();
    var a = find(s, "activities", "innovation-team");
    find(s, "users", "member").put("accountStatus", "disabled");
    for (var st : a.path("stages")) {
      ((ObjectNode) st).put("enabled", true).put("automatic", true);
    }
    r.put("stageIndex", 0);
    advance(s, a, r);
    assertEquals("waiting", text(r, "status"));
    r.put("status", "eligible");
    s.put("now", text(a, "end"));
    var p = obj().put("activityId", text(a, "id"));
    p.set("admittedIds", arr().add(text(r, "id")));
    assertEquals(
      409,
      assertThrows(ApiError.class, () -> execute(s, "manager", "result.publish", p)).status
    );
  }

  ObjectNode s;

  @BeforeEach
  void setup() throws Exception {
    s = (ObjectNode) JSON.readTree(getClass().getResourceAsStream("/seed.json"));
  }

  ObjectNode team(String number) {
    var p = obj().put("activityId", "innovation-team");
    p.set("memberNos", arr().add(number));
    p.set("answers", obj().put("proposal", "模拟项目"));
    return execute(s, "student", "application.save", p);
  }

  @Test
  void rejectsUnregisteredAndUnverifiedMembers() {
    assertThrows(ApiError.class, () -> team("20269999"));
    find(s, "users", "member").put("accountStatus", "pending");
    assertThrows(ApiError.class, () -> team("20260002"));
  }

  @Test
  void pendingCannotSubmitOrApplyForManager() {
    find(s, "users", "student").put("accountStatus", "pending");
    assertEquals(403, assertThrows(ApiError.class, () -> team("20260002")).status);
    assertEquals(
      403,
      assertThrows(ApiError.class, () ->
        execute(s, "student", "grant.apply", obj().put("orgId", "math").put("reason", "申请"))
      ).status
    );
  }

  @Test
  void sameNumberDoesNotGrantHistoryOrExit() {
    team("20260002");
    var copy = find(s, "users", "member").deepCopy().put("id", "unrelated");
    add(s, "users", copy);
    assertTrue(list(snapshot(s, "unrelated"), "applications").isEmpty());
    assertEquals(
      403,
      assertThrows(ApiError.class, () ->
        execute(
          s,
          "unrelated",
          "application.exit",
          obj().put("id", text(list(s, "applications").getFirst(), "id"))
        )
      ).status
    );
  }

  @Test
  void privateFieldsAreNotReturned() {
    find(s, "users", "student").put("schoolToken", "secret");
    String view = snapshot(s, "student").toString();
    assertFalse(view.contains("passwordHash"));
    assertFalse(view.contains("schoolToken"));
    assertFalse(view.contains("20260001@stu.neu.edu.cn"));
  }

  @Test
  void createsMemberIdsNotOnlyNumbers() {
    team("20260002");
    var r = list(s, "applications").getFirst();
    assertTrue(contains(r.path("memberUserIds"), "member"));
    execute(s, "member", "application.exit", obj().put("id", text(r, "id")));
    assertFalse(contains(r.path("memberUserIds"), "member"));
  }

  @Test
  void longAndUnicodePasswordsAreNotTruncated() {
    String password = "长密码".repeat(30);
    String hash = Passwords.encode(password);
    assertTrue(Passwords.matches(password, hash));
    assertFalse(Passwords.matches(password + "a", hash));
    assertTrue(Passwords.matches("a".repeat(128), Passwords.encode("a".repeat(128))));
    assertThrows(ApiError.class, () -> Passwords.encode("a".repeat(129)));
  }
}
