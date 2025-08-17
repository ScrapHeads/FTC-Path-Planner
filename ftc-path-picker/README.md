# FTC Field Path Picker → Pose2d

Click-to-make waypoints on an FTC field image and export them as Java `Pose2d` (radians). Includes live robot footprint visualization and tools for nudging, rotating, reordering, and saving/loading paths.

## Quick Start

1. Download the four files into the same folder:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `README.md` (this file)

2. Open `index.html` in a modern browser (Chrome/Edge/Firefox).  
   - If your browser blocks local file URLs when loading images, use a tiny static server (e.g., VS Code **Live Server**).

3. Load a field image:
   - Use **Load image** (accepts PNG/JPG/SVG/WebP/BMP/GIF), or
   - Pick a **Sample image** from the dropdown.

4. Click on existing points to select, **drag** to move, **drag handle** or **Q/E** to rotate.

5. **Press `N`** to add a new waypoint at the mouse cursor (only when an image is loaded).

6. Set robot footprint (length × width) to visualize collision space. Toggle **Align with heading** if needed.

7. Use **Export (radians)** to generate Java code for Road Runner or FTCLib `Pose2d`, then **Copy**.

## Controls

- **N**: add point at cursor (requires an image).
- **Click point**: select it.
- **Drag point**: move it.
- **Shift + drag point**: snap to **0.5″** grid.
- **Drag handle**: rotate heading.
- **Q / E**: rotate by **±5°**.
- **Shift + Q / E**: rotate by **±15°**.
- **Quick rotate buttons**: ±5° / ±15° for the selected point.
- **▲ / ▼** in the table: reorder points.
- **Delete selected**: remove the selected point.
- **Undo**: pop the last point.
- **Clear**: remove all points.

## Coordinate Conventions

- **Units**: inches.
- **Axes**: X+ forward (up on the image), Y+ left (left on the image).
- **Heading**: stored and exported in **radians**.

You can change the origin (center / top-left / bottom-left). The default maps the **field center** to `(0, 0)`.

## Robot Footprint

A rectangle is drawn around each point to approximate your robot:
- **Length**: along **X (forward)**.
- **Width**: along **Y (left)**.
- **Align with heading**: rotate footprint with the point’s heading.

The code uses the image’s **true field scale** so the footprint is inch-accurate, regardless of display size.  
The field is drawn with **12″ padding** around it so you can see when the footprint goes outside the field.  
To change the padding, edit `PAD_IN` at the top of `app.js`.

## Save / Load

- **Save JSON**: Downloads a `ftc_path.json` containing:
  - `points`: the image-space positions and headings
  - `meta`: field and UI options (field inches, origin, footprint sizes, rotate checkbox, etc.)
- **Load JSON**: Restores points and meta settings.

## Export

Choose library and container:

- `com.acmerobotics.roadrunner.geometry.Pose2d`
- `com.arcrobotics.ftclib.geometry.Pose2d`

Output:
- `List<Pose2d>` or `Pose2d[]`
- Headings exported as **radians**.

## Notes / Tips

- If remote images fail due to CORS, download the image and load it locally, or use a local dev server (VS Code **Live Server**).
- Grid dots are visual only; snapping is **0.5″** when holding **Shift** while dragging.
- New points are added only with **`N`** (to avoid accidental clicks while moving points).

## License

MIT. Use freely in your team projects.
