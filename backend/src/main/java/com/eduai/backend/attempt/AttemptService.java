package com.eduai.backend.attempt;

import com.eduai.backend.attempt.AttemptDtos.*;
import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.common.ApiException;
import com.eduai.backend.exam.Exam;
import com.eduai.backend.exam.ExamQuestion;
import com.eduai.backend.exam.ExamQuestionRepository;
import com.eduai.backend.exam.ExamRepository;
import com.eduai.backend.question.Question;
import com.eduai.backend.question.QuestionOption;
import com.eduai.backend.question.QuestionOptionRepository;
import com.eduai.backend.question.QuestionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/** Step 8a: a student starts, answers (autosave) and submits an exam; objective answers are scored on submit. */
@Service
public class AttemptService {

    /** Network slack: an answer that arrives a few seconds after the deadline still counts. */
    private static final Duration GRACE = Duration.ofSeconds(10);

    private final ExamRepository exams;
    private final ExamQuestionRepository examQuestions;
    private final QuestionRepository questions;
    private final QuestionOptionRepository options;
    private final AttemptRepository attempts;
    private final AnswerRepository answers;

    public AttemptService(ExamRepository exams, ExamQuestionRepository examQuestions, QuestionRepository questions,
                          QuestionOptionRepository options, AttemptRepository attempts, AnswerRepository answers) {
        this.exams = exams;
        this.examQuestions = examQuestions;
        this.questions = questions;
        this.options = options;
        this.attempts = attempts;
        this.answers = answers;
    }

    /** The paper of an exam in order, with its questions and MCQ options loaded. */
    public record Paper(List<ExamQuestion> rows, Map<UUID, Question> questions, Map<UUID, List<QuestionOption>> options) {}

    // ---- exam list -------------------------------------------------------------

    @Transactional
    public List<StudentExam> listExams(AuthenticatedUser user) {
        Instant now = Instant.now();
        Map<UUID, Attempt> mine = attempts.findByStudentId(user.id()).stream()
                .collect(Collectors.toMap(Attempt::getExamId, a -> a));
        List<Exam> visible = exams.findByStatusInOrderByCreatedAtDesc(List.of("PUBLISHED", "CLOSED")).stream()
                .filter(e -> mine.containsKey(e.getId())
                        || (e.getStatus().equals("PUBLISHED") && (e.getEndsAt() == null || e.getEndsAt().isAfter(now))))
                .toList();
        if (visible.isEmpty()) return List.of();
        Map<UUID, List<ExamQuestion>> rows = examQuestions.findByIdExamIdIn(visible.stream().map(Exam::getId).toList())
                .stream().collect(Collectors.groupingBy(r -> r.getId().getExamId()));
        List<StudentExam> out = new ArrayList<>();
        for (Exam e : visible) {
            Attempt a = mine.get(e.getId());
            if (a != null && a.getStatus().equals("IN_PROGRESS") && now.isAfter(deadline(a, e))) {
                a = finalizeAttempt(a.getId(), true);   // time ran out while the student was away
            }
            List<ExamQuestion> paper = rows.getOrDefault(e.getId(), List.of());
            BigDecimal total = paper.stream().map(ExamQuestion::getMarks).reduce(BigDecimal.ZERO, BigDecimal::add)
                    .setScale(2, RoundingMode.HALF_UP);
            boolean open = e.getStatus().equals("PUBLISHED")
                    && (e.getStartsAt() == null || !now.isBefore(e.getStartsAt()))
                    && (e.getEndsAt() == null || now.isBefore(e.getEndsAt()));
            AttemptBrief brief = a == null ? null : new AttemptBrief(a.getId(), a.getStatus(), a.getScore(),
                    a.getMaxScore(), a.getStartedAt(), a.getSubmittedAt(), a.getPendingCount());
            boolean canStart = open && !paper.isEmpty() && (a == null || a.getStatus().equals("IN_PROGRESS"));
            out.add(new StudentExam(e.getId(), e.getTitle(), e.getDescription(), e.getDurationMinutes(), e.getStatus(),
                    e.getStartsAt(), e.getEndsAt(), paper.size(), total, canStart, brief));
        }
        return out;
    }

    // ---- start / resume --------------------------------------------------------

