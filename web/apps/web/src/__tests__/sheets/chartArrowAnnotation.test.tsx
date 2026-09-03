/**
 * Chart arrow annotations (issue #30).
 *
 * An arrow's head is stored as an absolute point (x2/y2), not as an offset from
 * its tail, so it needs its own drag handle — and a drag of the body has to move
 * both ends or the head stays pinned while the tail walks away.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ChartAnnotationLayer } from '../../app/(apps)/sheets/editor/charts/ChartAnnotationLayer';
import type { ChartAnnotation } from '../../app/(apps)/sheets/editor/charts/chartTypes';

const FRAME_W = 400;
const FRAME_H = 200;

const arrow: ChartAnnotation = {
    id: 'a1',
    type: 'arrow',
    x: 0.1,
    y: 0.1,
    w: 0.2,
    h: 0.1,
    x2: 0.3,
    y2: 0.2,
    strokeColor: '#2563eb',
    strokeWidth: 1.5,
};

function renderArrow(ann: ChartAnnotation = arrow) {
    const onUpdate = vi.fn();
    const utils = render(
        <ChartAnnotationLayer
            annotations={[ann]}
            frameW={FRAME_W}
            frameH={FRAME_H}
            isChartSelected
            onUpdate={onUpdate}
            onDelete={vi.fn()}
        />,
    );
    return { ...utils, onUpdate };
}

/** Press the arrow body once so the endpoint handles are rendered. */
function selectArrow(container: HTMLElement) {
    const line = container.querySelector('line');
    expect(line).toBeTruthy();
    fireEvent.mouseDown(line!, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseUp(window);
}

beforeEach(() => cleanup());

describe('arrow annotation dragging', () => {
    it('renders a handle at each end once the arrow is selected', () => {
        const { container } = renderArrow();
        expect(container.querySelector('[data-handle="head"]')).toBeNull();

        selectArrow(container);

        const tail = container.querySelector('[data-handle="tail"]');
        const head = container.querySelector('[data-handle="head"]');
        expect(tail).toBeTruthy();
        expect(head).toBeTruthy();
        expect(head!.getAttribute('cx')).toBe(String(Math.round(0.3 * FRAME_W)));
        expect(head!.getAttribute('cy')).toBe(String(Math.round(0.2 * FRAME_H)));
    });

    it('moves only the head when the head handle is dragged', () => {
        const { container, onUpdate } = renderArrow();
        selectArrow(container);

        const head = container.querySelector('[data-handle="head"]')!;
        fireEvent.mouseDown(head, { button: 0, clientX: 100, clientY: 50 });
        fireEvent.mouseMove(window, { clientX: 140, clientY: 70 });

        expect(onUpdate).toHaveBeenLastCalledWith('a1', {
            x2: 0.3 + 40 / FRAME_W,
            y2: 0.2 + 20 / FRAME_H,
        });
        fireEvent.mouseUp(window);
    });

    it('moves only the tail when the tail handle is dragged', () => {
        const { container, onUpdate } = renderArrow();
        selectArrow(container);

        const tail = container.querySelector('[data-handle="tail"]')!;
        fireEvent.mouseDown(tail, { button: 0, clientX: 0, clientY: 0 });
        fireEvent.mouseMove(window, { clientX: 20, clientY: 10 });

        expect(onUpdate).toHaveBeenLastCalledWith('a1', {
            x: 0.1 + 20 / FRAME_W,
            y: 0.1 + 10 / FRAME_H,
        });
        fireEvent.mouseUp(window);
    });

    it('moves both ends by the same delta when the body is dragged', () => {
        const { container, onUpdate } = renderArrow();
        const line = container.querySelector('line')!;

        fireEvent.mouseDown(line, { button: 0, clientX: 0, clientY: 0 });
        fireEvent.mouseMove(window, { clientX: 40, clientY: 20 });

        expect(onUpdate).toHaveBeenLastCalledWith('a1', {
            x: 0.1 + 40 / FRAME_W,
            y: 0.1 + 20 / FRAME_H,
            x2: 0.3 + 40 / FRAME_W,
            y2: 0.2 + 20 / FRAME_H,
        });
        fireEvent.mouseUp(window);
    });

    it('keeps the arrow its own length when a body drag hits the frame edge', () => {
        const { container, onUpdate } = renderArrow();
        const line = container.querySelector('line')!;

        fireEvent.mouseDown(line, { button: 0, clientX: 0, clientY: 0 });
        fireEvent.mouseMove(window, { clientX: 10_000, clientY: 10_000 });

        const patch = onUpdate.mock.calls.at(-1)![1] as ChartAnnotation;
        expect(patch.x2).toBeCloseTo(0.98, 6);
        expect(patch.y2).toBeCloseTo(0.98, 6);
        // The clamp limits the translation, not each end, so the arrow keeps its shape.
        expect(patch.x2! - patch.x).toBeCloseTo(0.2, 6);
        expect(patch.y2! - patch.y).toBeCloseTo(0.1, 6);
        fireEvent.mouseUp(window);
    });

    it('falls back to x+w / y+h for an arrow saved without x2/y2', () => {
        const legacy: ChartAnnotation = { ...arrow, x2: undefined, y2: undefined };
        const { container, onUpdate } = renderArrow(legacy);
        selectArrow(container);

        const head = container.querySelector('[data-handle="head"]')!;
        expect(head.getAttribute('cx')).toBe(String(Math.round((0.1 + 0.2) * FRAME_W)));

        fireEvent.mouseDown(head, { button: 0, clientX: 0, clientY: 0 });
        fireEvent.mouseMove(window, { clientX: 40, clientY: 0 });
        expect(onUpdate).toHaveBeenLastCalledWith('a1', {
            x2: 0.3 + 40 / FRAME_W,
            y2: 0.2,
        });
        fireEvent.mouseUp(window);
    });
});
