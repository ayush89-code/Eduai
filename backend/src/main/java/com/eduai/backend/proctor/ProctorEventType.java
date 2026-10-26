package com.eduai.backend.proctor;

/**
 * Every event the browser may report. Severity and weight are decided HERE, never by the client,
 * so a student cannot downgrade their own flags. weight 0 = informational (does not count as a flag).
 */
public enum ProctorEventType {
    PROCTOR_STARTED("LOW", 0),
    FACE_MISSING("MEDIUM", 3),
    FACE_RETURNED("LOW", 0),
    MULTIPLE_FACES("HIGH", 5),
    LOOKING_AWAY("LOW", 1),
    TAB_SWITCH("MEDIUM", 3),
    WINDOW_BLUR("LOW", 1),
    WINDOW_FOCUS("LOW", 0),
    FULLSCREEN_EXIT("MEDIUM", 2),
    COPY_PASTE("LOW", 1),
    RIGHT_CLICK("LOW", 0),
    CAMERA_DENIED("HIGH", 5),
    CAMERA_LOST("HIGH", 5);

    private final String severity;
    private final int weight;

    ProctorEventType(String severity, int weight) {
        this.severity = severity;
        this.weight = weight;
    }

    public String severity() { return severity; }
    public int weight() { return weight; }
}
