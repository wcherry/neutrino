'use client';

import React, { useId, useRef, useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import { splitTags, suggestTags } from './tags';
import styles from './page.module.css';

/** Enough to pick from without the list running off the modal. */
const MAX_SUGGESTIONS = 8;

export interface TagInputProps {
  id: string;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  /** What is typed but not yet a chip. The editor's Save adds it too, so nothing typed is lost. */
  draft: string;
  onDraftChange: (draft: string) => void;
  /** Every tag in use, in the order to offer them. */
  known: string[];
}

/**
 * A task's tags: the chosen ones as removable chips, a field to type one, and
 * a dropdown of the tags already in use that match what is typed.
 *
 * The dropdown narrows the choice rather than restricting it: Enter, a space
 * or a comma adds exactly what was typed, so a brand-new tag is as easy as an
 * existing one. ↑/↓ move through the dropdown and Enter picks the highlighted
 * tag; Backspace in an empty field removes the last chip.
 */
export default function TagInput({ id, tags, onTagsChange, draft, onDraftChange, known }: TagInputProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  /** Nothing is highlighted until an arrow key is pressed, so Enter keeps what was typed. */
  const [active, setActive] = useState(-1);

  const suggestions = suggestTags(draft, known, tags).slice(0, MAX_SUGGESTIONS);
  const typed = splitTags(draft).at(-1);
  const newTag = typed && !tags.includes(typed) && !suggestions.includes(typed) ? typed : null;
  const options = newTag ? [...suggestions, newTag] : suggestions;
  const showList = open && options.length > 0;

  function add(toAdd: string[]) {
    const next = [...tags];
    for (const tag of toAdd) if (!next.includes(tag)) next.push(tag);
    if (next.length !== tags.length) onTagsChange(next);
  }

  function pick(tag: string) {
    add([tag]);
    onDraftChange('');
    setActive(-1);
    inputRef.current?.focus();
  }

  function handleChange(text: string) {
    setOpen(true);
    setActive(-1);
    // A separator finishes the tag before it, as the old free-text field split
    // on spaces and commas.
    const match = /[\s,](?=[^\s,]*$)/.exec(text);
    if (!match) {
      onDraftChange(text);
      return;
    }
    add(splitTags(text.slice(0, match.index)));
    onDraftChange(text.slice(match.index + 1));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (options.length === 0) return;
        e.preventDefault();
        setOpen(true);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        // Cycles through the options and back to none, so the typed text can be
        // returned to.
        const states = options.length + 1;
        setActive((i) => ((i + 1 + step + states) % states) - 1);
        break;
      }
      case 'Enter': {
        const chosen = showList && active >= 0 ? options[active] : null;
        if (chosen) {
          e.preventDefault();
          pick(chosen);
        } else if (splitTags(draft).length > 0) {
          // Adds the tag rather than submitting the task form.
          e.preventDefault();
          add(splitTags(draft));
          onDraftChange('');
        }
        break;
      }
      case 'Escape':
        if (showList) {
          // Closes the dropdown, not the modal around it.
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setActive(-1);
        }
        break;
      case 'Backspace':
        if (draft === '' && tags.length > 0) onTagsChange(tags.slice(0, -1));
        break;
    }
  }

  return (
    <div className={styles.tagInput}>
      <div className={styles.tagInputBox} onClick={() => inputRef.current?.focus()}>
        {tags.map((tag) => (
          <span key={tag} className={styles.tagChip}>
            #{tag}
            <button
              type="button"
              className={styles.tagChipRemove}
              aria-label={`Remove ${tag}`}
              onClick={(e) => {
                e.stopPropagation();
                onTagsChange(tags.filter((t) => t !== tag));
              }}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          className={styles.tagInputField}
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          placeholder={tags.length === 0 ? '#errands #home' : ''}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        />
      </div>
      {showList && (
        <ul id={listId} role="listbox" aria-label="Tags in use" className={styles.tagSuggestions}>
          {options.map((tag, i) => (
            <li
              key={tag}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`${styles.tagSuggestion} ${i === active ? styles.tagSuggestionActive : ''}`}
              // Before the input's blur, which would close the list under the click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(tag)}
              onMouseEnter={() => setActive(i)}
            >
              {tag === newTag ? (
                <>
                  <Plus size={12} /> Add “#{tag}”
                </>
              ) : (
                <>
                  <Tag size={12} /> #{tag}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
