# FTC Path Planner

FTC Path Planner is a browser-based editor for building robot paths over an FTC field image. It supports multiple coordinate systems, physical measurement units, named Pedro segments, heading editing, Bézier control points, and Java/JSON/CSV round-trip import and export.

## Run the app

Open `index.html` in a modern browser, or serve the repository with any static web server. No build step is required.

The hosted version is available at <https://scrapheads.github.io/FTC-Path-Planner/>.

Your workspace saves automatically in this browser and restores on refresh, including all four paths, anchors and control points, the selected map (including uploaded images), field and robot settings, preview settings, exclusion box, and export fields. Keep using the same browser and site address; clearing site data removes the saved workspace. Browser storage must be enabled. Export files for a portable backup. A chosen export folder must be selected again after a refresh because browser folder permissions are not saved.

## Workspace and route graph

Choose one of the four autos in the top toolbar. **Preview** opens a floating step-through window. Drag its title to move it, or focus the title and use the arrow keys. You can keep editing the field with Preview open. Use Close or the toolbar button to dismiss it. **Collisions** shows the current check and any affected paths and zones. Open **Settings** for field images, coordinates, units, robot dimensions and zone editing. **Export** contains the Java library, package, class name, file format and output preview.

Select an anchor to reveal its heading handle and incoming Bézier controls. Use the inspector to edit its pose or lock it. For a Pedro connection, select its destination anchor to change interpolation or add a control. Select the control itself to edit its position. Use the **Branch operations** buttons in the Pedro inspector for forks, independent endings and rejoins.

The **Route graph** shows one node per named Pedro section in the active auto. Click a node to focus its section on the field, or click an arrow to select the shared junction. Field and table selections highlight the corresponding section. **All branches** compares alternatives, and warning triangles identify sections with collisions even outside the focused route. A shared continuation has one node with multiple incoming arrows. Legacy segments use their stored shared boundary. Independent endpoints at the same coordinates stay separate.

Drag the diagram background to pan or use the arrow keys inside the diagram. Scroll or use the zoom buttons to change scale. **Fit** frames the current arrangement. Drag nodes to rearrange them, or choose **Auto layout** to restore the top-to-bottom arrangement. Tab to a node or arrow and press Enter or Space to select it. Diagram positions are stored per auto in this browser workspace.

Use **Routes** on the left to browse sections and nested branches. Shared continuations appear once. The **Points** tab selects individual anchors. Drag the divider to the left of the inspector to change its width, or focus it and use Left and Right. The workspace remembers the inspector width and preview position. Open **Route graph** or **Point table** in the same left sidebar. The full table scrolls horizontally. Collapse this panel to give the route or point list more room, or drag its upper divider to resize it. With the divider focused, use the up and down arrows. The **Inspector** button toggles the inspector, which appears below the field on narrow screens.

## Field configuration

The editor supports meters, centimeters, feet, and inches. Unit changes convert the visible values without moving the field geometry, robot footprint, anchors, or control points.

Available coordinate systems are:

- FTC: X points forward/up the image and Y points left.
- Pedro: X points right, Y points up, and headings are counterclockwise from positive X.
- Image: X points right and Y points down.

Field presets apply the image, unit, field size, origin, and coordinate system together. The Pedro Pathing DECODE preset uses:

- 144 in × 144 in field
- Bottom-left origin
- Pedro coordinate system
- Inches as the display unit
- Pedro `Pose` as the selected Java library

Changing presets while paths exist asks for confirmation and preserves their locations on the field.

## Anchors and Bézier curves

Select a waypoint and press `N` over the field to insert an anchor immediately after it. The inserted anchor becomes selected, so repeated presses continue at that position in the route. A new anchor inherits the preceding anchor's heading. The first anchor starts at zero degrees. Each of the four paths has a limit of **100 anchors across all of its segments**. Shared boundary anchors count once. Placement, duplication, and imports enforce this limit.

