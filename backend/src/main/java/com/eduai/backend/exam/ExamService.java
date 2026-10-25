package com.eduai.backend.exam;

import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.common.ApiException;
import com.eduai.backend.exam.ExamDtos.*;
import com.eduai.backend.question.Question;
import com.eduai.backend.question.QuestionDtos.QuestionView;
import com.eduai.backend.question.QuestionRepository;
import com.eduai.backend.question.QuestionService;
import com.eduai.backend.user.Role;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/** Step 7b: question paper builder, mock-exam blueprint and publishing. */
@Service
public class ExamService {

    private static final List<String> TYPE_ORDER = List.of(
            "MCQ", "TRUE_FALSE", "FILL_BLANK", "SHORT_ANSWER", "LONG_ANSWER", "MATCH", "CASE_BASED", "SUBJECTIVE");
    private static final List<String> DIFF_ORDER = List.of("EASY", "MEDIUM", "HARD");
    /** Share of a mock paper's marks each type should get (relative weights). */
    private static final Map<String, Integer> TYPE_WEIGHT = Map.of(
            "MCQ", 25, "TRUE_FALSE", 10, "FILL_BLANK", 10, "SHORT_ANSWER", 20,
            "LONG_ANSWER", 15, "MATCH", 10, "CASE_BASED", 10, "SUBJECTIVE", 15);

    private final ExamRepository exams;
    private final ExamQuestionRepository items;
    private final QuestionRepository questions;
    private final QuestionService questionService;

    public ExamService(ExamRepository exams, ExamQuestionRepository items,
                       QuestionRepository questions, QuestionService questionService) {
        this.exams = exams;
        this.items = items;
        this.questions = questions;
        this.questionService = questionService;
    }

