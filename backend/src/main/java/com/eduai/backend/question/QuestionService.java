package com.eduai.backend.question;

import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.common.ApiException;
import com.eduai.backend.question.QuestionDtos.*;
import com.eduai.backend.user.Role;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;

/** Step 7a: teachers review the AI-generated DRAFT questions (edit / approve / reject). */
@Service
public class QuestionService {

    private static final List<String> TYPE_ORDER = List.of(
            "MCQ", "TRUE_FALSE", "FILL_BLANK", "SHORT_ANSWER", "LONG_ANSWER", "MATCH", "CASE_BASED", "SUBJECTIVE");
    private static final Set<String> STATUSES = Set.of("DRAFT", "APPROVED", "REJECTED");
    private static final Set<String> DIFFICULTIES = Set.of("EASY", "MEDIUM", "HARD");
    /** MATCH and CASE_BASED keep their pairs / sub-questions as generated; only the wording and marks change. */
    private static final Set<String> STRUCTURED = Set.of("MATCH", "CASE_BASED");
    private static final BigDecimal MAX_MARKS = new BigDecimal("100");

    private final QuestionRepository questions;
    private final QuestionOptionRepository options;

    public QuestionService(QuestionRepository questions, QuestionOptionRepository options) {
        this.questions = questions;
        this.options = options;
    }

