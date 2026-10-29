'use client';

/**
 * Step 5: one row for each calendar provider the app can connect (Google, Outlook, Apple iCloud),
 * with the same connect flows as Settings › Calendar. Google and Outlook connect by leaving the
 * app for the provider's sign-in page and coming back, so the wizard notes which step to reopen on.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Link2 } from 'lucide-react';
import { Button, useToast } from '@neutrino/ui';
import { calendarApi, type ConnectionProvider, type CreateAppleConnectionRequest } from '@/lib/api';
import { AppleConnectModal } from '@/app/(apps)/settings/AppleConnectModal';
import { PROVIDER_LABELS, connectFailureMessage } from '@/app/(apps)/settings/connectErrors';
import { rememberReturnStep } from '../autoStart';
import { useStep } from '../stepApi';
import styles from './Steps.module.css';

const PROVIDERS: ConnectionProvider[] = ['google', 'outlook', 'apple'];

const DESCRIPTIONS: Record<ConnectionProvider, string> = {
  google: 'Sync via Google Calendar API',
  outlook: 'Sync via Microsoft Graph API',
  apple: 'Sync via CalDAV',
};

export function CalendarStep() {
  const { markDone } = useStep();
  const qc = useQueryClient();
  const toast = useToast();
  const [appleOpen, setAppleOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['calendar-connections'],
    queryFn: () => calendarApi.listConnections(),
  });
  const connections = data?.connections ?? [];

  // Coming back from a provider with an account connected counts as having done the step.
  const noted = useRef(false);
  useEffect(() => {
    if (connections.length > 0 && !noted.current) {
      noted.current = true;
      markDone();
    }
  }, [connections.length, markDone]);

  const leaveFor = (authUrl: string) => {
    rememberReturnStep('calendar');
    window.location.href = authUrl;
  };

  const connectGoogle = useMutation({
    mutationFn: () => calendarApi.connectGoogle(),
    onSuccess: ({ authUrl }) => leaveFor(authUrl),
    onError: (err) => toast.error(connectFailureMessage('google', err)),
  });
  const connectOutlook = useMutation({
    mutationFn: () => calendarApi.connectOutlook(),
    onSuccess: ({ authUrl }) => leaveFor(authUrl),
    onError: (err) => toast.error(connectFailureMessage('outlook', err)),
  });
  const connectApple = useMutation({
    mutationFn: (req: CreateAppleConnectionRequest) => calendarApi.connectApple(req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendar-connections'] });
      void qc.invalidateQueries({ queryKey: ['calendars'] });
      setAppleOpen(false);
      markDone();
    },
    onError: (err) => toast.error(connectFailureMessage('apple', err)),
  });

  const connect = (provider: ConnectionProvider) => {
    if (provider === 'google') connectGoogle.mutate();
    else if (provider === 'outlook') connectOutlook.mutate();
    else setAppleOpen(true);
  };
  const pending = (provider: ConnectionProvider) =>
    (provider === 'google' && connectGoogle.isPending) || (provider === 'outlook' && connectOutlook.isPending);

  return (
    <div className={styles.stack}>
      <div className={styles.providers} aria-busy={isLoading}>
        {PROVIDERS.map((provider) => {
          const connection = connections.find((c) => c.provider === provider);
          return (
            <div key={provider} className={styles.provider} data-provider={provider}>
              <div className={styles.providerInfo}>
                <div className={styles.providerName}>{PROVIDER_LABELS[provider]}</div>
                <div className={styles.providerDetail}>
                  {connection?.email ? connection.email : connection ? 'Connected' : DESCRIPTIONS[provider]}
                </div>
              </div>
              {connection ? (
                <span className={styles.connected}><Check size={14} aria-hidden="true" /> Connected</span>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  icon={<Link2 size={14} />}
                  loading={pending(provider)}
                  onClick={() => connect(provider)}
                  aria-label={`Connect ${PROVIDER_LABELS[provider]}`}
                >
                  Connect
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <p className={styles.hint}>
        Have an .ics file instead? Drop it on the calendar any time.
      </p>

      {appleOpen && (
        <AppleConnectModal
          onClose={() => setAppleOpen(false)}
          onConnect={(req) => connectApple.mutate(req)}
          isPending={connectApple.isPending}
        />
      )}
    </div>
  );
}
