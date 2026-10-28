package cn.campus.platform;

import jakarta.persistence.*;

@Entity
@Table(name = "mutation_lock")
public class MutationLock {

  @Id
  public Long id;

  protected MutationLock() {}
}