    /** noRollbackFor: when time is over we grade the attempt AND answer 409; the grading must survive. */
    @Transactional(noRollbackFor = ApiException.class)
    public AttemptView start(AuthenticatedUser user, UUID examId) {
        Exam e = exams.findById(examId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Exam not found"));
        Instant now = Instant.now();
        Optional<Attempt> existing = attempts.findByExamIdAndStudentId(examId, user.id());
        if (existing.isPresent()) {
            Attempt a = existing.get();
            if (a.getStatus().equals("IN_PROGRESS")) {
                if (now.isAfter(deadline(a, e))) {
                    finalizeAttempt(a.getId(), true);
                    throw new ApiException(HttpStatus.CONFLICT, "Your time is over. The attempt was submitted automatically.");
                }
                return view(a, e);   // resume after a refresh or a lost connection
            }
            throw new ApiException(HttpStatus.CONFLICT, "You have already taken this exam.");
        }
        if (!e.getStatus().equals("PUBLISHED")) throw new ApiException(HttpStatus.NOT_FOUND, "Exam not found");
        if (e.getStartsAt() != null && now.isBefore(e.getStartsAt())) {
            throw new ApiException(HttpStatus.CONFLICT, "This exam has not opened yet.");
        }
        if (e.getEndsAt() != null && !now.isBefore(e.getEndsAt())) {
            throw new ApiException(HttpStatus.CONFLICT, "This exam has ended.");
        }
        List<ExamQuestion> rows = examQuestions.findByIdExamIdOrderByPositionAsc(examId);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.CONFLICT, "This exam has no questions.");
        BigDecimal max = rows.stream().map(ExamQuestion::getMarks).reduce(BigDecimal.ZERO, BigDecimal::add);
        Attempt a = attempts.save(new Attempt(examId, user.id(), max));
        return view(a, e);
    }

    // ---- read ------------------------------------------------------------------

    @Transactional
    public AttemptView get(AuthenticatedUser user, UUID attemptId) {
        Attempt a = mine(user, attemptId);
        Exam e = exam(a);
        if (a.getStatus().equals("IN_PROGRESS") && Instant.now().isAfter(deadline(a, e))) {
            a = finalizeAttempt(a.getId(), true);
        }
        return view(a, e);
    }

    // ---- autosave --------------------------------------------------------------

