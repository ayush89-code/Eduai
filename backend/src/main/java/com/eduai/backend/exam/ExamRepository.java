package com.eduai.backend.exam;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface ExamRepository extends JpaRepository<Exam, UUID> {

    List<Exam> findByTeacherIdOrderByCreatedAtDesc(UUID teacherId);

    List<Exam> findAllByOrderByCreatedAtDesc();

    /** Student attempts on this exam (Step 8 fills the table; until then this is always 0). */
    @Query(value = "SELECT COUNT(*) FROM attempts WHERE exam_id = :examId", nativeQuery = true)
    long countAttempts(@Param("examId") UUID examId);
}
