package com.eduai.backend.attempt;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AnswerRepository extends JpaRepository<Answer, UUID> {

    List<Answer> findByAttemptId(UUID attemptId);

    Optional<Answer> findByAttemptIdAndQuestionId(UUID attemptId, UUID questionId);
}
