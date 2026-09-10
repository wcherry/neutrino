## 1. Define the internal document model

Use a document tree independent of the file format:

```text
Document
├── Canvas
├── RootStack
│   ├── Stack
│   │   ├── RasterLayer
│   │   ├── VectorLayer
│   │   ├── TextLayer
│   │   ├── Mask
│   │   └── Adjustment/FilterLayer
├── Guides
├── GridSettings
├── ColorProfile
└── Metadata
```

Every object should have:

- Stable UUID
- Name
- Parent ID
- Visibility
- Opacity
- Blend mode
- Lock state
- Transform
- Bounds
- Creation/edit metadata

## 2. Implement the portable OpenRaster baseline

### Raster layers

Store each raster layer as a separate RGBA PNG:

```xml
<layer
  name="Ink"
  src="data/layer-123.png"
  x="0"
  y="0"
  opacity="1"
  visibility="visible"
  composite-op="svg:src-over"/>
```

Support:

- Transparency
- 8-bit and 16-bit channels
- Layer offsets
- Layer ordering
- Separate thumbnails

### Nested layer groups

Represent groups as nested `<stack>` elements. The first child is the topmost layer, as required by OpenRaster.

### Layer state

Use standard attributes where available:

- `name`
- `opacity`
- `visibility`
- `composite-op`
- `isolation`

