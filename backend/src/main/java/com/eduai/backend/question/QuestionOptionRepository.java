package com.eduai.backend.question;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface QuestionOptionRepository extends JpaRepository<QuestionOption, UUID> {

    List<QuestionOption> findByQuestionIdInOrderByQuestionIdAscPositionAsc(Collection<UUID> questionIds);

    /** Runs immediately (so the unique position / single-correct indexes never clash with the re-insert). */
    @Modifying(flushAutomatically = true)
    @Query("delete from QuestionOption o where o.questionId = :questionId")
    void deleteAllFor(@Param("questionId") UUID questionId);
}
