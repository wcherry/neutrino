import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, createEvent, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColorPickerPopover } from '../components/inputs/ColorPickerPopover';

async function openPicker() {
    const user = userEvent.setup();
    render(<ColorPickerPopover color="#336699" onChange={vi.fn()} title="Background" />);
    await user.click(screen.getByTitle('Background'));
    return user;
}

describe('ColorPickerPopover', () => {
    it('lets focus enter the value inputs', async () => {
        const user = await openPicker();
        await user.click(screen.getByRole('button', { name: 'Values' }));

        // The popover suppresses the default of a mousedown to keep the caller's
        // selection alive, which used to swallow focus for everything inside it.
        const hex = screen.getByDisplayValue('#336699');
        await user.click(hex);
        expect(hex).toHaveFocus();

        const [red] = screen.getAllByRole('spinbutton');
        await user.click(red);
        expect(red).toHaveFocus();
    });

    it('lets the sliders receive their drag', async () => {
        const user = await openPicker();
        await user.click(screen.getByRole('button', { name: 'Wheel' }));

        // A range input moves its thumb off the mousedown default; prevent it and
        // the V slider is inert.
        const slider = screen.getByRole('slider');
        const down = createEvent.mouseDown(slider);
        fireEvent(slider, down);
        expect(down.defaultPrevented).toBe(false);
    });

    it('still keeps focus where it was for the swatch grid', async () => {
        await openPicker();

        const swatch = screen.getByTitle('#ff3333');
        const down = createEvent.mouseDown(swatch);
        fireEvent(swatch, down);
        expect(down.defaultPrevented).toBe(true);
    });
});
