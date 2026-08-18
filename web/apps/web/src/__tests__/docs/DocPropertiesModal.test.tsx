/**
 * The document-properties dialog — where the metadata field codes get their
 * values from.
 *
 * The two rules that are not obvious from the markup: a custom property is
 * named the way a typed field code is (so `Client` and `client` are one
 * property, not two that shadow each other invisibly), and a custom property
 * named for a built-in code is dropped rather than stored, because `{{author}}`
 * reads the built-in one and a custom `author` could never be reached.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocPropertiesModal } from '../../app/(apps)/docs/editor/DocPropertiesModal';
import { emptyDocProperties, type DocProperties } from '@/lib/docFields';

function open(initial: Partial<DocProperties> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <DocPropertiesModal
      properties={{ ...emptyDocProperties(), ...initial }}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { onSave, onClose };
}

const apply = () => fireEvent.click(screen.getByText('Apply'));

describe('DocPropertiesModal', () => {
  it('saves an edited built-in property', () => {
    const { onSave, onClose } = open();
    fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'Ada Lovelace' } });
    apply();

    expect(onSave.mock.calls[0][0].author).toBe('Ada Lovelace');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the properties it was given', () => {
    open({ author: 'Ada Lovelace', company: 'Analytical Engines' });
    expect(screen.getByLabelText('Author')).toHaveValue('Ada Lovelace');
    expect(screen.getByLabelText('Company')).toHaveValue('Analytical Engines');
  });

  it('adds a custom property under a canonical name', () => {
    const { onSave } = open();
    fireEvent.click(screen.getByText('Add property'));
    fireEvent.change(screen.getByLabelText('Custom property 1 name'), { target: { value: 'Client' } });
    fireEvent.change(screen.getByLabelText('Custom property 1 value'), { target: { value: 'Initech' } });
    apply();

    expect(onSave.mock.calls[0][0].custom).toEqual({ client: 'Initech' });
  });

  it('drops a custom property named for a built-in code', () => {
    const { onSave } = open();
    fireEvent.click(screen.getByText('Add property'));
    fireEvent.change(screen.getByLabelText('Custom property 1 name'), { target: { value: 'author' } });
    fireEvent.change(screen.getByLabelText('Custom property 1 value'), { target: { value: 'shadowed' } });
    apply();

    expect(onSave.mock.calls[0][0].custom).toEqual({});
  });

  it('drops a row that was added and never named', () => {
    const { onSave } = open();
    fireEvent.click(screen.getByText('Add property'));
    apply();

    expect(onSave.mock.calls[0][0].custom).toEqual({});
  });

  it('removes a custom property', () => {
    const { onSave } = open({ custom: { client: 'Initech' } });
    fireEvent.click(screen.getByLabelText('Remove custom property 1'));
    apply();

    expect(onSave.mock.calls[0][0].custom).toEqual({});
  });

  it('does not save on cancel', () => {
    const { onSave, onClose } = open();
    fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByText('Cancel'));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
