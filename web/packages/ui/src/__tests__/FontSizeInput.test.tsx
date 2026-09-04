import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FontSizeInput } from '../components/inputs/FontSizeInput';

const SIZES = [8, 10, 12, 14];

function setup(props: Partial<React.ComponentProps<typeof FontSizeInput>> = {}) {
    const onChange = vi.fn();
    render(<FontSizeInput value={12} onChange={onChange} sizes={SIZES} {...props} />);
    return { onChange, user: userEvent.setup(), input: screen.getByRole('combobox') as HTMLInputElement };
}

/** A caller that stores what it is told, the way every editor's toolbar does. */
function Controlled({ onChange }: { onChange: (n: number) => void }) {
    const [size, setSize] = useState(12);
    return <FontSizeInput value={size} sizes={SIZES} onChange={n => { setSize(n); onChange(n); }} />;
}

describe('FontSizeInput', () => {
    it('accepts a size that is not in the preset list', async () => {
        const { onChange, user, input } = setup();

        await user.clear(input);
        await user.type(input, '37');
        await user.keyboard('{Enter}');

        expect(onChange).toHaveBeenCalledWith(37);
    });

    it('reports a size once and gives focus back on Enter', async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(<Controlled onChange={onChange} />);
        const input = screen.getByRole('combobox');

        await user.clear(input);
        await user.type(input, '37{Enter}');

        // Enter blurs, and the blur commits too — the size must still be reported once.
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(input).not.toHaveFocus();
    });

    it('commits a typed size on blur', async () => {
        const { onChange, user, input } = setup();

        await user.clear(input);
        await user.type(input, '13.5');
        await user.tab();

        expect(onChange).toHaveBeenCalledWith(13.5);
    });

    it('clamps a typed size to the allowed range', async () => {
        const { onChange, user, input } = setup({ min: 1, max: 400 });

        await user.clear(input);
        await user.type(input, '9999{Enter}');

        expect(onChange).toHaveBeenCalledWith(400);
    });

    it('reverts to the current size when what was typed is not a number', async () => {
        const { onChange, user, input } = setup();

        await user.clear(input);
        await user.type(input, 'huge{Enter}');

        expect(onChange).not.toHaveBeenCalled();
        expect(input.value).toBe('12');
    });

    it('steps the size with the arrow keys', async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(<Controlled onChange={onChange} />);

        await user.click(screen.getByRole('combobox'));
        await user.keyboard('{ArrowUp}');
        expect(onChange).toHaveBeenLastCalledWith(13);

        await user.keyboard('{ArrowDown}');
        expect(onChange).toHaveBeenLastCalledWith(12);
    });

    it('still offers the presets in a drop-down', async () => {
        const { onChange, user } = setup();

        await user.click(screen.getByRole('button', { name: 'Font size presets' }));
        expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['8', '10', '12', '14']);

        await user.click(screen.getByRole('option', { name: '14' }));
        expect(onChange).toHaveBeenCalledWith(14);
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('follows the size in effect while it is not being typed into', async () => {
        const onChange = vi.fn();
        const { rerender } = render(<FontSizeInput value={12} onChange={onChange} sizes={SIZES} />);
        rerender(<FontSizeInput value={24} onChange={onChange} sizes={SIZES} />);

        expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('24');
    });
});
