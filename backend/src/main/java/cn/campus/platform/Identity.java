package cn.campus.platform;

import static cn.campus.platform.Rules.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

public final class Identity {

  private Identity() {}

  public static boolean verified(JsonNode u) {
    return (
      u != null &&
      text(u, "accountStatus").equals("active") &&
      text(u, "bindingStatus").equals("bound") &&
      !text(u, "emailVerifiedAt").isEmpty() &&
      List.of("demo", "local-mail", "campus-email", "school").contains(text(u, "identitySource"))
    );
  }

  public static boolean available(JsonNode u) {
    return (
      verified(u) ||
      (u != null &&
        text(u, "accountStatus").equals("active") &&
        text(u, "identitySource").equals("bootstrap") &&
        contains(u.path("roles"), "admin"))
    );
  }

  public static boolean compatible(JsonNode a, JsonNode b) {
    var formal = List.of("campus-email", "school");
    return (
      verified(a) &&
      verified(b) &&
      (text(a, "identitySource").equals(text(b, "identitySource")) ||
        (formal.contains(text(a, "identitySource")) && formal.contains(text(b, "identitySource"))))
    );
  }

  public static boolean linked(JsonNode r, JsonNode u) {
    return verified(u) && contains(r.path("memberUserIds"), text(u, "id"));
  }

  public static ObjectNode publicUser(JsonNode u, boolean own) {
    var out = obj();
    for (String key : List.of(
      "id",
      "name",
      "studentNo",
      "roles",
      "orgIds",
      "accountStatus",
      "bindingStatus",
      "identitySource",
      "emailVerifiedAt"
    ))
      if (u.has(key)) out.set(key, u.get(key).deepCopy());
    if (own && !text(u, "email").isEmpty()) out.put(
      "maskedEmail",
      text(u, "email").replaceFirst("^(.).*(@.*)$", "$1***$2")
    );
    return out;
  }
}