When Pedro is selected, each connection between consecutive anchors can contain up to two control points:

- No controls: straight line / Pedro `Paths.line`
- One control: quadratic Bézier / Pedro `Paths.curve`
- Two controls: cubic Bézier / Pedro `Paths.curve`

Select the destination anchor and press **C**, or use **Add control (C)** in the inspector or **+ Control** in its table row. A second press adds the second control to that same connection. Control points appear as amber diamonds and can be selected, dragged, numerically edited, locked, deleted, mirrored, and rotated.

Control points are a Pedro-only feature. RoadRunner, FTCLib, and RilLib render and export straight waypoint segments without controls. Existing controls remain stored when switching libraries and reappear when Pedro is selected again.

## Exclusion zones and collision checking

The **Pedro Pathing Biobuzz** preset loads the two supplied obstacle rectangles the first time it is selected. These are editable defaults: drawing another rectangle adds it to the shared list, and leaving drawing mode keeps all saved zones visible. Use **Add zone**, the coordinate/name fields, individual enable switches, **Delete**, or **Reset Bio Buzz defaults** to manage the list. Coordinates and clearance are always **bottom-left Pedro inches**, regardless of the editor's displayed coordinate system or units. Disabled zones remain visible with dashed outlines. The list applies to all four loaded paths, including paths outside the current segment focus.

**Check collisions** uses the configured robot length and width, centered on its path pose, at the expected Linear, Tangent, or Constant heading. It checks full lines and Bézier curves with adaptive subdivision and conservative bounds on robot movement and rotation. Touching counts as a collision. Uncertain boundary intervals are highlighted conservatively (target corner-displacement tolerance: 0.02 inches, with a subdivision-depth limit); increase **Clearance (in)** for additional space. The footprint orientation used for collisions always follows the heading, even if the display's **Align with heading** setting is off.

Colliding anchors and affected portions of paths are red. The point table and segment dropdown also identify collisions, and the status names the affected paths and zones. Checks update when paths, headings, robot dimensions, zones, or clearance change. Warnings do not block saving or export. Zone edits, toggles, and clearance support undo/redo and browser workspace restoration. Clearing paths keeps the shared zones; use **Delete all zones** to remove them. Resetting the defaults requires confirmation and replaces the current zone list. Selecting another field does not silently discard your zones; review or reset the shared list for that field.

**Include zones in export** is independent of collision checking and defaults to **off**. When off, no zone declarations, imports, or metadata are included in Java, JSON, or CSV files. When on, Java exports include an `EXCLUSION_ZONES` array of enabled rectangles and metadata preserving the complete list, disabled entries, checking toggle, and clearance. JSON and CSV preserve this information too. Importing one of these files replaces the shared list for all loaded paths; files without zone information leave the current list untouched. Java import reads numeric constructor coordinates from the runnable array, so hand-edited coordinates take precedence over older metadata. Imports accept literal numeric constructors, not arbitrary Java expressions.

`ExclusionZone` is a **custom helper**, not a Pedro library class. Copy [ExclusionZone.java](java/org/firstinspires/ftc/teamcode/util/ExclusionZone.java) into your FTC project's `TeamCode/src/main/java/org/firstinspires/ftc/teamcode/util/ExclusionZone.java`. The app also provides a **Download custom ExclusionZone.java** link. The helper uses `com.pedropathing.math.Pose` and supplies the constructor, corner getters, `contains()`, and `inflate()` methods. The exported array provides zone data for your own robot code; the browser's collision checker runs in the planner.

## Pedro Pathing export

Use **Heading mode for all connections** to apply Linear, Tangent, or Constant to the selected segment. To override one connection, select its destination anchor and change **Heading mode** under **Incoming connection**. The segment control shows **Mixed** when its connections use different modes. The first anchor of a disconnected route has no incoming connection.