    // ---- reading ---------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<QuestionView> list(AuthenticatedUser user, UUID sourceId, String status, String type) {
        if (status != null && !STATUSES.contains(status)) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "status must be DRAFT, APPROVED or REJECTED");
        }
        if (type != null && !TYPE_ORDER.contains(type)) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "Unknown question type");
        }
        if (!questions.sourceVisible(sourceId, user.id(), isAdmin(user))) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Source not found");
        }
        List<Question> found = questions.findForSource(sourceId, user.id(), isAdmin(user)).stream()
                .filter(q -> status == null || q.getStatus().equals(status))
                .filter(q -> type == null || q.getType().equals(type))
                .sorted(Comparator.comparingInt((Question q) -> typeRank(q.getType())))
                .toList();
        return toViews(found);
    }

    // ---- editing ---------------------------------------------------------------

    @Transactional
    public QuestionView update(AuthenticatedUser user, UUID id, UpdateRequest req) {
        Question q = owned(user, id);
        if (isUsed(q.getId())) {
            throw new ApiException(HttpStatus.CONFLICT, "This question is already used in an exam and cannot be edited.");
        }
        boolean structured = STRUCTURED.contains(q.getType());
        boolean mcq = q.getType().equals("MCQ");
        boolean contentChanged = false;

        if (req.questionText() != null) {
            String text = req.questionText().trim();
            if (text.length() < 3) throw bad("The question text is too short.");
            q.setQuestionText(text);
            contentChanged = true;
        }
        if (req.difficulty() != null) {
            String d = req.difficulty().trim().toUpperCase(Locale.ROOT);
            if (!DIFFICULTIES.contains(d)) throw bad("difficulty must be EASY, MEDIUM or HARD");
            q.setDifficulty(d);
        }
        if (req.topic() != null) {
            String t = req.topic().trim();
            if (t.isEmpty()) throw bad("The topic cannot be empty.");
            q.setTopic(t);
        }
        if (req.explanation() != null) {
            String e = req.explanation().trim();
            q.setExplanation(e.isEmpty() ? null : e);
        }
        if (req.marks() != null) {
            if (req.marks().signum() <= 0 || req.marks().compareTo(MAX_MARKS) > 0) {
                throw bad("marks must be more than 0 and at most 100");
            }
            Map<String, Object> payload = new HashMap<>(q.getPayload());
            payload.put("marks", req.marks().stripTrailingZeros().scale() <= 0
                    ? (Object) req.marks().intValue() : (Object) req.marks().doubleValue());
            q.setPayload(payload);
        }

        if (req.options() != null) {
            if (!mcq) throw bad("Only multiple-choice questions have options.");
            List<OptionInput> in = req.options();
            long correct = in.stream().filter(OptionInput::correct).count();
            if (correct != 1) throw bad("Mark exactly one option as correct.");
            Set<String> seen = new HashSet<>();
            for (OptionInput o : in) {
                if (!seen.add(o.text().trim().toLowerCase(Locale.ROOT))) throw bad("Two options have the same text.");
            }
            options.deleteAllFor(q.getId());   // runs at once, after flushing the edits above
            int pos = 1;
            String answer = "";
            for (OptionInput o : in) {
                options.save(new QuestionOption(q.getId(), pos++, o.text().trim(), o.correct()));
                if (o.correct()) answer = o.text().trim();
            }
            q.setCorrectAnswer(answer);
            contentChanged = true;
        } else if (req.correctAnswer() != null) {
            if (mcq) throw bad("Change the correct option through the options list.");
            if (structured) throw bad("The answer key of this question type cannot be edited; reject it instead.");
            String a = req.correctAnswer().trim();
            if (a.isEmpty()) throw bad("The answer cannot be empty.");
            if (q.getType().equals("TRUE_FALSE")) {
                a = a.toLowerCase(Locale.ROOT);
                if (!a.equals("true") && !a.equals("false")) throw bad("The answer must be true or false.");
            }
            q.setCorrectAnswer(a);
            contentChanged = true;
        }

        if (contentChanged) {
            // the AI cross-check no longer describes the edited text
            Map<String, Object> payload = new HashMap<>(q.getPayload());
            payload.remove("verified");
            payload.put("edited_by_teacher", true);
            q.setPayload(payload);
        }
        questions.save(q);
        questions.flush();
        return toViews(List.of(q)).get(0);
    }

    // ---- approve / reject ------------------------------------------------------

    @Transactional
    public QuestionView approve(AuthenticatedUser user, UUID id) {
        Question q = owned(user, id);
        checkApprovable(q);
        q.setStatus("APPROVED");
        questions.save(q);
        return toViews(List.of(q)).get(0);
    }

    @Transactional
    public QuestionView reject(AuthenticatedUser user, UUID id) {
        Question q = owned(user, id);
        if (!q.getStatus().equals("REJECTED") && isUsed(q.getId())) {
            throw new ApiException(HttpStatus.CONFLICT, "This question is used in an exam, remove it from the paper first.");
        }
        q.setStatus("REJECTED");
        questions.save(q);
        return toViews(List.of(q)).get(0);
    }

    @Transactional
    public BulkResult bulk(AuthenticatedUser user, BulkRequest req) {
        String action = req.action().trim().toUpperCase(Locale.ROOT);
        if (!action.equals("APPROVE") && !action.equals("REJECT")) throw bad("action must be APPROVE or REJECT");
        int changed = 0;
        List<BulkSkipped> skipped = new ArrayList<>();
        for (UUID id : new LinkedHashSet<>(req.ids())) {
            try {
                if (action.equals("APPROVE")) approve(user, id); else reject(user, id);
                changed++;
            } catch (ApiException ex) {
                skipped.add(new BulkSkipped(id, ex.getMessage()));
            }
        }
        return new BulkResult(changed, skipped);
    }

    // ---- helpers ---------------------------------------------------------------

    private void checkApprovable(Question q) {
        if (q.getQuestionText() == null || q.getQuestionText().isBlank()) throw bad("The question text is empty.");
        switch (q.getType()) {
            case "MCQ" -> {
                List<QuestionOption> opts = options.findByQuestionIdInOrderByQuestionIdAscPositionAsc(List.of(q.getId()));
                if (opts.size() < 2 || opts.stream().filter(QuestionOption::isCorrect).count() != 1) {
                    throw bad("A multiple-choice question needs at least 2 options and exactly 1 correct option.");
                }
            }
            case "TRUE_FALSE" -> {
                String a = q.getCorrectAnswer();
                if (!"true".equals(a) && !"false".equals(a)) throw bad("A true/false question needs a true or false answer.");
            }
            default -> {
                if (q.getCorrectAnswer() == null || q.getCorrectAnswer().isBlank()) throw bad("The question has no answer.");
            }
        }
    }

    private Question owned(AuthenticatedUser user, UUID id) {
        return questions.findVisible(id, user.id(), isAdmin(user))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Question not found"));
    }

    private boolean isUsed(UUID id) {
        return !questions.findUsedInExams(List.of(id)).isEmpty();
    }

    private static boolean isAdmin(AuthenticatedUser user) {
        return user.role() == Role.ADMIN;
    }

    private static int typeRank(String type) {
        int i = TYPE_ORDER.indexOf(type);
        return i < 0 ? 99 : i;
    }

    private static ApiException bad(String message) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, message);
    }

    private List<QuestionView> toViews(List<Question> list) {
        if (list.isEmpty()) return List.of();
        List<UUID> ids = list.stream().map(Question::getId).toList();
        Map<UUID, List<OptionDto>> opts = options.findByQuestionIdInOrderByQuestionIdAscPositionAsc(ids).stream()
                .collect(Collectors.groupingBy(QuestionOption::getQuestionId, LinkedHashMap::new,
                        Collectors.mapping(o -> new OptionDto(o.getPosition(), o.getOptionText(), o.isCorrect()),
                                Collectors.toList())));
        Set<UUID> used = new HashSet<>(questions.findUsedInExams(ids));
        return list.stream().map(q -> new QuestionView(
                q.getId(), q.getSourceId(), q.getGenerationJobId(), q.getType(), q.getDifficulty(), q.getTopic(),
                q.getQuestionText(), q.getCorrectAnswer(), q.getExplanation(), q.getStatus(),
                q.getCitationRef(), q.getCitationRetrievedAt(), marksOf(q), q.getPayload(),
                opts.getOrDefault(q.getId(), List.of()), used.contains(q.getId()),
                !STRUCTURED.contains(q.getType()))).toList();
    }

    private static BigDecimal marksOf(Question q) {
        Object m = q.getPayload() == null ? null : q.getPayload().get("marks");
        if (m instanceof Number n) return new BigDecimal(n.toString());
        return BigDecimal.ONE;
    }
}
