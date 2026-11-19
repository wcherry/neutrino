/**
 * Tests for AgendaView's landing on a day, as the month view's "+N more" asks it to.
 */

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import AgendaView from '../../app/(apps)/calendar/AgendaView';
import type { EventResponse } from '../../lib/api';

const event = (id: string, day: number): EventResponse => ({
  id,
  title: `Event ${id}`,
  description: null,
  startTime: new Date(2026, 2, day, 9).toISOString(),
  endTime: new Date(2026, 2, day, 10).toISOString(),
  allDay: false,
  location: null,
  recurrenceRule: null,
  attendees: [],
  source: 'local',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  timezone: null,
});

describe('AgendaView focusDay', () => {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this.dataset.date ?? '');
  };
  afterEach(() => {
    scrolled.length = 0;
  });
  afterAll(() => {
    Element.prototype.scrollIntoView = original;
  });

  it('scrolls to the day it was sent to', () => {
    render(
      <AgendaView
        cursor={new Date(2026, 2, 1)}
        events={[event('a', 3), event('b', 20), event('c', 27)]}
        onEventClick={vi.fn()}
        focusDay={new Date(2026, 2, 20)}
      />,
    );
    expect(scrolled).toEqual(['2026-03-20']);
  });

  it('waits for the day to load, then scrolls to it once', () => {
    const props = { cursor: new Date(2026, 2, 1), onEventClick: vi.fn(), focusDay: new Date(2026, 2, 20) };
    const { rerender } = render(<AgendaView {...props} events={[event('a', 3)]} />);
    expect(scrolled).toEqual([]);
    rerender(<AgendaView {...props} events={[event('a', 3), event('b', 20)]} />);
    rerender(<AgendaView {...props} events={[event('a', 3), event('b', 20), event('c', 20)]} />);
    expect(scrolled).toEqual(['2026-03-20']);
  });
});
