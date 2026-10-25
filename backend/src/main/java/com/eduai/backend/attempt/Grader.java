package com.eduai.backend.attempt;

import com.eduai.backend.question.QuestionOption;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;

/**
 * Step 8: automatic scoring of the objective question types.
 * MCQ, TRUE_FALSE, FILL_BLANK and MATCH are scored here. Everything else (short / long answer, passage based)
 * is AWAITING the teacher's marks (AI scoring of written answers is on the v2 roadmap).
 */
public final class Grader {
    private Grader() {}

    /** grading is AUTO or AWAITING; marks / correct are null while AWAITING. */
    public record Grade(BigDecimal marks, Boolean correct, String grading) {}

    public static Grade grade(String type, String correctAnswer, Map<String, Object> payload,
                              List<QuestionOption> options, UUID selectedOptionId, String answerText,
                              BigDecimal itemMarks) {
        BigDecimal full = itemMarks.setScale(2, RoundingMode.HALF_UP);
        BigDecimal zero = BigDecimal.ZERO.setScale(2);
        boolean blank = answerText == null || answerText.isBlank();
        switch (type) {
            case "MCQ" -> {
                boolean ok = selectedOptionId != null && options.stream()
                        .anyMatch(o -> o.getId().equals(selectedOptionId) && o.isCorrect());
                return auto(ok, full, zero);
            }
            case "TRUE_FALSE" -> {
                boolean ok = !blank && answerText.trim().equalsIgnoreCase(correctAnswer == null ? "" : correctAnswer.trim());
                return auto(ok, full, zero);
            }
            case "FILL_BLANK" -> {
                if (blank) return auto(false, full, zero);
                Set<String> accepted = new HashSet<>();
                accepted.add(normalize(correctAnswer));
                if (payload != null && payload.get("alt_answers") instanceof List<?> alts) {
                    for (Object a : alts) accepted.add(normalize(String.valueOf(a)));
                }
                accepted.remove("");
                return auto(accepted.contains(normalize(answerText)), full, zero);
            }
            case "MATCH" -> {
                Map<String, String> given = blank ? null : parseFlatJson(answerText);
                Map<?, ?> key = payload != null && payload.get("answer_key") instanceof Map<?, ?> m ? m : Map.of();
                if (key.isEmpty() || given == null) return auto(false, full, zero);
                int right = 0;
                for (Map.Entry<?, ?> e : key.entrySet()) {
                    String got = given.get(String.valueOf(e.getKey()));
                    if (got != null && got.trim().equalsIgnoreCase(String.valueOf(e.getValue()).trim())) right++;
                }
                BigDecimal marks = full.multiply(BigDecimal.valueOf(right))
                        .divide(BigDecimal.valueOf(key.size()), 2, RoundingMode.HALF_UP);
                return new Grade(marks, right == key.size(), "AUTO");
            }
            default -> {
                return blank ? auto(false, full, zero) : new Grade(null, null, "AWAITING");
            }
        }
    }

    private static Grade auto(boolean ok, BigDecimal full, BigDecimal zero) {
        return new Grade(ok ? full : zero, ok, "AUTO");
    }

    /** lower case, letters and digits only, single spaces: "The  Sun!" -> "the sun". */
    static String normalize(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder();
        boolean space = true;
        for (char c : s.toLowerCase(Locale.ROOT).toCharArray()) {
            if (Character.isLetterOrDigit(c)) { sb.append(c); space = false; }
            else if (!space) { sb.append(' '); space = true; }
        }
        return sb.toString().trim();
    }

    /** Parses {"1":"B","2":"A"} (string keys and values only); null when the text is not such an object. */
    static Map<String, String> parseFlatJson(String text) {
        try {
            int[] i = {0};
            skip(text, i);
            expect(text, i, '{');
            Map<String, String> out = new LinkedHashMap<>();
            skip(text, i);
            if (text.charAt(i[0]) == '}') return out;
            while (true) {
                skip(text, i);
                String k = readString(text, i);
                skip(text, i);
                expect(text, i, ':');
                skip(text, i);
                String v = readString(text, i);
                out.put(k, v);
                skip(text, i);
                char c = text.charAt(i[0]++);
                if (c == '}') return out;
                if (c != ',') return null;
            }
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private static void skip(String s, int[] i) {
        while (i[0] < s.length() && Character.isWhitespace(s.charAt(i[0]))) i[0]++;
    }

    private static void expect(String s, int[] i, char c) {
        if (s.charAt(i[0]++) != c) throw new IllegalArgumentException("bad json");
    }

    private static String readString(String s, int[] i) {
        expect(s, i, '"');
        StringBuilder sb = new StringBuilder();
        while (true) {
            char c = s.charAt(i[0]++);
            if (c == '"') return sb.toString();
            if (c != '\\') { sb.append(c); continue; }
            char n = s.charAt(i[0]++);
            switch (n) {
                case 'n' -> sb.append('\n');
                case 't' -> sb.append('\t');
                case 'r' -> sb.append('\r');
                case 'b' -> sb.append('\b');
                case 'f' -> sb.append('\f');
                case 'u' -> { sb.append((char) Integer.parseInt(s.substring(i[0], i[0] + 4), 16)); i[0] += 4; }
                default -> sb.append(n);   // \" \\ \/
            }
        }
    }
}
