package com.eduai.backend.attempt;

import com.eduai.backend.attempt.AttemptDtos.*;
import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.common.ApiException;
import com.eduai.backend.exam.Exam;
import com.eduai.backend.exam.ExamRepository;
import com.eduai.backend.user.Role;
import com.eduai.backend.user.User;
import com.eduai.backend.user.UserRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/** Step 8a: the teacher's view of an exam's results, and marking of written answers. */
@Service
public class ResultsService {

    private final ExamRepository exams;
    private final AttemptRepository attempts;
    private final AnswerRepository answers;
    private final UserRepository users;
    private final AttemptService attemptService;

    public ResultsService(ExamRepository exams, AttemptRepository attempts, AnswerRepository answers,
                          UserRepository users, AttemptService attemptService) {
        this.exams = exams;
        this.attempts = attempts;
        this.answers = answers;
        this.users = users;
        this.attemptService = attemptService;
    }

    @Transactional
    public ExamResults forExam(AuthenticatedUser user, UUID examId) {
        Exam e = ownedExam(user, examId);
        Instant now = Instant.now();
        for (Attempt a : attempts.findByExamIdAndStatus(examId, "IN_PROGRESS")) {   // time ran out, student never came back
            if (now.isAfter(AttemptService.deadline(a, e))) attemptService.finalizeAttempt(a.getId(), true);
        }
        List<Attempt> all = attempts.findByExamIdOrderByStartedAtDesc(examId);
        Map<UUID, User> byId = users.findAllById(all.stream().map(Attempt::getStudentId).toList()).stream()
                .collect(Collectors.toMap(User::getId, u -> u));
        BigDecimal max = all.stream().map(Attempt::getMaxScore).filter(Objects::nonNull).findFirst().orElse(BigDecimal.ZERO);
        return new ExamResults(e.getId(), e.getTitle(), e.getStatus(), max,
                all.stream().map(a -> row(a, byId.get(a.getStudentId()))).toList());
    }

    @Transactional
    public AttemptDetail detail(AuthenticatedUser user, UUID attemptId) {
        Attempt a = attempt(attemptId);
        Exam e = ownedExam(user, a.getExamId());
        if (a.getStatus().equals("IN_PROGRESS")) {
            if (Instant.now().isAfter(AttemptService.deadline(a, e))) a = attemptService.finalizeAttempt(a.getId(), true);
        }
        return build(a);
    }

    @Transactional
    public AttemptDetail mark(AuthenticatedUser user, UUID attemptId, UUID questionId, MarkRequest req) {
        Attempt a = attempt(attemptId);
        ownedExam(user, a.getExamId());
        if (!a.getStatus().equals("SUBMITTED")) {
            throw new ApiException(HttpStatus.CONFLICT, "The student has not submitted yet.");
        }
        AttemptService.Paper paper = attemptService.loadPaper(a.getExamId());
        BigDecimal max = paper.rows().stream().filter(r -> r.getQuestionId().equals(questionId))
                .map(r -> r.getMarks()).findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Question not found in this exam"));
        Answer ans = answers.findByAttemptIdAndQuestionId(attemptId, questionId)
                .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "The student did not answer this question."));
        if (!ans.getGrading().equals("AWAITING") && !ans.getGrading().equals("MANUAL")) {
            throw new ApiException(HttpStatus.CONFLICT, "This question was scored automatically and cannot be re-marked.");
        }
        if (req.marks().compareTo(max) > 0) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "Marks cannot be more than " + max.stripTrailingZeros().toPlainString() + ".");
        }
        ans.setMarksAwarded(req.marks().setScale(2, RoundingMode.HALF_UP));
        ans.setCorrect(req.marks().compareTo(max) >= 0);
        ans.setGrading("MANUAL");
        ans.setFeedback(req.feedback() == null || req.feedback().isBlank() ? null : req.feedback().trim());
        ans.setGradedAt(Instant.now());
        answers.save(ans);
        answers.flush();

        List<Answer> all = answers.findByAttemptId(attemptId);
        a.setScore(all.stream().map(Answer::getMarksAwarded).filter(Objects::nonNull)
                .reduce(BigDecimal.ZERO, BigDecimal::add).setScale(2, RoundingMode.HALF_UP));
        a.setPendingCount((int) all.stream().filter(x -> x.getGrading().equals("AWAITING")).count());
        attempts.save(a);
        return build(a);
    }

    private AttemptDetail build(Attempt a) {
        AttemptService.Paper paper = attemptService.loadPaper(a.getExamId());
        List<ResultItem> items = attemptService.resultItems(paper, answers.findByAttemptId(a.getId()));
        return new AttemptDetail(row(a, users.findById(a.getStudentId()).orElse(null)), items);
    }

    private AttemptRow row(Attempt a, User u) {
        return new AttemptRow(a.getId(), a.getStudentId(), u == null ? "Unknown" : u.getFullName(),
                u == null ? "" : u.getEmail(), a.getStatus(), a.getStartedAt(), a.getSubmittedAt(),
                a.getScore(), a.getMaxScore(), a.getPendingCount());
    }

    private Attempt attempt(UUID id) {
        return attempts.findById(id).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Attempt not found"));
    }

    private Exam ownedExam(AuthenticatedUser user, UUID examId) {
        Exam e = exams.findById(examId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Exam not found"));
        if (user.role() != Role.ADMIN && !e.getTeacherId().equals(user.id())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Exam not found");
        }
        return e;
    }
}
