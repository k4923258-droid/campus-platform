package cn.campus.platform;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;

public interface LockRepository extends JpaRepository<MutationLock, Long> {
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select l from MutationLock l where l.id=1")
  MutationLock acquire();
}
