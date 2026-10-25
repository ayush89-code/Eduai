package com.eduai.backend.attempt;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AttemptRepository extends JpaRepository<Attempt, UUID> {

    Optional<Attempt> findByExamIdAndStudentId(UUID examId, UUID studentId);

    List<Attempt> findByStudentId(UUID studentId);

    List<Attempt> findByExamIdOrderByStartedAtDesc(UUID examId);

    List<Attempt> findByExamIdAndStatus(UUID examId, String status);

    /** Row lock, so a submit and a timer-expiry can never grade the same attempt twice. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Attempt a where a.id = :id")
    Optional<Attempt> findLocked(@Param("id") UUID id);
}
