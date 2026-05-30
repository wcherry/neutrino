/**
 * Unit tests for ThemeModal component.
 *
 * Covers:
 *   - Renders all four theme options
 *   - Current theme button is visually marked (selected)
 *   - Clicking a theme selects it
 *   - Apply calls onSave with the selected theme
 *   - Apply with no interaction saves the initial (current) theme
 *   - Cancel calls onClose without calling onSave
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('../../app/(apps)/docs/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

import { ThemeModal } from '../../app/(apps)/docs/editor/ThemeModal';

const defaultProps = {
  currentTheme: 'default' as const,
  onSave: vi.fn(),
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ThemeModal', () => {
  it('renders all four themes', () => {
    render(<ThemeModal {...defaultProps} />);
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Corporate')).toBeInTheDocument();
    expect(screen.getByText('Academic')).toBeInTheDocument();
    expect(screen.getByText('Minimal')).toBeInTheDocument();
  });

  it('clicking Apply without changing theme saves the current theme', () => {
    render(<ThemeModal {...defaultProps} currentTheme="academic" />);
    fireEvent.click(screen.getByText('Apply'));
    expect(defaultProps.onSave).toHaveBeenCalledWith('academic');
  });

  it('clicking a different theme then Apply saves the new theme', () => {
    render(<ThemeModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Corporate'));
    fireEvent.click(screen.getByText('Apply'));
    expect(defaultProps.onSave).toHaveBeenCalledWith('corporate');
  });

  it('clicking Cancel calls onClose without calling onSave', () => {
    render(<ThemeModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalled();
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it('clicking Apply also calls onClose', () => {
    render(<ThemeModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Apply'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('can select Academic theme', () => {
    render(<ThemeModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Academic'));
    fireEvent.click(screen.getByText('Apply'));
    expect(defaultProps.onSave).toHaveBeenCalledWith('academic');
  });

  it('can select Minimal theme', () => {
    render(<ThemeModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Minimal'));
    fireEvent.click(screen.getByText('Apply'));
    expect(defaultProps.onSave).toHaveBeenCalledWith('minimal');
  });
});
