'use client';

/**
 * The welcome wizard: a 960×640 dialog over the dimmed app, shown once to a new account straight
 * after the encryption key exists.
 *
 * A left column lists the seven steps with a status each, and under it a footnote saying where the
 * current step's settings live later. The main area holds "Step N of 7", the heading, the intro and
 * the step itself. The footer is the progress bar and Back / Next / Finish, and nothing else —
 * a step's own buttons (Connect, Test key, Send invites) are in its body.
 *
 * Every step can be left without doing anything, and a step left that way is listed as
 * "skipped". It is not resumable: closing, or Finish, ends it for good (`onClose`), and the next
 * visit starts nothing. Step 1, the key, was done before this opened and is always shown as done.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button, Modal, ModalHeader, ProgressBar } from '@neutrino/ui';
import { AiStep } from './steps/AiStep';
import { CalendarStep } from './steps/CalendarStep';
import { FilesStep } from './steps/FilesStep';
import { InviteStep } from './steps/InviteStep';
import { LookStep } from './steps/LookStep';
import { ProfileStep } from './steps/ProfileStep';
import { StepContext, type StepCommit } from './stepApi';
import { FIRST_STEP, LAST_STEP, STEPS, canGoBack, canGoNext, statusOf, type StepId } from './steps';
import styles from './WelcomeWizard.module.css';

export type WizardEnd = 'finish' | 'close';

export interface WelcomeWizardProps {
  /** The step to open on (an index into the seven); default the first after the key. */
  startStep?: number;
  /** The wizard is over — finished, or closed early. */
  onClose: (how: WizardEnd) => void;
}

const BODIES: Partial<Record<StepId, React.ComponentType>> = {
  look: LookStep,
  profile: ProfileStep,
  ai: AiStep,
  calendar: CalendarStep,
  files: FilesStep,
  invite: InviteStep,
};

export function WelcomeWizard({ startStep = FIRST_STEP, onClose }: WelcomeWizardProps) {
  const [current, setCurrent] = useState(() => Math.min(Math.max(startStep, FIRST_STEP), LAST_STEP));
  const [done, setDone] = useState<ReadonlySet<StepId>>(() => new Set());
  const [left, setLeft] = useState<ReadonlySet<StepId>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const commitRef = useRef<StepCommit | null>(null);

  const step = STEPS[current];
  const Body = BODIES[step.id];

  const markDone = useCallback(() => {
    setDone((prev) => (prev.has(step.id) ? prev : new Set(prev).add(step.id)));
  }, [step.id]);
  const setCommit = useCallback((commit: StepCommit | null) => {
    commitRef.current = commit;
  }, []);

  /** Run the step's save. A throw keeps the user on the step (the step shows why); `force` goes on. */
  const leave = useCallback(
    async (force: boolean): Promise<boolean> => {
      setBusy(true);
      try {
        const saved = await commitRef.current?.();
        if (saved) setDone((prev) => new Set(prev).add(step.id));
      } catch {
        if (!force) return false;
      } finally {
        setBusy(false);
      }
      setLeft((prev) => new Set(prev).add(step.id));
      return true;
    },
    [step.id],
  );

  const go = useCallback(
    async (delta: number) => {
      if (busy) return;
      if (await leave(false)) setCurrent((c) => c + delta);
    },
    [busy, leave],
  );

  const end = useCallback(
    async (how: WizardEnd, force: boolean) => {
      if (busy) return;
      if (await leave(force)) onClose(how);
    },
    [busy, leave, onClose],
  );

  const host = React.useMemo(() => ({ markDone, setCommit }), [markDone, setCommit]);
  const last = current === LAST_STEP;

  return (
    <Modal open onClose={() => void end('close', true)} size="xl" closeOnBackdrop={false} className={styles.dialog}>
      <div className={styles.shell} data-testid="welcome-wizard">
        <aside className={styles.rail}>
          <ModalHeader className={styles.railTitle}>Set up Neutrino</ModalHeader>
          <ol className={styles.list}>
            {STEPS.map((s, i) => {
              const status = statusOf(i, current, done, left);
              return (
                <li
                  key={s.id}
                  className={styles.item}
                  data-status={status}
                  data-step={s.id}
                  aria-current={status === 'current' ? 'step' : undefined}
                >
                  <span className={styles.marker} aria-hidden="true">
                    {status === 'done' ? <Check size={12} /> : i + 1}
                  </span>
                  <span className={styles.itemLabel}>{s.label}</span>
                  {status === 'skipped' && <span className={styles.itemNote}>skipped</span>}
                  {status === 'done' && <span className={styles.srOnly}>done</span>}
                </li>
              );
            })}
          </ol>
          <p className={styles.footnote} data-testid="wizard-footnote">{step.footnote}</p>
        </aside>

        <section className={styles.main} aria-labelledby="wizard-step-heading">
          <div className={styles.head}>
            <span className={styles.stepCount}>Step {current + 1} of {STEPS.length}</span>
            <h3 id="wizard-step-heading" className={styles.heading}>{step.heading}</h3>
            <p className={styles.intro}>{step.intro}</p>
          </div>
          <div className={styles.body}>
            <StepContext.Provider value={host}>
              {/* Keyed on the step so each starts clean and registers its own save. */}
              {Body && <Body key={step.id} />}
            </StepContext.Provider>
          </div>
          {/* After the step in the DOM, so focus opens on the step and not on a way out. */}
          <button type="button" className={styles.close} onClick={() => void end('close', true)} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </section>

        <footer className={styles.footer}>
          <ProgressBar
            className={styles.progress}
            value={current + 1}
            max={STEPS.length}
            size="sm"
            label={`${current + 1} of ${STEPS.length}`}
          />
          <div className={styles.actions}>
            <Button type="button" variant="ghost" disabled={!canGoBack(current) || busy} onClick={() => void go(-1)}>
              Back
            </Button>
            <Button type="button" variant={last ? 'secondary' : 'primary'} disabled={!canGoNext(current) || busy} onClick={() => void go(1)}>
              Next
            </Button>
            <Button type="button" variant={last ? 'primary' : 'secondary'} disabled={busy} onClick={() => void end('finish', false)}>
              Finish
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