Linear exports `.linear(start, end)`, Tangent exports `.tangent()`, and Constant exports `.constant(end)` using the destination anchor's heading, including for curves. Linear remains the default for existing paths. These modes follow [Pedro's interpolation API](https://pedropathing.com/docs/pathing/reference/interpolation) and persist through workspace saves, undo/redo, and Pedro Java/JSON/CSV export and import. Java imports read the executable interpolation calls, including files without planner comments.

**Make selected point a segment** inserts a new segment at the selected anchor's current position. Point order, geometry, headings, locks, control points, and shared endpoint connections stay unchanged. If the anchor is inside a segment, the list becomes the original segment, the new segment, and an original-name **(continued)** segment for the remaining points. At the beginning or end of a segment, the new label is inserted directly before or after it. The new segment becomes active so you can continue adding points with `N`. This also supports undo/redo and workspace saving.

Choose **Pedro Pathing (PoseFactory)** as the Java library. **Path 1 through Path 4 remain four independent autonomous programs**, using the same toolbar selector as RoadRunner. You can load a different auto into each slot, for example Red 1, Red 2, Blue 1, and Blue 2. Each path exports as one Java class; imports replace only the selected slot. Its Java class name is remembered when switching paths.

**Named segments belong inside the selected path.** Use the segment list to select a segment and edit its label. Labels become Java method names, for example `Collect samples` becomes `collectSamples()`. Reserved words, punctuation, leading numbers, and duplicate labels are handled automatically; the editor shows the generated method name. Adding a segment never adds or replaces a path slot.

**All segments** is always the first dropdown option and shows the whole path. Selecting a specific segment dims other anchors, connections, control points, and other autos using the preview styling; shared boundary anchors stay bright. The table also dims points outside that segment. Point preview continues to apply alongside segment focus. Selecting **All segments** removes segment dimming without resetting preview. New points added in this overview append to the last real segment; select an individual segment to rename it or add points within it.

When waypoints or visible Bézier controls overlap, click the same spot repeatedly to cycle through them. Drag to move the currently selected point. A shared fork or rejoin anchor counts as one waypoint. The first press on an anchor or a visible control selects it. Press and drag the selected entity to move it, or drag the selected anchor's heading handle to rotate it. Field and table selection both select the point's segment and update the map highlight and row dimming. A shared boundary anchor keeps the current segment if it belongs to that segment; from **All segments**, it selects the segment owning its incoming connection. Selecting a control point selects the segment owning its curve. Locked points still select their segment but remain locked. **Select** buttons in the point table stay active and fully visible in dimmed rows, so you can select a point from another segment directly.

Use **Move segment up/down** to change segment order in the table and export. The auto's starting pose stays fixed, and each segment starts at its new predecessor's endpoint so the route stays connected. Destination anchors, headings, locks, and incoming control points move with their segment; its shape changes to meet the new start. Reordering also reconnects previously disconnected segments. To transfer an anchor, select it on the field or with **Select** in the table, choose **Move selected point to segment**, and click **Move selected point**. It appends to that segment with its heading, locks, and control points. A shared endpoint already starting the destination transfers in place. Neighboring segments update their shared starts to the new preceding endpoints, including when the destination is a newly created segment. Both operations support undo/redo and save with the workspace.

Segments can contain multiple lines and curves. Select an anchor and choose **Start segment at selected point**. At an interior anchor, the following points in that segment move into the new segment. At an open endpoint, the new segment starts with just the shared anchor. Press **N** to add its next point. The new segment receives a contrasting color, editable in the inspector. Moving the shared anchor updates both segments. The point table highlights the selected segment’s anchors. **Remove segment label** merges a connected section into its neighbor while keeping its points. Labels and membership support undo/redo. Disconnected routes retain separate labels.

Export generates **one Java file with every segment of the selected path in one class**. Other path slots are excluded. Each segment has its own `PoseFactory.degrees()`, pose fields, and a public method returning its complete `Path`. Each call builds a fresh path, using `Paths.path(...)` to combine its lines and curves in anchor order with linear heading interpolation. Empty segments retain their labels for reimport. A one-anchor segment exports its pose field; it needs a second anchor before a path method is generated.

This output targets the Pedro API documented in [PoseFactory](https://pedropathing.com/docs/pathing/reference/posefactory) and [Path creation](https://pedropathing.com/docs/pathing/reference/api), with `com.pedropathing.api.PoseFactory`, `com.pedropathing.api.Paths`, `com.pedropathing.math.Pose`, and `com.pedropathing.paths.Path`.

Pedro Java output always uses bottom-left Pedro coordinates in inches, even when the editor is displaying another unit or coordinate system.

Selecting an export folder immediately updates the Java package to `org.firstinspires.ftc.teamcode` plus the folder path beneath `teamcode`. For example, `teamcode/auto/paths` produces `package org.firstinspires.ftc.teamcode.auto.paths;`. Standard browsers expose only the selected folder name; for a nested folder, enter its relative path such as `auto/paths` in the editable field and the package updates immediately.

Example:

```java
public final class AutoPaths {
    private final PoseFactory collectSamplesPoses = PoseFactory.degrees();
    public final Pose collectSamplesPoint1 = collectSamplesPoses.of(12, 24, 90);
    public final Pose collectSamplesPoint2 = collectSamplesPoses.of(30, 40, 0);
    public final Pose collectSamplesPoint3 = collectSamplesPoses.of(48, 60, 180);

    public Path collectSamples() {
        return Paths.path(
            Paths.line(collectSamplesPoint1, collectSamplesPoint2)
                .linear(collectSamplesPoint1, collectSamplesPoint2),
            Paths.line(collectSamplesPoint2, collectSamplesPoint3)
                .linear(collectSamplesPoint2, collectSamplesPoint3)
        );
    }

    // Other named segments and their methods are generated here in the same class.
}
```

Use `AutoPaths paths = new AutoPaths();` and call `paths.collectSamples()` to retrieve that entire segment. Factory mirroring can be configured on the factory declaration before its poses are initialized, for example `PoseFactory.degrees().mirrorX(72)` for a 144-inch field.

Pedro Java imports read executable `factory.of(...)` expressions and `Paths.line/curve(...)` references, so coordinate edits made outside the planner are used on reimport. Comments preserve labels, colors, and locks without duplicating coordinates. Factory degree/radian inputs and literal `mirrorX`/`mirrorY` transformations are supported. Imports support the generated Java syntax rather than arbitrary Java expressions or runtime logic. Older Pedro pose lists, arrays, and `PathChain` files can still be imported.

When every setting matches a built-in default, the metadata block is shortened to one line such as `// config=pedro-segments`, `// config=roadrunner`, or `// config=roadrunner-decode`. Customized settings continue to export the complete metadata block so they can be restored exactly.

## Other exports and imports

The existing four path buttons remain available for every library. RoadRunner, FTCLib, and RilLib pose lists and arrays use schema version 2 for JSON and CSV. Pedro segment exports use schema version 3 and include the selected path's class name and its segments' labels, colors, order, and geometry. Both versions preserve:

- Field preset and physical dimensions
- Display unit, origin, and coordinate system
- Robot dimensions
- Heading wrap mode
- Anchors, headings, and locks
- Segment control points when the Pedro library is selected

The importer accepts every generated JSON, CSV, Java snippet, and Java class format. Legacy JSON, CSV, and `Pose2d` files without Bézier controls remain supported.

## Editing controls

- `N`: Add anchor
- Drag anchor: Move anchor
- Drag amber diamond: Move control point
- Drag heading handle: Rotate anchor
- `Q` / `E`: Rotate selected anchor
- `Shift`: Snap movement to a physical half-inch or rotation to 15 degrees
- `Delete`: Delete selected anchor or control
- `Ctrl+Z` / `Ctrl+Y`: Undo / redo
- `P`: Toggle step-through preview
- `[` / `]`: Step preview backward or forward

The preview is waypoint-based only. The project intentionally does not implement timed trajectory playback.

## Tests

Run the unit, coordinate, Bézier, and round-trip import/export tests with:

```powershell
npm.cmd test
```

## Source layout

```text
index.html              Main interface
styles.css              Application styles
js/app.js               Application bootstrap
js/coordinates.js       Pure coordinate transforms
js/field_config.js      Presets and physical field configuration
js/units.js             Unit conversion
js/path_model.js        Anchors, controls, and Bézier evaluation
js/segment_model.js     Named segments, method names, and splitting
js/pedro_java.js        PoseFactory Java generation and parsing
js/java_package.js      Folder-path to Java-package conversion
js/layout.js            Canvas/image coordinate bridge
js/draw.js              Canvas rendering
js/interactions.js      Mouse and keyboard editing
js/ui.js                Controls and waypoint table
js/io_image.js          Image and preset loading
js/io_export.js         JSON, CSV, and Java generation
js/io_import.js         JSON, CSV, and Java parsing
test/                   Automated tests
```

## Branching HIVE routes

**Branch from anchor** guides placement above the field. At an endpoint, click once for the **Main** continuation and again for the **Branch**. At an interior anchor, the existing continuation supplies the Main point, so click only for the Branch. The new branch point is selected when placement finishes. **Cancel** or **Esc** discards an unfinished fork. One **Undo** removes a completed fork.

Each path slot holds one auto. In Pedro mode, draw an approach, a normal garden pickup, a score point, and a return. Select the last approach waypoint and choose **Branch from anchor**. Click the field to place the first branch point. The planner splits the original section at the fork. Rename the shared section **Approach** and its original continuation **Garden normal**.

1. Name the new alternative **Garden tipped**. Hover over the field and press **N** to add its pickup waypoints.
2. Keep the returning branch selected in **Routes**. In **Branch operations**, select the original route’s score anchor in **Rejoin at anchor** and choose **Rejoin here**. Rename the shared downstream section **Return to score**. Completing the rejoin or selecting the junction focuses the Main continuation. Hover over the field and press **N** to insert immediately after the junction. At a shared final anchor, **N** starts a continuation for both arrivals. Moving or rotating the junction updates both arrivals and the return.
3. Select a waypoint on Garden tipped and branch again. Name the alternative **Tipped alternate pickup**. It can rejoin the score anchor too.
4. For an independent ending, fork from a pickup waypoint, name the section **Alternate park**, add its parking waypoint and choose **Finish independently**. **Extend ending** opens it for more waypoints.

Use the section selector to edit a branch and the route selectors to choose the approach and continuation at nested forks. **All branches** compares the alternatives. Collision checks cover every authored section. A collision badge identifies a section even when its route is faded.

To add points after a fork, select the section in **Routes**, hover over the field and press **N**. To insert inside a Pedro section, choose an anchor under **Insert next point after**, or select that anchor using **Points** or the field, hover at the new position, and press **N**. Repeated presses continue from the newly inserted anchor. With only the section selected, open sections append at the end. A section that ends at a shared junction inserts the new point immediately before that junction. For a finished independent ending, choose **Extend ending** first.

**Insert midpoint** splits the incoming line or Bézier at its midpoint. Internal waypoints can be reordered within their section. Section order only changes the navigator and export order after branching. Mirroring transforms the whole auto. Delete a branch to remove its exclusive geometry. A shared continuation survives as long as another branch reaches it.

Java exports one zero-argument Pedro `Path` method per complete section and one pose declaration per anchor. For example, robot code can call `approach()`, `gardenNormal()`, and `returnToScore()`, or choose the tipped route and finish with `alternatePark()`. The planner exports the geometry. The robot program chooses which methods to follow. Keep the planner metadata for editable Java, JSON and CSV round trips.
