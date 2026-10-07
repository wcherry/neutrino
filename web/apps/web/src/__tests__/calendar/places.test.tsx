/**
 * Task geofences on the web (#243): the place helpers, the place picker, and Smart Add's
 * `@place` — a saved place attached on create, anything else offered to confirm, never guessed.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import {
  DEFAULT_RADIUS_M,
  describeGeofence,
  foldPlaceName,
  geocode,
  geofenceFields,
  geofenceOf,
  matchPlace,
  type GeocodeResult,
  type Place,
} from '../../app/(apps)/calendar/places';
import { PlacePicker } from '../../app/(apps)/calendar/PlacePicker';
import { TasksSidebar } from '../../app/(apps)/calendar/TasksSidebar';
import type { TaskResponse } from '../../lib/api';

// Leaflet needs a real browser; the picker's map is not what is under test.
vi.mock('next/dynamic', () => ({
  default: () => function MapStub() { return <div data-testid="geofence-map" />; },
}));

vi.mock('@neutrino/ui', () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  ModalHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
  ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, icon: _icon, variant: _variant, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; variant?: string }) => (
    <button {...rest}>{children}</button>
  ),
}));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return { ...actual, DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</> };
});

const home: Place = { id: 'home', name: 'Home', lat: 51.501364, lng: -0.14189, radiusM: 150 };
const homeDepot: Place = { id: 'depot', name: 'Home Depot', lat: 1, lng: 2, radiusM: 300 };
const cafe: Place = { id: 'cafe', name: 'Café Zoë', lat: 35.68, lng: 139.76, radiusM: 100 };
const safeway: GeocodeResult = { name: 'Safeway', label: 'Safeway, 5th Avenue, Springfield', lat: 37.77, lng: -122.42 };

describe('matchPlace (the iOS PlacesService.match rule)', () => {
  it('prefers an exact name, ignoring case, accents and punctuation', () => {
    expect(matchPlace('home', [homeDepot, home])?.id).toBe('home');
    expect(matchPlace('cafe-zoe', [cafe])?.id).toBe('cafe');
    expect(foldPlaceName('Café Zoë — 東京!')).toBe('cafezoe東京');
  });

  it('takes the only place a prefix fits, and none when several do', () => {
    expect(matchPlace('Dep', [homeDepot, home])).toBeNull();
    expect(matchPlace('Home D', [homeDepot, home])?.id).toBe('depot');
    expect(matchPlace('Ho', [homeDepot, home])).toBeNull();
    expect(matchPlace('Ca', [homeDepot, home, cafe])?.id).toBe('cafe');
  });

  it('matches nothing for no text or no fit', () => {
    expect(matchPlace('  ', [home])).toBeNull();
    expect(matchPlace('Safeway', [home, cafe])).toBeNull();
  });
});

describe('geofence fields', () => {
  it('sends all four, clearing the other kind', () => {
    expect(geofenceFields({ kind: 'place', placeId: 'home' })).toEqual({ geoPlaceId: 'home', geoLat: null, geoLng: null, geoRadiusM: null });
    expect(geofenceFields({ kind: 'point', lat: 1, lng: 2, radiusM: 5000 })).toEqual({ geoPlaceId: null, geoLat: 1, geoLng: 2, geoRadiusM: 2000 });
    expect(geofenceFields(null)).toEqual({ geoPlaceId: null, geoLat: null, geoLng: null, geoRadiusM: null });
  });

  it('reads a task’s geofence, a place before a point', () => {
    expect(geofenceOf({ geoPlaceId: 'home', geoLat: 1, geoLng: 2 })).toEqual({ kind: 'place', placeId: 'home' });
    expect(geofenceOf({ geoLat: 1, geoLng: 2, geoRadiusM: null })).toEqual({ kind: 'point', lat: 1, lng: 2, radiusM: DEFAULT_RADIUS_M });
    expect(geofenceOf({})).toBeNull();
  });

  it('describes a place by name, and one it can’t read without guessing', () => {
    expect(describeGeofence({ kind: 'place', placeId: 'home' }, [home])).toBe('Home');
    expect(describeGeofence({ kind: 'place', placeId: 'gone' }, [home])).toBe('A saved place');
    expect(describeGeofence({ kind: 'point', lat: 51.5, lng: -0.1, radiusM: 1500 }, [])).toBe('51.5000, -0.1000 · 1.5 km');
  });
});

describe('geocode', () => {
  it('asks Nominatim once and reads its results', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ name: 'Safeway', display_name: 'Safeway, 5th Avenue', lat: '37.77', lon: '-122.42' }],
    });
    const results = await geocode('Safeway', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0][0])).toContain('nominatim.openstreetmap.org/search?q=Safeway');
    expect(results).toEqual([{ name: 'Safeway', label: 'Safeway, 5th Avenue', lat: 37.77, lng: -122.42 }]);
  });

  it('asks nothing for an empty query', async () => {
    const fetchImpl = vi.fn();
    expect(await geocode('  ', fetchImpl as unknown as typeof fetch)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('PlacePicker', () => {
  it('picks a saved place at once', () => {
    const onPick = vi.fn();
    render(<PlacePicker places={[home]} onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(onPick).toHaveBeenCalledWith({ geofence: { kind: 'place', placeId: 'home' }, label: 'Home' });
  });

  it('searches on submit, then picks a result with its radius', async () => {
    const onPick = vi.fn();
    const geocoder = vi.fn().mockResolvedValue([safeway]);
    render(<PlacePicker places={[]} initialQuery="Safeway" onPick={onPick} onClose={vi.fn()} geocoder={geocoder} />);
    expect(geocoder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: /Safeway, 5th Avenue/ }));
    expect(screen.getByTestId('geofence-map')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Remind within/), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remind me here' }));
    expect(geocoder).toHaveBeenCalledWith('Safeway');
    expect(onPick).toHaveBeenCalledWith({
      geofence: { kind: 'point', lat: 37.77, lng: -122.42, radiusM: 500 },
      label: 'Safeway',
      saveAs: undefined,
    });
  });

  it('saves a pick as a named place when asked', async () => {
    const onPick = vi.fn();
    render(<PlacePicker places={[]} initialQuery="Safeway" onPick={onPick} onClose={vi.fn()} geocoder={async () => [safeway]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: /Safeway, 5th Avenue/ }));
    fireEvent.click(screen.getByLabelText('Save as a place'));
    fireEvent.change(screen.getByLabelText('Place name'), { target: { value: 'Groceries' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remind me here' }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ saveAs: 'Groceries', label: 'Groceries' }));
  });

  it('can’t save a place while the key is locked, and says why', async () => {
    render(
      <PlacePicker places={[]} initialQuery="Safeway" saveUnavailableReason="Unlock your encryption key to save places."
        onPick={vi.fn()} onClose={vi.fn()} geocoder={async () => [safeway]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: /Safeway, 5th Avenue/ }));
    expect(screen.getByLabelText('Save as a place')).toBeDisabled();
    expect(screen.getByText('Unlock your encryption key to save places.')).toBeInTheDocument();
  });
});

describe('Smart Add @place', () => {
  function created(id: string, title: string): TaskResponse {
    return {
      id, title, notes: null, done: false, dueDate: null, position: 0, eventId: null,
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    };
  }

  function renderSidebar(overrides: Partial<React.ComponentProps<typeof TasksSidebar>> = {}) {
    const props = {
      tasks: [],
      onToggleTask: vi.fn(),
      onCreateTask: vi.fn(async (req: { title: string }) => created('t1', req.title)),
      isCreatingTask: false,
      onOpenTask: vi.fn(),
      places: [home, homeDepot],
      onSetGeofence: vi.fn(async () => {}),
      geocoder: vi.fn(async () => [safeway]),
      ...overrides,
    };
    render(<TasksSidebar {...props} />);
    return props;
  }

  function type(text: string) {
    const box = screen.getByLabelText('Add a task');
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: 'Enter' });
  }

  it('attaches a saved place on create, and the preview says it will remind', async () => {
    const props = renderSidebar();
    fireEvent.change(screen.getByLabelText('Add a task'), { target: { value: 'Water plants @home' } });
    expect(screen.getByText(/Home · reminds on arrival/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Add a task'), { key: 'Enter' });
    await waitFor(() => expect(props.onCreateTask).toHaveBeenCalled());
    expect(props.onCreateTask.mock.calls[0][0]).toMatchObject({ title: 'Water plants', location: 'home', geoPlaceId: 'home' });
    expect(props.geocoder).not.toHaveBeenCalled();
  });

  it('offers the top search result for an unknown place, and sets it only on yes', async () => {
    const props = renderSidebar();
    type('Buy milk @Safeway');
    await waitFor(() => expect(props.onCreateTask).toHaveBeenCalled());
    expect(props.onCreateTask.mock.calls[0][0]).not.toHaveProperty('geoPlaceId');
    const offer = await screen.findByTestId('place-offer');
    expect(offer).toHaveTextContent('Remind you when you arrive at Safeway?');
    expect(props.onSetGeofence).not.toHaveBeenCalled();

    fireEvent.click(within(offer).getByRole('button', { name: 'Remind me' }));
    await waitFor(() =>
      expect(props.onSetGeofence).toHaveBeenCalledWith('t1', { kind: 'point', lat: 37.77, lng: -122.42, radiusM: DEFAULT_RADIUS_M }),
    );
    expect(screen.queryByTestId('place-offer')).toBeNull();
  });

  it('attaches nothing when the offer is declined', async () => {
    const props = renderSidebar();
    type('Buy milk @Safeway');
    fireEvent.click(within(await screen.findByTestId('place-offer')).getByRole('button', { name: 'No thanks' }));
    expect(screen.queryByTestId('place-offer')).toBeNull();
    expect(props.onSetGeofence).not.toHaveBeenCalled();
  });

  it('offers nothing for an ambiguous name it won’t guess at, if search finds nothing', async () => {
    const props = renderSidebar({ geocoder: vi.fn(async () => []) });
    type('Call @Ho');
    await waitFor(() => expect(props.geocoder).toHaveBeenCalledWith('Ho'));
    expect(props.onCreateTask.mock.calls[0][0]).not.toHaveProperty('geoPlaceId');
    expect(screen.queryByTestId('place-offer')).toBeNull();
  });
});
