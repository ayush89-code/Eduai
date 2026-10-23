package com.eduai.backend.question;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface QuestionRepository extends JpaRepository<Question, UUID> {

    /** True when the source exists and belongs to the user (or the user is an admin). */
    @Query(value = """
            SELECT EXISTS (SELECT 1 FROM sources s
                            WHERE s.id = :sourceId AND (:admin = TRUE OR s.owner_id = :userId))
            """, nativeQuery = true)
    boolean sourceVisible(@Param("sourceId") UUID sourceId, @Param("userId") UUID userId,
                          @Param("admin") boolean admin);

    @Query(value = """
            SELECT q.* FROM questions q JOIN sources s ON s.id = q.source_id
             WHERE q.source_id = :sourceId AND (:admin = TRUE OR s.owner_id = :userId)
             ORDER BY q.created_at, q.id
            """, nativeQuery = true)
    List<Question> findForSource(@Param("sourceId") UUID sourceId, @Param("userId") UUID userId,
                                 @Param("admin") boolean admin);

    /** A question the user may touch; empty (-> 404) for other teachers' questions. */
    @Query(value = """
            SELECT q.* FROM questions q JOIN sources s ON s.id = q.source_id
             WHERE q.id = :id AND (:admin = TRUE OR s.owner_id = :userId)
            """, nativeQuery = true)
    Optional<Question> findVisible(@Param("id") UUID id, @Param("userId") UUID userId,
                                   @Param("admin") boolean admin);

    /** Ids (out of the given ones) that already sit in some exam paper. */
    @Query(value = "SELECT DISTINCT eq.question_id FROM exam_questions eq WHERE eq.question_id IN (:ids)",
            nativeQuery = true)
    List<UUID> findUsedInExams(@Param("ids") Collection<UUID> ids);
}
