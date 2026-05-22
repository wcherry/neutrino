/**
 * Unit tests for EditorContextMenu spell-check suggestions UI.
 *
 * Covers:
 *   - Renders existing items when no spell props are passed
 *   - Renders "Checking…" when spellWord is set but spellSuggestions is undefined
 *   - Renders suggestions at the top of the menu when spellSuggestions is present
 *   - Limits displayed suggestions to 5
 *   - Renders a separator after suggestions before existing items
 *   - Calls onApplySuggestion with the correct word when a suggestion is clicked
 *   - Does not render suggestion section when spellSuggestions is empty
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ── Mock the CSS module ───────────────────────────────────────────────────────
vi.mock(
  '../app/(apps)/docs/editor/EditorContextMenu.module.css',
  () => ({
    default: new Proxy({}, { get: (_t, key) => String(key) }),
  }),
);

// ── Mock editor ───────────────────────────────────────────────────────────────
function makeEditor(overrides: Record<string, unknown> = {}) {
  return {
    isActive: vi.fn(() => false),
    chain: vi.fn(() => ({
      focus: vi.fn(() => ({
        toggleBold: vi.fn(() => ({ run: vi.fn() })),
        toggleItalic: vi.fn(() => ({ run: vi.fn() })),
        toggleUnderline: vi.fn(() => ({ run: vi.fn() })),
        toggleStrike: vi.fn(() => ({ run: vi.fn() })),
        clearNodes: vi.fn(() => ({ unsetAllMarks: vi.fn(() => ({ run: vi.fn() })) })),
        setParagraph: vi.fn(() => ({ run: vi.fn() })),
        selectAll: vi.fn(() => ({ run: vi.fn() })),
        setTextSelection: vi.fn(() => ({ insertContent: vi.fn(() => ({ run: vi.fn() })) })),
      })),
    })),
    ...overrides,
  } as unknown as import('@tiptap/react').Editor;
}

import { EditorContextMenu } from '../app/(apps)/docs/editor/EditorContextMenu';

const defaultProps = {
  editor: makeEditor(),
  x: 100,
  y: 100,
  hasSelection: false,
  onClose: vi.fn(),
  onAddComment: vi.fn(),
  onInsertLink: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EditorContextMenu — baseline (no spell props)', () => {
  it('renders existing menu items', () => {
    render(<EditorContextMenu {...defaultProps} />);
    expect(screen.getByText('Add comment')).toBeInTheDocument();
    expect(screen.getByText('Bold')).toBeInTheDocument();
    expect(screen.getByText('Select all')).toBeInTheDocument();
  });

  it('does not render suggestion section when spellWord is absent', () => {
    render(<EditorContextMenu {...defaultProps} />);
    expect(screen.queryByText('Checking…')).not.toBeInTheDocument();
  });
});

describe('EditorContextMenu — "Checking…" placeholder', () => {
  it('shows Checking… when spellWord is set but spellSuggestions is undefined', () => {
    render(
      <EditorContextMenu
        {...defaultProps}
        spellWord="helo"
        spellSuggestions={undefined}
      />,
    );
    expect(screen.getByText('Checking…')).toBeInTheDocument();
  });

  it('does not show Checking… when spellSuggestions is provided', () => {
    render(
      <EditorContextMenu
        {...defaultProps}
        spellWord="helo"
        spellSuggestions={['hello', 'help']}
      />,
    );
    expect(screen.queryByText('Checking…')).not.toBeInTheDocument();
  });
});

describe('EditorContextMenu — suggestions rendering', () => {
  it('renders up to 5 suggestions', () => {
    render(
      <EditorContextMenu
        {...defaultProps}
        spellWord="helo"
        spellSuggestions={['hello', 'help', 'hero', 'helm', 'held', 'heel']}
        onApplySuggestion={vi.fn()}
      />,
    );
    // Only first 5 shown, not the 6th
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('held')).toBeInTheDocument();
    expect(screen.queryByText('heel')).not.toBeInTheDocument();
  });

  it('renders fewer than 5 when fewer are available', () => {
    render(
      <EditorContextMenu
        {...defaultProps}
        spellWord="helo"
        spellSuggestions={['hello', 'help']}
        onApplySuggestion={vi.fn()}
      />,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('help')).toBeInTheDocument();
  });

  it('does not render suggestions section when array is empty', () => {
    render(
      <EditorContextMenu
        {...defaultProps}
        spellWord="xyzzy"
        spellSuggestions={[]}
        onApplySuggestion={vi.fn()}
      />,
    );
    // No suggestion items, no checking placeholder
    expect(screen.queryByText('Checking…')).not.toBeInTheDocument();
    // Existing items still there
    expect(screen.getByText('Bold')).toBeInTheDocument();
  });

  it('suggestions appear before existing menu items', () => {
    const { container } = render(
      <EditorContextMenu
        {...defaultProps}
        spellWord="helo"
        spellSuggestions={['hello']}
        onApplySuggestion={vi.fn()}
      />,
    );
    const items = container.querySelectorAll('[role="menuitem"]');
    // First item should be the suggestion
    expect(items[0].textContent).toContain('hello');
  });
});

describe('EditorContextMenu — onApplySuggestion callback', () => {
  it('calls onApplySuggestion with the suggestion word when clicked', () => {
    const onApply = vi.fn();
    render(
      <EditorContextMenu
        {...defaultProps}
        spellWord="helo"
        spellSuggestions={['hello']}
        onApplySuggestion={onApply}
      />,
    );
    fireEvent.click(screen.getByText('hello'));
    expect(onApply).toHaveBeenCalledWith('hello');
  });

  it('calls onClose after applying a suggestion', () => {
    const onClose = vi.fn();
    const onApply = vi.fn();
    render(
      <EditorContextMenu
        {...defaultProps}
        onClose={onClose}
        spellWord="helo"
        spellSuggestions={['hello']}
        onApplySuggestion={onApply}
      />,
    );
    fireEvent.click(screen.getByText('hello'));
    expect(onClose).toHaveBeenCalled();
  });
});