    // ---- read ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<ExamSummary> list(AuthenticatedUser user) {
        List<Exam> mine = isAdmin(user) ? exams.findAllByOrderByCreatedAtDesc()
                : exams.findByTeacherIdOrderByCreatedAtDesc(user.id());
        if (mine.isEmpty()) return List.of();
        Map<UUID, List<ExamQuestion>> byExam = items.findByIdExamIdIn(mine.stream().map(Exam::getId).toList())
                .stream().collect(Collectors.groupingBy(eq -> eq.getId().getExamId()));
        return mine.stream().map(e -> summary(e, byExam.getOrDefault(e.getId(), List.of()))).toList();
    }

    @Transactional(readOnly = true)
    public ExamDetail get(AuthenticatedUser user, UUID id) {
        return detail(owned(user, id));
    }

    // ---- create / update / delete ----------------------------------------------

    @Transactional
    public ExamDetail create(AuthenticatedUser user, CreateRequest req) {
        checkSchedule(req.startsAt(), req.endsAt());
        if (req.sourceId() != null && !questions.sourceVisible(req.sourceId(), user.id(), isAdmin(user))) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Source not found");
        }
        Exam e = new Exam(user.id());
        e.setTitle(req.title().trim());
        e.setDescription(blankToNull(req.description()));
        e.setDurationMinutes(req.durationMinutes());
        e.setSourceId(req.sourceId());
        e.setStartsAt(req.startsAt());
        e.setEndsAt(req.endsAt());
        exams.save(e);
        return detail(e);
    }

    @Transactional
    public ExamDetail update(AuthenticatedUser user, UUID id, UpdateRequest req) {
        Exam e = owned(user, id);
        requireDraft(e, "Unpublish the exam before changing its details.");
        if (req.title() != null) {
            if (req.title().isBlank()) throw bad("The title cannot be empty.");
            e.setTitle(req.title().trim());
        }
        if (req.description() != null) e.setDescription(blankToNull(req.description()));
        if (req.durationMinutes() != null) e.setDurationMinutes(req.durationMinutes());
        if (Boolean.TRUE.equals(req.clearSchedule())) {
            e.setStartsAt(null);
            e.setEndsAt(null);
        } else {
            if (req.startsAt() != null) e.setStartsAt(req.startsAt());
            if (req.endsAt() != null) e.setEndsAt(req.endsAt());
        }
        checkSchedule(e.getStartsAt(), e.getEndsAt());
        exams.save(e);
        return detail(e);
    }

    @Transactional
    public void delete(AuthenticatedUser user, UUID id) {
        Exam e = owned(user, id);
        requireDraft(e, "Only draft exams can be deleted. Unpublish it first.");
        exams.delete(e);   // exam_questions go with it (ON DELETE CASCADE)
    }

    // ---- the paper -------------------------------------------------------------

    @Transactional
    public ExamDetail setPaper(AuthenticatedUser user, UUID id, PaperRequest req) {
        Exam e = owned(user, id);
        requireDraft(e, "Unpublish the exam before changing its questions.");
        Set<UUID> seen = new HashSet<>();
        List<Question> picked = new ArrayList<>();
        List<BigDecimal> marks = new ArrayList<>();
        for (PaperItem it : req.items()) {
            if (!seen.add(it.questionId())) throw bad("A question appears twice in the paper.");
            Question q = questions.findVisible(it.questionId(), user.id(), isAdmin(user))
                    .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Question not found"));
            if (!q.getStatus().equals("APPROVED")) throw bad("Only approved questions can be added to a paper.");
            picked.add(q);
            marks.add(it.marks());
        }
        replaceItems(e.getId(), picked, marks);
        return detail(exams.findById(id).orElseThrow());
    }

    /** Mock exam: pick approved questions of one source to hit the marks target, mixing types and difficulty. */
    @Transactional
    public BlueprintResult autoFill(AuthenticatedUser user, UUID id, BlueprintRequest req) {
        Exam e = owned(user, id);
        requireDraft(e, "Unpublish the exam before changing its questions.");
        if (!questions.sourceVisible(req.sourceId(), user.id(), isAdmin(user))) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Source not found");
        }

        List<String> wanted = TYPE_ORDER;
        boolean typesGiven = req.types() != null && !req.types().isEmpty();
        if (typesGiven) {
            for (String t : req.types()) if (!TYPE_ORDER.contains(t)) throw bad("Unknown question type: " + t);
            wanted = TYPE_ORDER.stream().filter(req.types()::contains).toList();
        }
        int easy, medium, hard;
        if (req.easyPercent() == null && req.mediumPercent() == null && req.hardPercent() == null) {
            easy = 30; medium = 50; hard = 20;      // default mix of a mock paper
        } else {
            easy = pct(req.easyPercent(), 0); medium = pct(req.mediumPercent(), 0); hard = pct(req.hardPercent(), 0);
        }
        if (easy + medium + hard != 100) throw bad("Easy, medium and hard percentages must add up to 100.");
        Map<String, Integer> diffPct = Map.of("EASY", easy, "MEDIUM", medium, "HARD", hard);

        final List<String> wantedTypes = wanted;
        List<Question> pool = questions.findForSource(req.sourceId(), user.id(), isAdmin(user)).stream()
                .filter(q -> q.getStatus().equals("APPROVED"))
                .filter(q -> wantedTypes.contains(q.getType()))
                .toList();
        if (pool.isEmpty()) throw bad("This source has no approved questions of the chosen types yet. Review and approve some first.");

        // type -> difficulty -> shuffled candidates
        Map<String, Map<String, List<Question>>> bucket = new LinkedHashMap<>();
        for (Question q : pool) {
            bucket.computeIfAbsent(q.getType(), k -> new HashMap<>())
                    .computeIfAbsent(q.getDifficulty(), k -> new ArrayList<>()).add(q);
        }
        bucket.values().forEach(m -> m.values().forEach(Collections::shuffle));

        double total = req.totalMarks().doubleValue();
        double weightSum = bucket.keySet().stream().mapToInt(t -> TYPE_WEIGHT.getOrDefault(t, 10)).sum();
        Map<String, Double> typeTarget = new HashMap<>(), typeUsed = new HashMap<>(), diffUsed = new HashMap<>();
        bucket.keySet().forEach(t -> typeTarget.put(t, total * TYPE_WEIGHT.getOrDefault(t, 10) / weightSum));

        List<Question> chosen = new ArrayList<>();
        double used = 0;
        while (true) {
            double remaining = total - used;
            String bestType = null, bestDiff = null;
            int bestIdx = -1;
            double bestScore = -Double.MAX_VALUE;
            for (String type : bucket.keySet()) {
                for (String diff : DIFF_ORDER) {
                    List<Question> cands = bucket.get(type).get(diff);
                    if (cands == null) continue;
                    int idx = firstThatFits(cands, remaining);
                    if (idx < 0) continue;
                    double score = (typeTarget.get(type) - typeUsed.getOrDefault(type, 0.0))
                            + (total * diffPct.get(diff) / 100.0 - diffUsed.getOrDefault(diff, 0.0));
                    if (score > bestScore) {
                        bestScore = score; bestType = type; bestDiff = diff; bestIdx = idx;
                    }
                }
            }
            if (bestType == null) break;
            Question q = bucket.get(bestType).get(bestDiff).remove(bestIdx);
            double m = QuestionService.marksOf(q).doubleValue();
            chosen.add(q);
            used += m;
            typeUsed.merge(bestType, m, Double::sum);
            diffUsed.merge(bestDiff, m, Double::sum);
        }

        chosen.sort(Comparator.comparingInt((Question q) -> TYPE_ORDER.indexOf(q.getType()))
                .thenComparingInt(q -> DIFF_ORDER.indexOf(q.getDifficulty())));
        List<BigDecimal> marks = chosen.stream().map(QuestionService::marksOf).toList();

        if (e.getSourceId() == null) {
            e.setSourceId(req.sourceId());
            exams.save(e);
        }
        replaceItems(e.getId(), chosen, marks);

        List<String> warnings = new ArrayList<>();
        BigDecimal got = marks.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        if (got.compareTo(req.totalMarks()) < 0) {
            warnings.add("Reached " + got.stripTrailingZeros().toPlainString() + " of "
                    + req.totalMarks().stripTrailingZeros().toPlainString()
                    + " marks. There are not enough approved questions to fill the rest. Approve or generate more.");
        }
        if (typesGiven) {
            for (String t : wanted) {
                if (!bucket.containsKey(t)) warnings.add("No approved " + t + " questions, so none were used.");
            }
        }
        return new BlueprintResult(detail(exams.findById(id).orElseThrow()), warnings);
    }

    // ---- publishing ------------------------------------------------------------

    @Transactional
    public ExamDetail publish(AuthenticatedUser user, UUID id) {
        Exam e = owned(user, id);
        requireDraft(e, "This exam is already published.");
        List<ExamQuestion> paper = items.findByIdExamIdOrderByPositionAsc(id);
        if (paper.isEmpty()) throw bad("Add at least one question before publishing.");
        for (ExamQuestion eq : paper) {
            Question q = questions.findById(eq.getQuestionId()).orElseThrow();
            if (!q.getStatus().equals("APPROVED")) throw bad("The paper contains a question that is not approved.");
        }
        checkSchedule(e.getStartsAt(), e.getEndsAt());
        if (e.getEndsAt() != null && !e.getEndsAt().isAfter(Instant.now())) {
            throw bad("The end time is already in the past.");
        }
        e.setStatus("PUBLISHED");
        e.setPublishedAt(Instant.now());
        exams.save(e);
        return detail(e);
    }

    @Transactional
    public ExamDetail unpublish(AuthenticatedUser user, UUID id) {
        Exam e = owned(user, id);
        if (!e.getStatus().equals("PUBLISHED")) throw new ApiException(HttpStatus.CONFLICT, "Only a published exam can be unpublished.");
        if (exams.countAttempts(id) > 0) {
            throw new ApiException(HttpStatus.CONFLICT, "Students have already started this exam, so it cannot be unpublished. Close it instead.");
        }
        e.setStatus("DRAFT");
        e.setPublishedAt(null);
        exams.save(e);
        return detail(e);
    }

    @Transactional
    public ExamDetail close(AuthenticatedUser user, UUID id) {
        Exam e = owned(user, id);
        if (!e.getStatus().equals("PUBLISHED")) throw new ApiException(HttpStatus.CONFLICT, "Only a published exam can be closed.");
        e.setStatus("CLOSED");
        exams.save(e);
        return detail(e);
    }

    // ---- helpers ---------------------------------------------------------------

    private void replaceItems(UUID examId, List<Question> picked, List<BigDecimal> marks) {
        items.deleteAllFor(examId);   // flushes pending changes first, then clears the context
        List<ExamQuestion> rows = new ArrayList<>();
        for (int i = 0; i < picked.size(); i++) {
            rows.add(new ExamQuestion(examId, picked.get(i).getId(), i + 1, marks.get(i)));
        }
        items.saveAll(rows);
        items.flush();
    }

    private static int firstThatFits(List<Question> cands, double remaining) {
        for (int i = 0; i < cands.size(); i++) {
            if (QuestionService.marksOf(cands.get(i)).doubleValue() <= remaining + 1e-9) return i;
        }
        return -1;
    }

    private static int pct(Integer v, int fallback) {
        return v == null ? fallback : v;
    }

    private Exam owned(AuthenticatedUser user, UUID id) {
        Exam e = exams.findById(id).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Exam not found"));
        if (!isAdmin(user) && !e.getTeacherId().equals(user.id())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Exam not found");
        }
        return e;
    }

    private static void requireDraft(Exam e, String message) {
        if (!e.getStatus().equals("DRAFT")) throw new ApiException(HttpStatus.CONFLICT, message);
    }

    private static void checkSchedule(Instant starts, Instant ends) {
        if (starts != null && ends != null && !ends.isAfter(starts)) throw bad("The end time must be after the start time.");
    }

    private static boolean isAdmin(AuthenticatedUser user) {
        return user.role() == Role.ADMIN;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static ApiException bad(String message) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, message);
    }

    private ExamSummary summary(Exam e, List<ExamQuestion> paper) {
        BigDecimal total = paper.stream().map(ExamQuestion::getMarks).reduce(BigDecimal.ZERO, BigDecimal::add)
                .setScale(2, RoundingMode.HALF_UP);
        return new ExamSummary(e.getId(), e.getTitle(), e.getDescription(), e.getDurationMinutes(), e.getStatus(),
                e.getSourceId(), e.getStartsAt(), e.getEndsAt(), e.getCreatedAt(), e.getPublishedAt(),
                paper.size(), total);
    }

    private ExamDetail detail(Exam e) {
        List<ExamQuestion> paper = items.findByIdExamIdOrderByPositionAsc(e.getId());
        Map<UUID, Question> byId = questions.findAllById(
                paper.stream().map(ExamQuestion::getQuestionId).toList()).stream()
                .collect(Collectors.toMap(Question::getId, q -> q));
        List<Question> ordered = paper.stream().map(eq -> byId.get(eq.getQuestionId())).toList();
        Map<UUID, QuestionView> views = questionService.toViews(ordered).stream()
                .collect(Collectors.toMap(QuestionView::id, v -> v));
        List<ExamQuestionView> out = paper.stream()
                .map(eq -> new ExamQuestionView(eq.getPosition(), eq.getMarks(), views.get(eq.getQuestionId())))
                .toList();
        return new ExamDetail(summary(e, paper), out);
    }
}