Use the OpenRaster edit-lock extension for locked layers. [Layer locking extension](https://www.openraster.org/extensions/layer-edit-locking-status.html)

### Blend modes

Map Neutrino’s modes to OpenRaster’s `composite-op` values:

- Normal
- Multiply
- Screen
- Overlay
- Darken
- Lighten
- Color Dodge
- Color Burn
- Hard Light
- Soft Light
- Difference
- Hue
- Saturation
- Color
- Luminosity

Use the OpenRaster alpha-preserve extension for clipping or alpha-inheritance behavior where appropriate. [Blend modes and alpha preservation](https://www.openraster.org/baseline/layer-stack-spec.html) [Alpha-preserve extension](https://www.openraster.org/proposals/layer-alpha-preserve.html)

## 3. Add editing features

### Brushes, pens, pencils, and highlighters

Brushes are editing tools, not document content. Store:

- Brush type
- Size
- Opacity
- Pressure settings
- Smoothing
- Color
- Blend mode
- Optional brush preset reference

The rendered stroke should become raster pixels in the layer. Store stroke history only as an optional Neutrino extension.

### Masks

OpenRaster does not provide a complete baseline mask model.

Implement masks as:

- Separate grayscale PNG assets
- A relationship entry in a Neutrino extension manifest
- A baked alpha result for compatibility

Example:

```json
{
  "maskFor": "layer-123",
  "maskSource": "data/mask-456.png",
  "mode": "transparency"
}
```

Support:

- Layer masks
- Clipping masks
- Transparency masks
- Group masks

### Selections, alpha channels, and paths

Store:

- Active selections as grayscale PNG masks
- Alpha as the PNG alpha channel
- Editable paths as SVG path data
- Selection state using the OpenRaster selection extension where possible

[OpenRaster selection extension](https://www.openraster.org/extensions/layer-selection-status.html)

## 4. Add vector and non-destructive content

### Vector shapes and text

Store vector content as SVG layer files. SVG supports groups, paths, text, transforms, clipping, masks, filters, and compositing. [W3C SVG](https://www.w3.org/TR/SVG/)

Preserve:

- Shape geometry
- Stroke and fill
- Text content
- Font family and size
- Text alignment
- Object IDs
- Group hierarchy
- SVG transforms

For text, embed fonts when licensing permits; otherwise store font metadata and provide a fallback font.

### Text on a path

A text layer can be laid out along a path instead of along a box. Store it as a
reference to a path object that already exists in the document, not as geometry
of its own:

- Path object ID — the same IDs preserved above
- Start offset along the path
- Alignment along the path (start, middle, end)
- Baseline offset from the path
- Side (above or below the path)

The path is an ordinary path object and stays independently editable, visible or
hidden on its own terms; moving or reshaping it re-flows the text. This is what
SVG's `<textPath href="#id">` expresses directly, so the vector layer file needs
no extension for it. [SVG text on a path](https://www.w3.org/TR/SVG2/text.html#TextPathElement)

Two things to get right. A renderer that cannot resolve the reference must still
show the text rather than nothing, so write the path data inline as a fallback
where the target path is hidden. And the rasterised copy in the `.ora` carries
the laid-out result like any other text, so nothing is lost for a reader that
ignores the vector source.

An earlier version of the app had a bespoke version of this — a text shape with
one or two hand-placed cubics and a mode that stretched glyphs between them. It
is not the thing to reinstate: the geometry was private to text, unreachable by
any other tool, and had no SVG equivalent to export to.

### Transforms and reusable objects

For SVG objects, retain transforms directly in SVG.

For raster layers:

- Bake the transformed pixels into the PNG for compatibility
- Preserve the original asset and transform matrix in Neutrino metadata
- Reconstruct the editable version when reopened by Neutrino

Reusable objects should be stored once and referenced by UUID. The export should include a rendered fallback wherever possible.

### Adjustment layers

OpenRaster does not have a reliable baseline adjustment-layer format.

Store each adjustment layer as:

1. A Neutrino extension describing the adjustment parameters
2. A rendered fallback PNG or merged result
3. The original source layers unchanged

Example adjustments:

- Brightness/contrast
- Levels
- Curves
- Hue/saturation
- Color balance
- Exposure
- Grayscale
- Posterize

### Filters and effects

Do not depend on the current OpenRaster filter proposal as the primary interchange mechanism; it is still described as a proposal. [OpenRaster filter proposal](https://www.openraster.org/proposals/filter-effects.html)

Instead, store:

- Filter type
- Parameters
- Target object/layer
- Mask
- Ordering
- Rendered fallback

Neutrino should reopen the filter nondestructively. Other applications should still see the rendered result.

## 5. Handle color, assets, and workspace state

### Color profiles, high bit depth, and HDR

Support:

- sRGB baseline
- Embedded ICC profiles
- 8-bit and 16-bit PNG layers
- Wide-gamut profiles
- HDR as a Neutrino extension

For unsupported HDR readers, include an SDR preview and merged image. OpenRaster’s required merged image is PNG-based, so floating-point HDR should not be assumed to round-trip universally. [OpenRaster PNG requirements](https://www.openraster.org/proposals/png-data-requirements.html)

### Imported, linked, and embedded assets

Embed imported assets inside the `.ora` archive whenever possible.

For linked assets, store:

- Original URI or path
- Asset UUID
- Content hash
- Last-known dimensions
- Embedded fallback copy

This ensures the file remains viewable even when the external asset is unavailable.

### Guides, grids, snapping, and rulers

These are editor workspace features rather than image content. Store them in a Neutrino metadata file such as:

```text
META-INF/neutrino/document.json
```

Include:

- Guide positions
- Grid spacing
- Grid origin
- Snapping rules
- Ruler units
- Canvas rotation
- Viewport state
- Active tool
- Selected objects

Unknown applications can ignore this file without affecting the rendered image.

## 6. Metadata, thumbnails, and previews

Required OpenRaster files:

```text
mimetype
stack.xml
mergedimage.png
Thumbnails/thumbnail.png
data/*
```

Add:

- Document title
- Author
- Creation and modification dates
- Description
- Canvas dimensions
- Color profile
- Application name/version
- Feature compatibility flags
- Optional XMP metadata

OpenRaster requires both a thumbnail and merged image for broad viewer compatibility. [OpenRaster file layout](https://www.openraster.org/baseline/file-layout-spec.html)

## 7. Compatibility tiers

Define three save modes:

### Portable

Only use OpenRaster baseline features:

- Raster layers
- Groups
- Opacity
- Visibility
- Basic blend modes
- PNG/SVG layers
- Thumbnail
- Merged image

### Extended

Include standard OpenRaster extensions:

- Locked layers
- Selected layers
- Alpha preservation
- XMP metadata

### Neutrino

Include all advanced features:

- Masks
- Adjustments
- Filters
- HDR
- Linked assets
- Guides
- Brush metadata
- Editable transformations
- Workspace state
- Undo/history data

Every Neutrino-specific feature should also have a rendered fallback.

## 8. Implementation phases

1. **Document model** — *done*
   - Build the layer tree and object IDs.
   - Implement raster, group, vector, text, and mask objects.

   Landed as `web/apps/web/src/app/(apps)/drawing/editor/document/`. The whole
   editor moved onto the tree rather than the tree landing beside it: the flat
   `Shape[]`/`Layer[]` model and its stored body are gone, with no migration —
   `parseDocument` refuses anything that is not version 2 rather than guessing
   at it.

   Two decisions worth recording because the rest of the plan rests on them.
   **The canvas is fixed-size** (§2 needs `<image w= h=>`, and a guide, a grid
   origin and a layer offset all need something to be relative to), so a drawing
   is a page rather than the unbounded plane the first version drew on. And
   **raster layers and masks are modelled, rendered and serialised, but nothing
   paints into them yet** — an image can be imported as a raster layer, while
   the brush engine stays where it belongs, in phase 4.

2. **OpenRaster writer** — *done*
   - Generate valid ZIP packages.
   - Write `stack.xml`, PNG/SVG layer assets, thumbnail, and merged image.

   Landed as `drawing/editor/io/ora/`, reached from the export dialog. Layer
   assets are **PNG only**: OpenRaster's baseline `src` is a raster asset and no
   reader outside Neutrino reads an SVG one, so a vector or text layer is
   rasterised for the fallback and its editable original travels in
   `META-INF/neutrino/document.json` — which carries the whole document, not a
   diff, so the round trip through this app is lossless.

   It exports rather than saves, and `image/openraster` is deliberately not a
   native type. Until phase 3 reads one back, a stored `.ora` would be a file
   this app writes and cannot open.

3. **OpenRaster reader**
   - Load baseline files from Krita, GIMP, and other OpenRaster applications.
   - Gracefully ignore unknown extensions.

4. **Core editing**
   - Brushes, masks, selections, transformations, blend modes, and layer locking.

5. **Vector and text**
   - SVG import/export.
   - Editable shapes, text, paths, and reusable objects.
   - Text on a path, stored as SVG `<textPath>`.

6. **Advanced non-destructive features**
   - Adjustment layers.
   - Filters and effects.
   - Rendered fallback generation.

7. **Color and asset management**
   - ICC profiles.
   - 16-bit support.
   - HDR extension.
   - Embedded and linked assets.

8. **Workspace metadata**
   - Guides, grids, snapping, rulers, active selection, and viewport state.

9. **Compatibility testing**
   - Open Neutrino files in Krita and GIMP.
   - Open their `.ora` files in Neutrino.
   - Verify that unsupported features remain visually correct through `mergedimage.png`.

The central rule should be: **every advanced editable feature gets both a Neutrino description and a compatible rendered fallback**. That keeps the format useful outside Neutrino without forcing the portable OpenRaster baseline to represent features it was never designed to encode.