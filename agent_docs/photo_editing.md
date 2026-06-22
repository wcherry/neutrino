# Drawing
## Photo Editing Mode


Active a second toolbar to show photo tools when the object is an image. When we load an image, put the image on the background layer by default.

Activated automatically when opening:

* JPG
* PNG
* WebP
* HEIC
* TIFF
* GIF (optional)

⸻

Phase 1 (MVP)

Focus on replacing basic tasks people currently use Paint, Preview, or Photos for.

File Operations

* Open image
* Save
* Save As
* Export
* Drag-and-drop support
* Clipboard paste image

Crop & Resize

* Crop
* Freeform crop
* Aspect ratio presets
    * 1:1
    * 4:3
    * 16:9
    * 9:16
* Resize image
* Maintain aspect ratio
* Canvas resize

Rotation

* Rotate left/right
* Arbitrary angle rotation
* Flip horizontal
* Flip vertical

Basic Adjustments

* Brightness
* Contrast
* Saturation
* Exposure
* Temperature
* Sharpness

Markup Tools

These are shared with the drawing app.

* Pen
* Highlighter
* Arrow
* Rectangle
* Circle
* Line
* Text boxes
* Callouts

Redaction

Very useful for business users.

* Blur area
* Pixelate area
* Black box redact

Selection Tools

* Rectangle selection
* Move selection
* Copy selection
* Delete selection

⸻

Phase 2

Filters

* Grayscale
* Sepia
* Vintage
* HDR
* Black & White

Color Tools

* Color balance
* Hue shift
* Vibrance

Background Removal

AI-assisted feature.

* Remove background
* Replace background
* Transparent PNG export

Clone Tools

* Clone stamp
* Healing brush
* Spot removal

⸻

Phase 3

Layers

This is where the drawing app integration really pays off.

* Image layers
* Drawing layers
* Text layers
* Shape layers

Users can combine:

* Photos
* Diagrams
* Annotations
* Screenshots

in a single document.

Layer Features

* Reorder
* Lock
* Hide
* Opacity

⸻

Phase 4

AI Features

Potential differentiator for Neutrino.

Generative Fill

Select area:

* Remove object
* Replace object
* Extend image

Smart Erase

Remove:

* People
* Cars
* Power lines
* Background clutter

Auto Enhance

One-click:

* Brightness
* Color correction
* Sharpness

OCR

Extract text from image.

Screenshot Intelligence

Convert screenshots into:

* Editable tables
* Documents
* Diagrams

This aligns nicely with Neutrino Docs and Sheets.

⸻

Shared Infrastructure with Draw

By combining photo editing into Draw, both features can share:

* Canvas engine
* Layers
* Shapes
* Text rendering
* Selection engine
* Undo/redo
* Clipboard
* File import/export
* Touch support
* Zoom/pan
* History stack

This can easily eliminate 60–70% of the engineering work compared to building a separate application.

Recommended Roadmap

1. Add Photo Editing Mode to Neutrino Draw.
2. Implement:
    * Crop
    * Resize
    * Rotate
    * Brightness/contrast
    * Markup tools
    * Blur/redaction
3. Add layers and image compositing.
4. Add AI background removal and object removal.
5. Only create a dedicated Neutrino Photos application later if you decide to add:
    * Photo library management
    * Albums
    * Face recognition
    * Automatic tagging
    * RAW photo workflows

Until then, keeping photo editing inside Neutrino Draw gives the best feature-to-effort ratio and keeps the Neutrino application suite simpler for users.