    @Transactional(noRollbackFor = ApiException.class)
    public SaveResult saveAnswer(AuthenticatedUser user, UUID attemptId, UUID questionId, SaveAnswerRequest req) {
        Attempt a = mine(user, attemptId);
        Exam e = exam(a);
        Instant now = Instant.now();
        if (!a.getStatus().equals("IN_PROGRESS")) {
            throw new ApiException(HttpStatus.CONFLICT, "This attempt is already submitted.");
        }
        if (now.isAfter(deadline(a, e).plus(GRACE))) {
            finalizeAttempt(a.getId(), true);
            throw new ApiException(HttpStatus.CONFLICT, "Time is up. Your attempt was submitted automatically.");
        }
        Paper paper = loadPaper(e.getId());
        Question q = paper.questions().get(questionId);
        if (q == null) throw new ApiException(HttpStatus.NOT_FOUND, "That question is not part of this exam.");

        UUID optionId = null;
        String text = null;
        if (q.getType().equals("MCQ")) {
            if (req.optionPosition() != null) {
                optionId = paper.options().getOrDefault(questionId, List.of()).stream()
                        .filter(o -> o.getPosition() == req.optionPosition()).map(QuestionOption::getId).findFirst()
                        .orElseThrow(() -> new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "That option does not exist."));
            }
        } else if (req.text() != null && !req.text().isBlank()) {
            text = req.text();
        }
        Optional<Answer> current = answers.findByAttemptIdAndQuestionId(attemptId, questionId);
        if (optionId == null && text == null) {          // the student cleared the answer
            current.ifPresent(answers::delete);
            return new SaveResult(now, now);
        }
        Answer ans = current.orElseGet(() -> new Answer(attemptId, questionId));
        ans.setSelectedOptionId(optionId);
        ans.setAnswerText(text);
        ans.setAnsweredAt(now);
        answers.save(ans);
        return new SaveResult(now, now);
    }

    // ---- submit / grade --------------------------------------------------------

    @Transactional
    public AttemptView submit(AuthenticatedUser user, UUID attemptId) {
        Attempt a = mine(user, attemptId);
        Exam e = exam(a);
        if (a.getStatus().equals("IN_PROGRESS")) {
            a = finalizeAttempt(a.getId(), Instant.now().isAfter(deadline(a, e).plus(GRACE)));
        }
        return view(a, e);
    }

    /** Scores the objective answers and closes the attempt. Safe to call twice (second call changes nothing). */
    @Transactional
    public Attempt finalizeAttempt(UUID attemptId, boolean timedOut) {
        Attempt a = attempts.findLocked(attemptId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Attempt not found"));
        if (!a.getStatus().equals("IN_PROGRESS")) return a;
        Exam e = exam(a);
        Paper paper = loadPaper(e.getId());
        Map<UUID, Answer> byQuestion = answers.findByAttemptId(a.getId()).stream()
                .collect(Collectors.toMap(Answer::getQuestionId, x -> x));
        Instant now = Instant.now();
        BigDecimal total = BigDecimal.ZERO;
        int awaiting = 0;
        for (ExamQuestion row : paper.rows()) {
            Answer ans = byQuestion.get(row.getQuestionId());
            if (ans == null) continue;                     // unanswered: 0 marks, nothing to store
            Question q = paper.questions().get(row.getQuestionId());
            Grader.Grade g = Grader.grade(q.getType(), q.getCorrectAnswer(), q.getPayload(),
                    paper.options().getOrDefault(q.getId(), List.of()),
                    ans.getSelectedOptionId(), ans.getAnswerText(), row.getMarks());
            ans.setGrading(g.grading());
            ans.setCorrect(g.correct());
            ans.setMarksAwarded(g.marks());
            ans.setGradedAt(g.marks() == null ? null : now);
            if (g.marks() != null) total = total.add(g.marks());
            if (g.grading().equals("AWAITING")) awaiting++;
        }
        answers.saveAll(byQuestion.values());
        Instant deadline = deadline(a, e);
        a.setStatus("SUBMITTED");
        a.setSubmittedAt(timedOut && now.isAfter(deadline) ? deadline : now);
        a.setScore(total.setScale(2, RoundingMode.HALF_UP));
        a.setPendingCount(awaiting);
        return attempts.save(a);
    }

    // ---- shared helpers (also used by ResultsService) ---------------------------

    public static Instant deadline(Attempt a, Exam e) {
        Instant byDuration = a.getStartedAt().plus(Duration.ofMinutes(e.getDurationMinutes()));
        return e.getEndsAt() != null && e.getEndsAt().isBefore(byDuration) ? e.getEndsAt() : byDuration;
    }

    public Paper loadPaper(UUID examId) {
        List<ExamQuestion> rows = examQuestions.findByIdExamIdOrderByPositionAsc(examId);
        List<UUID> ids = rows.stream().map(ExamQuestion::getQuestionId).toList();
        Map<UUID, Question> qs = questions.findAllById(ids).stream().collect(Collectors.toMap(Question::getId, q -> q));
        Map<UUID, List<QuestionOption>> opts = ids.isEmpty() ? Map.of()
                : options.findByQuestionIdInOrderByQuestionIdAscPositionAsc(ids).stream()
                        .collect(Collectors.groupingBy(QuestionOption::getQuestionId));
        return new Paper(rows, qs, opts);
    }

    /** Every question with the student's answer, the key and the marks. */
    public List<ResultItem> resultItems(Paper paper, List<Answer> given) {
        Map<UUID, Answer> byQuestion = given.stream().collect(Collectors.toMap(Answer::getQuestionId, x -> x));
        List<ResultItem> out = new ArrayList<>();
        for (ExamQuestion row : paper.rows()) {
            Question q = paper.questions().get(row.getQuestionId());
            List<QuestionOption> opts = paper.options().getOrDefault(q.getId(), List.of());
            Answer ans = byQuestion.get(q.getId());
            String studentAnswer = null;
            if (ans != null) {
                studentAnswer = ans.getSelectedOptionId() == null ? ans.getAnswerText()
                        : opts.stream().filter(o -> o.getId().equals(ans.getSelectedOptionId()))
                                .map(QuestionOption::getOptionText).findFirst().orElse(null);
            }
            out.add(new ResultItem(row.getPosition(), q.getId(), q.getType(), q.getQuestionText(), row.getMarks(),
                    ans == null ? BigDecimal.ZERO.setScale(2) : ans.getMarksAwarded(),
                    ans == null ? "UNANSWERED" : ans.getGrading(),
                    ans == null ? Boolean.FALSE : ans.getCorrect(), studentAnswer,
                    q.getCorrectAnswer(), q.getExplanation(), ans == null ? null : ans.getFeedback(), q.getPayload()));
        }
        return out;
    }

    static boolean released(Exam e) {
        return e.getStatus().equals("CLOSED") || (e.getEndsAt() != null && e.getEndsAt().isBefore(Instant.now()));
    }

    private Attempt mine(AuthenticatedUser user, UUID attemptId) {
        Attempt a = attempts.findById(attemptId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Attempt not found"));
        if (!a.getStudentId().equals(user.id())) throw new ApiException(HttpStatus.NOT_FOUND, "Attempt not found");
        return a;
    }

    private Exam exam(Attempt a) {
        return exams.findById(a.getExamId()).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Exam not found"));
    }

    private AttemptView view(Attempt a, Exam e) {
        Paper paper = loadPaper(e.getId());
        Instant now = Instant.now();
        Instant deadline = deadline(a, e);
        if (a.getStatus().equals("IN_PROGRESS")) {
            List<StudentQuestion> qs = new ArrayList<>();
            for (ExamQuestion row : paper.rows()) qs.add(studentQuestion(row, paper));
            Map<UUID, SavedAnswer> saved = new LinkedHashMap<>();
            for (Answer ans : answers.findByAttemptId(a.getId())) {
                Integer pos = null;
                if (ans.getSelectedOptionId() != null) {
                    pos = paper.options().getOrDefault(ans.getQuestionId(), List.of()).stream()
                            .filter(o -> o.getId().equals(ans.getSelectedOptionId()))
                            .map(QuestionOption::getPosition).findFirst().orElse(null);
                }
                saved.put(ans.getQuestionId(), new SavedAnswer(pos, ans.getAnswerText()));
            }
            return new AttemptView(a.getId(), e.getId(), e.getTitle(), a.getStatus(), a.getStartedAt(), deadline, now,
                    e.getDurationMinutes(), a.getMaxScore(), qs, saved, null);
        }
        boolean released = released(e);
        List<ResultItem> items = released ? resultItems(paper, answers.findByAttemptId(a.getId())) : List.of();
        ResultSummary result = new ResultSummary(a.getScore(), a.getMaxScore(), a.getPendingCount(), released, items);
        return new AttemptView(a.getId(), e.getId(), e.getTitle(), a.getStatus(), a.getStartedAt(), deadline, now,
                e.getDurationMinutes(), a.getMaxScore(), List.of(), Map.of(), result);
    }

    /** The question as the student may see it: never the answer key. */
    private StudentQuestion studentQuestion(ExamQuestion row, Paper paper) {
        Question q = paper.questions().get(row.getQuestionId());
        Map<String, Object> p = q.getPayload() == null ? Map.of() : q.getPayload();
        List<StudentOption> opts = paper.options().getOrDefault(q.getId(), List.of()).stream()
                .map(o -> new StudentOption(o.getPosition(), o.getOptionText())).toList();
        List<String> left = null, right = null, subs = null;
        if (q.getType().equals("MATCH")) {
            left = strings(p.get("left"));
            right = strings(p.get("right"));
        } else if (q.getType().equals("CASE_BASED") && p.get("sub_questions") instanceof List<?> list) {
            subs = new ArrayList<>();
            for (Object o : list) {
                if (o instanceof Map<?, ?> m && m.get("question") != null) subs.add(String.valueOf(m.get("question")));
            }
        }
        return new StudentQuestion(row.getPosition(), q.getId(), q.getType(), q.getQuestionText(), row.getMarks(),
                opts, left, right, subs);
    }

    private static List<String> strings(Object o) {
        if (!(o instanceof List<?> l)) return List.of();
        return l.stream().map(String::valueOf).toList();
    }
}
