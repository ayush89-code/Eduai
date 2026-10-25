package com.eduai.backend.attempt;

import com.eduai.backend.attempt.AttemptDtos.*;
import com.eduai.backend.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/** Step 8a: student side. /api/student/** is already limited to the STUDENT role in SecurityConfig. */
@RestController
@RequestMapping("/api/student")
public class StudentExamController {

    private final AttemptService service;

    public StudentExamController(AttemptService service) {
        this.service = service;
    }

    @GetMapping("/exams")
    public List<StudentExam> exams(@AuthenticationPrincipal AuthenticatedUser p) {
        return service.listExams(p);
    }

    @PostMapping("/exams/{examId}/start")
    public AttemptView start(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID examId) {
        return service.start(p, examId);
    }

    @GetMapping("/attempts/{attemptId}")
    public AttemptView get(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID attemptId) {
        return service.get(p, attemptId);
    }

    @PutMapping("/attempts/{attemptId}/answers/{questionId}")
    public SaveResult save(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID attemptId,
                           @PathVariable UUID questionId, @Valid @RequestBody SaveAnswerRequest req) {
        return service.saveAnswer(p, attemptId, questionId, req);
    }

    @PostMapping("/attempts/{attemptId}/submit")
    public AttemptView submit(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID attemptId) {
        return service.submit(p, attemptId);
    }
}
