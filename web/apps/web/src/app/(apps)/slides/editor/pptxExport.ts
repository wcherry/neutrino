import type { SlidePresentation, TextElement, ShapeElement } from './slideEditorTypes';

export async function exportAsPptx(title: string, presentation: SlidePresentation) {
  const pptxgen = (await import('pptxgenjs')).default;
  const prs = new pptxgen();
  prs.layout = 'LAYOUT_16x9';

  for (const slide of presentation.slides) {
    const pSlide = prs.addSlide();
    if (slide.background.type === 'image') {
      pSlide.background = { path: slide.background.value };
    } else if (slide.background.type === 'color') {
      pSlide.background = { color: slide.background.value.replace('#', '') };
    } else {
      pSlide.background = { color: 'FFFFFF' }; // gradients not supported in PPTX
    }

    for (const el of slide.elements) {
      if (el.type === 'text') {
        const textEl = el as TextElement;
        pSlide.addText(textEl.content, {
          x: `${textEl.x}%`,
          y: `${textEl.y}%`,
          w: `${textEl.w}%`,
          h: `${textEl.h}%`,
          fontSize: textEl.style.fontSize * 0.75, // pt conversion
          bold: textEl.style.bold,
          italic: textEl.style.italic,
          underline: textEl.style.underline ? { style: 'sng' } : undefined,
          color: textEl.style.color.replace('#', ''),
          align: textEl.style.align,
          fontFace: textEl.style.fontFamily,
          wrap: true,
        });
      } else if (el.type === 'shape') {
        const shapeEl = el as ShapeElement;
        pSlide.addShape(prs.ShapeType.rect, {
          x: `${shapeEl.x}%`,
          y: `${shapeEl.y}%`,
          w: `${shapeEl.w}%`,
          h: `${shapeEl.h}%`,
          fill: { color: shapeEl.fill.replace('#', '') },
          line: { color: shapeEl.stroke.replace('#', ''), width: shapeEl.strokeWidth },
        });
      }
    }

    if (slide.notes) {
      pSlide.addNotes(slide.notes);
    }
  }

  await prs.writeFile({ fileName: `${title}.pptx` });
}
