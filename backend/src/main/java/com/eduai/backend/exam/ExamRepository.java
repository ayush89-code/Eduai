package com.eduai.backend.exam;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface ExamRepository extends JpaRepository<Exam, UUID> {

    List<Exam> findByTeacherIdOrderByCreatedAtDesc(UUID teacherId);

    List<Exam> findAllByOrderByCreatedAtDesc();

    /** Step 8: the exams students can see (PUBLISHED, plus CLOSED ones they took). */
    List<Exam> findByStatusInOrderByCreatedAtDesc(Collection<String> statuses);

    /** Student attempts on this exam. */
    @Query(value = "SELECT COUNT(*) FROM attempts WHERE exam_id = :examId", nativeQuery = true)
    long countAttempts(@Param("examId") UUID examId);
}
