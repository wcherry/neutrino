'use client';

import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Check, X, Users, ChevronRight } from 'lucide-react';
import { suggestionsApi, type SuggestionResponse } from '@/lib/api';
import styles from './SuggestionsPanel.module.css';

function SuggestionCard({
  suggestion,
  onAccept,
  onReject,
  accepting,
  rejecting,
}: {
  suggestion: SuggestionResponse;
  onAccept: () => void;
  onReject: () => void;
  accepting: boolean;
  rejecting: boolean;
}) {
  const faceSrc =
    suggestion.faceThumbnail && suggestion.faceThumbnailMimeType
      ? `data:${suggestion.faceThumbnailMimeType};base64,${suggestion.faceThumbnail}`
      : null;
  const personSrc =
    suggestion.personThumbnail && suggestion.personThumbnailMimeType
      ? `data:${suggestion.personThumbnailMimeType};base64,${suggestion.personThumbnail}`
      : null;
  const confidence = Math.round(suggestion.confidence * 100);

  return (
    <div className={styles.card}>
      <div className={styles.cardFaceSection}>
        {faceSrc ? (
          <img src={faceSrc} alt="Detected face" className={styles.faceThumbnail} />
        ) : (
          <div className={styles.facePlaceholder}>
            <Users size={20} />
          </div>
        )}
      </div>

      <div className={styles.cardArrow}>
        <ChevronRight size={14} className={styles.arrowIcon} />
      </div>

      <div className={styles.cardPersonSection}>
        {personSrc ? (
          <img src={personSrc} alt={suggestion.personName ?? 'Person'} className={styles.personThumbnail} />
        ) : (
          <div className={styles.personPlaceholder}>
            <Users size={20} />
          </div>
        )}
        <span className={styles.personName}>
          {suggestion.personName ?? 'Unknown person'}
        </span>
        <span className={styles.confidence}>{confidence}% match</span>
      </div>

      <div className={styles.cardActions}>
        <button
          className={styles.acceptBtn}
          onClick={onAccept}
          disabled={accepting || rejecting}
          title="Accept — assign this face to the person"
        >
          <Check size={14} />
        </button>
        <button
          className={styles.rejectBtn}
          onClick={onReject}
          disabled={accepting || rejecting}
          title="Reject — this is not the same person"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export function SuggestionsBadge() {
  const { data } = useQuery({
    queryKey: ['suggestions'],
    queryFn: () => suggestionsApi.listSuggestions(),
    refetchInterval: 30_000,
  });
  const count = data?.total ?? 0;
  if (count === 0) return null;
  return (
    <span className={styles.badge} aria-label={`${count} suggestions`}>
      {count > 9 ? '9+' : count}
    </span>
  );
}

export function SuggestionsPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['suggestions'],
    queryFn: () => suggestionsApi.listSuggestions(),
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => suggestionsApi.acceptSuggestion(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      queryClient.invalidateQueries({ queryKey: ['persons'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => suggestionsApi.rejectSuggestion(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suggestions'] }),
  });

  const suggestions = data?.suggestions ?? [];

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>
          <Sparkles size={16} />
          <span>Suggestions</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <p className={styles.panelHint}>
        These faces may belong to people already in your library. Accept or reject each match.
      </p>

      {isLoading ? (
        <div className={styles.empty}>Loading…</div>
      ) : suggestions.length === 0 ? (
        <div className={styles.empty}>
          <Sparkles size={32} className={styles.emptyIcon} />
          <p>No suggestions right now.</p>
          <p className={styles.emptyHint}>
            Upload more photos with known people and suggestions will appear here.
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {suggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              onAccept={() => acceptMutation.mutate(s.id)}
              onReject={() => rejectMutation.mutate(s.id)}
              accepting={acceptMutation.isPending && acceptMutation.variables === s.id}
              rejecting={rejectMutation.isPending && rejectMutation.variables === s.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
