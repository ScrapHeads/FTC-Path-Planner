# FTC Path Planner 

This tool provides a browser-based interface for creating and managing robot paths on an FTC field image. It supports interactive editing, heading control, metadata, and exporting paths in multiple formats (JSON, CSV, Java). The app now supports multiple measurement units, robust import/export with metadata, improved preset field image handling, and multiple path support (up to 4 paths, each with its own color and preview).

---

## GitHub Site
This project is also hosted on GitHub Pages at:  
https://scrapheads.github.io/FTC-Path-Planner/

## Features

### Core

* Upload a field image (PNG/JPG) or select a preset field.
* Define waypoints by clicking on the field.
* Move, rotate, delete, and lock waypoints.
* Undo/redo with history tracking.
* Waypoint table for numeric editing, including lock toggles with custom checkboxes.
* Live preview of path and robot footprint.
* Create and edit up to 4 separate paths, each with its own color and preview.
* Switch between paths using dedicated buttons; the active path button is highlighted.
* Each path has its own preview state and can be exported or imported independently.

### Heading

* Each waypoint has a heading in **radians** internally.
* Toggle heading wrap mode:
  * **0 → 360°** (full circle)
  * **−180 → +180°** (half loop)
* Toggle affects:
  * On-screen display
  * Exported degrees values
  * Stored radians (adjusted consistently)

### Measurement Units

* Supports **meters**, **inches**, and **centimeters** for all field and robot dimensions.
* All calculations are standardized internally to **meters**.
* Measurement unit is stored in exports and restored on import.
* UI updates automatically when unit changes or is imported.

### Robot & Field Settings

* Field size and robot dimensions can be set in the selected measurement unit.
* Robot footprint is shown at the current waypoint heading.

### Waypoint Locking

* Each waypoint can be locked.
* Locked points are exported with `locked=true` metadata.
* Locked state is preserved on import.

### Multi-Path Support

* Up to 4 separate paths can be created, edited, and visualized.
* Each path is assigned a unique color for easy distinction.
* Switch between paths using the UI; only the active path is editable at a time.
* All paths are drawn on the field for visual comparison.
* Each path maintains its own preview state and waypoints.
* Import/export supports single or multiple paths (see below).

---

## Export Formats

### JSON

* Preserves all metadata, including measurement unit and preset field.
* Structure:
  ```json
  {
    "meta": {
      "library": "rr",             // or "ftclib"
      "format": "list",            // or "array"
      "headingWrapHalf": true,
      "fieldSize": 3.66,
      "robotLen": 0.4572,
      "robotWid": 0.4572,
      "measurementUnit": "m",
      "presetField": "example.png"
    },
    "poses": [
      {
        "x": 0.61,
        "y": 0.91,
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
  # headingWrapHalf=false
  # fieldSize=3.66
  # robotLen=0.4572
  # robotWid=0.4572
  # measurementUnit=m
  # presetField=ReferenceImages\decode.webp
  index,x,y,heading_rad,heading_deg,locked
  1,1.015,0.760,0.000000,0.000,false
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
  package org.firstinspires.ftc.teamcode.auto.paths;

  // headingWrapHalf=false
  // fieldSize=3.66
  // robotLen=0.4572
  // robotWid=0.4572
  // measurementUnit=m
  import java.util.*;
  import com.acmerobotics.roadrunner.geometry.Pose2d;

  public final class AutoPath {
      private AutoPath() {
      }

      public static final List<Pose2d> PATH = Arrays.asList(
              new Pose2d(1.015, 0.760, 0.000000), // #1 x=1.015m, y=0.760m, θ=0.0°
              new Pose2d(0.820, -0.917, 0.000000), // #2 x=0.820m, y=-0.917m, θ=0.0°
              new Pose2d(-0.824, 0.403, 0.000000), // #3 x=-0.824m, y=0.403m, θ=0.0°
              new Pose2d(-0.686, -1.030, 0.000000) // #4 x=-0.686m, y=-1.030m, θ=0.0°
      );
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