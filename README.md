# FTC Path Planner – Modular Version

This tool provides a browser-based interface for creating and managing robot paths on an FTC field image. It supports interactive editing, heading control, metadata, and exporting paths in multiple formats (JSON, CSV, Java).

---

## GitHub Site
This project is also hosted on GitHub Pages at the following link:  
https://scrapheads.github.io/FTC-Path-Planner/

## Features

### Core

* Upload a **field image** (any PNG/JPG).
* Define waypoints by clicking on the field.
* Move, rotate, delete, and **lock** waypoints.
* Undo/redo with history tracking.
* Waypoint table for numeric editing.
* Live preview of path and robot footprint.

### Heading

* Each waypoint has a heading in **radians** internally.
* Toggle **heading wrap mode**:

  * **0 → 360°** (full circle)
  * **−180 → +180°** (half loop)
* Toggle affects:

  * On-screen display
  * Exported degrees values
  * Stored radians (adjusted consistently)

### Measurement Tools

* Measure distances on the field image.
* Snap to whole-inch increments by default.
* Hold **Shift** to snap to half-inch increments.

### Robot & Field Settings

* Field size in inches (`fieldInches`, default 144).
* Robot dimensions (`robotLenIn`, `robotWidIn`, default 18×18).
* Robot footprint is shown at the current waypoint heading.

### Waypoint Locking

* Each waypoint can be **locked**.
* Locked points are exported with `locked=true` metadata.
* Locked state is preserved on import.

---

## Export Formats

### JSON

* Richest format; preserves all metadata.
* Structure:

  ```json
  {
    "meta": {
      "library": "rr",             // or "ftclib"
      "format": "list",            // or "array"
      "headingWrapHalf": true,
      "fieldInches": 144,
      "robotLenIn": 18,
      "robotWidIn": 18
    },
    "poses": [
      {
        "x": 24.0,
        "y": 36.0,
        "headingRad": 1.5708,
        "locked": false
      }
    ]
  }
  ```

### CSV

* Human-readable, spreadsheet-friendly.
* Comment headers preserve metadata.
* Columns: `index, x_in, y_in, heading_rad, heading_deg, locked`
* Example:

  ```
  # headingWrapHalf=true
  # fieldInches=144
  # robotLenIn=18
  # robotWidIn=18
  index,x_in,y_in,heading_rad,heading_deg,locked
  1,24.00,36.00,1.570796,90.0,false
  ```

### Java

* Ready to paste into FTC code.
* Supports both **RoadRunner** and **FTCLib** `Pose2d`.
* Export as `List<Pose2d>` or array.
* Options:

  * Java snippet
  * Full Java class (with package + class name)
* Includes header comments for metadata, e.g.:

  ```java
  // headingWrapHalf=true
  // fieldInches=144
  // robotLenIn=18
  // robotWidIn=18
  import com.acmerobotics.roadrunner.geometry.Pose2d;

  public final class AutoPath {
      private AutoPath() {}

      public static final Pose2d[] PATH = new Pose2d[]{
          new Pose2d(24.00, 36.00, 1.570796)  // #1  x=24.00in, y=36.00in, θ=90.0°
      };
  }
  ```

---

## Import Formats

* **JSON**: Fully restores metadata and waypoints.
* **CSV**: Reads comment headers for metadata; restores locked flags.
* **Java/TXT**: Reads header comments for metadata and inline `locked=true` annotations.

---

## UI Setup

1. Open `index.html` in a modern browser (Chrome recommended).
2. Load a field image.
3. Configure:

   * Field size (inches)
   * Robot size (length, width)
   * Heading wrap mode (checkbox)
4. Add/edit waypoints.
5. Export using the dropdown and preview/copy/save options.

---

## File Organization

```
/ (root)
│── index.html        # Main HTML interface
│── styles.css        # UI styling
│── README.md         # Documentation
│
└── js/
    ├── app.js        # Entry point, initializes modules
    ├── state.js      # Global state and history
    ├── els.js        # DOM element references
    ├── layout.js     # Field scaling and coordinate transforms
    ├── draw.js       # Canvas rendering
    ├── interactions.js # Mouse/keyboard interaction
    ├── ui.js         # Controls, table sync
    ├── io_image.js   # Field image loading
    ├── io_import.js  # Import from JSON/CSV/Java
    ├── io_export.js  # Export to JSON/CSV/Java
    └── utils.js      # Math and helpers
```

---

## Requirements

* Browser supporting:

  * `ES modules`
  * `showSaveFilePicker` (for file saving) or fallback download
  * `showDirectoryPicker` (optional, Chrome/Edge)
* No server required. Just open `index.html`.

---

## Roadmap

* Path smoothing and interpolation tools
* Support for additional export formats (e.g. pure CSV for telemetry)
* Extended project save/load beyond waypoints