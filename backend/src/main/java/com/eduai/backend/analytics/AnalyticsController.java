package com.eduai.backend.analytics;

import com.eduai.backend.analytics.AnalyticsDtos.ExamAnalytics;
import com.eduai.backend.analytics.AnalyticsDtos.StudentProgress;
import com.eduai.backend.auth.AuthenticatedUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
public class AnalyticsController {

    private final ExamAnalyticsService exams;
    private final StudentProgressService progress;

    public AnalyticsController(ExamAnalyticsService exams, StudentProgressService progress) {
        this.exams = exams;
        this.progress = progress;
    }

    /** TEACHER or ADMIN (SecurityConfig); a teacher only sees their own exams. */
    @GetMapping("/api/teacher/exams/{examId}/analytics")
    public ExamAnalytics examAnalytics(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID examId) {
        return exams.analytics(p, examId);
    }

    /** STUDENT only (SecurityConfig); always the caller's own data. */
    @GetMapping("/api/student/progress")
    public StudentProgress myProgress(@AuthenticationPrincipal AuthenticatedUser p) {
        return progress.progress(p.id());
    }
}
