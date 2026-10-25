package com.eduai.backend.exam;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface ExamQuestionRepository extends JpaRepository<ExamQuestion, ExamQuestionKey> {

    List<ExamQuestion> findByIdExamIdOrderByPositionAsc(UUID examId);

    List<ExamQuestion> findByIdExamIdIn(Collection<UUID> examIds);

    /** Runs at once so the (exam_id, position) unique constraint never clashes with the re-insert. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ExamQuestion eq where eq.id.examId = :examId")
    void deleteAllFor(@Param("examId") UUID examId);
}
