'use client';

import React, { useState } from 'react';
import { REPEAT_OPTIONS } from './calendarConstants';
import {
  MAX_REPEAT_NUMBER,
  WEEKDAYS_BYDAY,
  defaultRepeatEndDate,
  repeatPreset,
  repeatUnit,
  withRepeatPreset,
  type RepeatEnd,
  type RepeatRule,
} from './repeatRule';
import styles from './page.module.css';

const CUSTOM = '__custom__';
const DAY_NAMES: Record<string, string> = {
  SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat',
};

interface RepeatFieldsProps {
  rule: RepeatRule | null;
  /** A stored rule the form can't represent, shown as "Custom" and kept until changed. */
  customRule: string | null;
  /** The event's start, as the form holds it (`yyyy-mm-dd` or `yyyy-mm-ddThh:mm`). */
  start: string;
  onChange: (rule: RepeatRule | null) => void;
}

/** How often an event repeats — "every 3 days" — and when it stops: never, on a date, or after N times. */
export default function RepeatFields({ rule, customRule, start, onChange }: RepeatFieldsProps) {
  const preset = rule ? repeatPreset(rule) : customRule ? CUSTOM : '';
  const startDate = start.slice(0, 10);

  function setEnd(kind: RepeatEnd['kind']) {
    if (!rule) return;
    const end: RepeatEnd =
      kind === 'on' ? { kind, date: defaultRepeatEndDate(start, rule.freq) }
        : kind === 'after' ? { kind, count: 10 }
          : { kind };
    onChange({ ...rule, end });
  }

  const otherDays = rule?.freq === 'WEEKLY' && rule.byDay && rule.byDay !== WEEKDAYS_BYDAY
    ? rule.byDay.split(',').map((d) => DAY_NAMES[d.replace(/[^A-Z]/g, '')] ?? d).join(', ')
    : null;

  return (
    <>
      <div className={styles.formGroup}>
        <label className={styles.formLabel} htmlFor="repeatPreset">Repeats</label>
        <select
          id="repeatPreset"
          className={styles.formInput}
          value={preset}
          onChange={(e) => onChange(withRepeatPreset(rule, e.target.value))}
        >
          {REPEAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          {customRule && !rule && <option value={CUSTOM}>Custom ({customRule})</option>}
        </select>
        {otherDays && <span className={styles.formHint}>On {otherDays}</span>}
      </div>

      {rule && (
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="repeatInterval">Every</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <NumberInput
                id="repeatInterval"
                value={rule.interval}
                onChange={(interval) => onChange({ ...rule, interval })}
              />
              <span className={styles.formLabel} style={{ margin: 0 }}>{repeatUnit(rule.freq, rule.interval)}</span>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="repeatEnd">Ends</label>
            <select
              id="repeatEnd"
              className={styles.formInput}
              value={rule.end.kind}
              onChange={(e) => setEnd(e.target.value as RepeatEnd['kind'])}
            >
              <option value="never">Never</option>
              <option value="on">On date</option>
              <option value="after">After</option>
            </select>
            {rule.end.kind === 'on' && (
              <input
                type="date"
                aria-label="Repeat end date"
                className={styles.formInput}
                value={rule.end.date}
                min={startDate}
                required
                onChange={(e) => e.target.value && onChange({ ...rule, end: { kind: 'on', date: e.target.value } })}
              />
            )}
            {rule.end.kind === 'after' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <NumberInput
                  id="repeatCount"
                  label="Number of occurrences"
                  value={rule.end.count}
                  onChange={(count) => onChange({ ...rule, end: { kind: 'after', count } })}
                />
                <span className={styles.formLabel} style={{ margin: 0 }}>
                  {rule.end.count === 1 ? 'time' : 'times'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A whole number from 1 to 999. Holds its own text so the field can be cleared while typing;
 * only a valid number reaches the rule.
 */
function NumberInput({ id, label, value, onChange }: {
  id: string;
  label?: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <input
      id={id}
      aria-label={label}
      type="number"
      inputMode="numeric"
      min={1}
      max={MAX_REPEAT_NUMBER}
      step={1}
      className={styles.formInput}
      style={{ width: 80 }}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (Number.isInteger(n) && n >= 1 && n <= MAX_REPEAT_NUMBER) onChange(n);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}
