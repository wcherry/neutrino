'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Spinner } from '@neutrino/ui';
import {
  calendarApi,
  type CalendarResponse,
  type UpdateCalendarRequest,
} from '@neutrino/api-calendar';
import { CALENDAR_COLORS, holidayCountries, holidayRegions } from '../calendar/calendars';
import styles from './page.module.css';
import holidayStyles from './HolidaysSection.module.css';

/** How many matching countries the search offers at once. */
const MAX_MATCHES = 8;

/**
 * Settings → Calendar → Holidays: a read-only holiday calendar per chosen country, each with its
 * own region, observances, colour and visibility. The choices are calendars on the server, so
 * they are the same on every device; the holidays themselves are worked out on the device.
 */
export function HolidaysSection() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: calendarsData, isLoading } = useQuery({
    queryKey: ['calendars'],
    queryFn: () => calendarApi.listCalendars(),
  });
  const added = (calendarsData?.calendars ?? []).filter((c) => c.kind === 'holidays');

  // Loaded only when this section is open: the rules are the size of a large library.
  const { data: countries = [] } = useQuery({
    queryKey: ['holiday-countries'],
    queryFn: () => holidayCountries(),
    staleTime: Infinity,
  });

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(added.map((c) => c.country));
    return countries
      .filter((c) => !taken.has(c.code))
      .filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q)
      .slice(0, MAX_MATCHES);
  }, [search, countries, added]);

  const onError = (fallback: string) => (err: unknown) =>
    setError(err instanceof Error && err.message ? err.message : fallback);
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendars'] });

  const addCountry = useMutation({
    mutationFn: (country: { code: string; name: string }) =>
      calendarApi.createCalendar({
        kind: 'holidays',
        country: country.code,
        name: country.name,
        // Each country after the first in a colour of its own, so they can be told apart.
        color: CALENDAR_COLORS[(3 + added.length) % CALENDAR_COLORS.length],
      }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setSearch('');
      refresh();
    },
    onError: onError('Could not add that country'),
  });

  const update = useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateCalendarRequest }) => calendarApi.updateCalendar(id, req),
    onMutate: () => setError(null),
    onSuccess: refresh,
    onError: onError('Could not save the change'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => calendarApi.deleteCalendar(id),
    onMutate: () => setError(null),
    onSuccess: refresh,
    onError: onError('Could not remove that country'),
  });

  return (
    <section className={styles.section} data-testid="holidays-section">
      <h2 className={styles.sectionTitle}>Holidays</h2>
      <p className={styles.sectionDesc}>
        Show a country&apos;s public holidays on your calendar. Each country is a read-only
        calendar you can colour, hide or remove. Holidays are worked out on this device, so your
        choice of countries isn&apos;t shared with anyone.
      </p>

      {isLoading ? (
        <Spinner size="sm" />
      ) : (
        added.length > 0 && (
          <div className={styles.connectionList}>
            {added.map((calendar) => (
              <HolidayRow
                key={calendar.id}
                calendar={calendar}
                onChange={(req) => update.mutate({ id: calendar.id, req })}
                onRemove={() => remove.mutate(calendar.id)}
              />
            ))}
          </div>
        )
      )}

      <div className={holidayStyles.search}>
        <input
          className={styles.formInput}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Add a country…"
          aria-label="Search countries"
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls="holiday-country-matches"
          aria-autocomplete="list"
        />
        {matches.length > 0 && (
          <ul className={holidayStyles.matches} id="holiday-country-matches" role="listbox">
            {matches.map((c) => (
              <li key={c.code} role="option" aria-selected={false}>
                <button
                  type="button"
                  className={holidayStyles.match}
                  onClick={() => addCountry.mutate(c)}
                  disabled={addCountry.isPending}
                >
                  {c.name}
                  <span className={holidayStyles.matchCode}>{c.code}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className={holidayStyles.error} role="alert">{error}</p>}

      <p className={holidayStyles.credit}>
        Holiday data from the open-source{' '}
        <a href="https://github.com/commenthol/date-holidays" target="_blank" rel="noreferrer">date-holidays</a>{' '}
        project, licensed CC BY 3.0.
      </p>
    </section>
  );
}

function HolidayRow({
  calendar,
  onChange,
  onRemove,
}: {
  calendar: CalendarResponse;
  onChange: (req: UpdateCalendarRequest) => void;
  onRemove: () => void;
}) {
  const { data: regions = [] } = useQuery({
    queryKey: ['holiday-regions', calendar.country],
    queryFn: () => holidayRegions(calendar.country ?? ''),
    enabled: !!calendar.country,
    staleTime: Infinity,
  });

  return (
    <div className={`${styles.connectionRow} ${holidayStyles.row}`} data-testid="holiday-row" data-country={calendar.country ?? ''}>
      <div className={holidayStyles.rowMain}>
        <label className={holidayStyles.swatch} style={{ background: calendar.color }} title="Change colour">
          <input
            type="color"
            value={calendar.color}
            onChange={(e) => onChange({ color: e.target.value })}
            aria-label={`Colour of ${calendar.name}`}
          />
        </label>
        <div className={styles.connectionInfo}>
          <div className={styles.connectionName}>{calendar.name}</div>
          {regions.length > 0 && (
            <select
              className={holidayStyles.region}
              value={calendar.region ?? ''}
              onChange={(e) => onChange({ region: e.target.value })}
              aria-label={`Region of ${calendar.name}`}
            >
              <option value="">Nationwide only</option>
              {regions.map((r) => (
                <option key={r.code} value={r.code}>{r.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className={styles.connectionActions}>
        <label className={holidayStyles.check}>
          <input
            type="checkbox"
            checked={calendar.includeObservances}
            onChange={(e) => onChange({ includeObservances: e.target.checked })}
          />
          Observances
        </label>
        <label className={holidayStyles.check}>
          <input
            type="checkbox"
            checked={calendar.visible}
            onChange={(e) => onChange({ visible: e.target.checked })}
          />
          Show
        </label>
        <button
          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          onClick={onRemove}
          title="Remove"
          aria-label={`Remove ${calendar.name}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
