package org.firstinspires.ftc.teamcode.util;

import com.pedropathing.math.Pose;

/** Custom axis-aligned field exclusion rectangle, in Pedro inches. */
public final class ExclusionZone {
    private final double minX;
    private final double minY;
    private final double maxX;
    private final double maxY;

    public ExclusionZone(double x1, double y1, double x2, double y2) {
        this.minX = Math.min(x1, x2);
        this.minY = Math.min(y1, y2);
        this.maxX = Math.max(x1, x2);
        this.maxY = Math.max(y1, y2);
    }

    public Pose bottomLeft() { return new Pose(minX, minY, 0); }
    public Pose bottomRight() { return new Pose(maxX, minY, 0); }
    public Pose topRight() { return new Pose(maxX, maxY, 0); }
    public Pose topLeft() { return new Pose(minX, maxY, 0); }

    public Pose[] getCorners() {
        return new Pose[] { bottomLeft(), bottomRight(), topRight(), topLeft() };
    }

    public boolean contains(double x, double y) {
        return x >= minX && x <= maxX && y >= minY && y <= maxY;
    }

    public ExclusionZone inflate(double margin) {
        return new ExclusionZone(minX - margin, minY - margin, maxX + margin, maxY + margin);
    }
}
