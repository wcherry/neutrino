'use client';

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Checkbox, Modal, ModalBody, ModalFooter, Select, Textarea, TextInput, useToast } from '@neutrino/ui';
import { AtlasLog, VaultIndex, dailyNotePath, logLine, type FolderSnapshot, type Template } from '@neutrino/atlas';
import type { AtlasModel } from './atlasModel';
import styles from './atlas.module.css';

/**
 * Atlas's settings, the Mac's Settings window: daily notes, templates, the images folder. Kept
 * in this browser for this account, as names and patterns only.
 */
export function SettingsDialog({ model, onClose }: { model: AtlasModel; onClose(): void }) {
  const [daily, setDaily] = useState(model.dailyNotes);
  const [onLaunch, setOnLaunch] = useState(model.openTodayOnLaunch);
  const [templates, setTemplates] = useState(model.templatesFolder);
  const [attachments, setAttachments] = useState(model.attachmentsFolder);
  const today = dailyNotePath(daily, new Date());
  const save = () => {
    model.dailyNotes = { folder: daily.folder.trim(), format: daily.format.trim() || 'yyyy-MM-dd', template: daily.template };
    model.openTodayOnLaunch = onLaunch;
    model.templatesFolder = templates;
    model.attachmentsFolder = attachments.trim() || 'Attachments';
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Atlas settings" size="md">
      <ModalBody>
        <div className={styles.settings}>
          <h3>Daily notes</h3>
          <Checkbox label="Open today's note when a vault opens" checked={onLaunch} onChange={(e) => setOnLaunch(e.target.checked)} />
          <TextInput label="Folder" placeholder="The vault's root" value={daily.folder} onChange={(e) => setDaily({ ...daily, folder: e.target.value })} fullWidth />
          <TextInput
            label="File name"
            hint={`A Unicode date pattern. Today's note is ${today}.`}
            value={daily.format}
            onChange={(e) => setDaily({ ...daily, format: e.target.value })}
            fullWidth
          />
          <Textarea
            label="Template"
            hint="{{date}}, {{title}} and {{date:EEEE d MMMM}} are filled in. Keep {{time}} out: two devices creating the same day before syncing would make two versions."
            value={daily.template}
            rows={4}
            onChange={(e) => setDaily({ ...daily, template: e.target.value })}
          />
          <h3>Templates</h3>
          <TextInput
            label="Folder"
            hint="Its pages are offered by New page from a template, and in the / menu, along with a built-in Meeting template."
            placeholder="Templates"
            value={templates}
            onChange={(e) => setTemplates(e.target.value)}
            fullWidth
          />
          <h3>Images</h3>
          <TextInput
            label="Folder"
            hint="Images pasted, dropped or inserted are saved here, encrypted, and uploaded to Neutrino Drive."
            placeholder="Attachments"
            value={attachments}
            onChange={(e) => setAttachments(e.target.value)}
            fullWidth
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save</Button>
      </ModalFooter>
    </Modal>
  );
}

/** A new page from a template, given its title first so `{{title}}` can be filled in. */
export function TemplateDialog({ model, onClose }: { model: AtlasModel; onClose(): void }) {
  const choices = useMemo(() => model.templates(), [model]);
  const [title, setTitle] = useState('');
  const [chosen, setChosen] = useState<Template | null>(choices[0] ?? null);
  const create = () => {
    if (!chosen) return;
    onClose();
    void model.newPageFromTemplate(chosen, title);
  };
  return (
    <Modal open onClose={onClose} title="New page from a template" size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <ModalBody>
          <TextInput autoFocus label="Title" placeholder="Untitled" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />
          <ul className={styles.quickList} role="listbox" aria-label="Templates">
            {choices.map((t) => (
              <li key={t.path ?? `built-in:${t.name}`}>
                <button type="button" role="option" aria-selected={chosen === t} onClick={() => setChosen(t)}>
                  {t.name}
                  <small>{t.path ?? 'Built in'}</small>
                </button>
              </li>
            ))}
          </ul>
          <p className={styles.quickHint}>
            Pages in “{model.templatesFolder}” are templates. {'{{title}}'}, {'{{date}}'}, {'{{time}}'} and {'{{date:FORMAT}}'} are filled in.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!chosen}>Create</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** Asks where a picked folder goes before importing it. */
export function ImportDialog({ model, snapshot, name, onClose }: { model: AtlasModel; snapshot: FolderSnapshot; name: string; onClose(): void }) {
  const [ownFolder, setOwnFolder] = useState(true);
  return (
    <Modal open onClose={onClose} title={`Import “${name}”?`} size="sm">
      <ModalBody>
        <p className={styles.subtitle}>
          {snapshot.files.length} file{snapshot.files.length === 1 ? '' : 's'} will be copied into this vault, encrypted. The folder itself isn&rsquo;t
          changed, and nothing in the vault is overwritten: a page with another page&rsquo;s name goes beside it.
          {snapshot.tooLarge.length > 0 && ` ${snapshot.tooLarge.length} over 100 MB will be left out.`}
        </p>
        <Checkbox label="Put it in a folder of its own, named after it" checked={ownFolder} onChange={(e) => setOwnFolder(e.target.checked)} />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          disabled={snapshot.files.length === 0}
          onClick={() => {
            onClose();
            void model.importFolder(snapshot, name, ownFolder ? name : '');
          }}
        >
          Import
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** This tab's log, the Mac's Show Logs: file names, ids, counts and errors, never page content. Copy or Save to send it on. */
export function LogsDialog({ onClose }: { onClose(): void }) {
  const toast = useToast();
  useSyncExternalStore(AtlasLog.subscribe, () => AtlasLog.entries().length, () => 0);
  const [query, setQuery] = useState('');
  const [minimum, setMinimum] = useState<'all' | 'problems'>('all');
  const lines = AtlasLog.entries()
    .filter((e) => minimum === 'all' || e.level !== 'info')
    .map(logLine)
    .filter((l) => query === '' || l.toLowerCase().includes(query.toLowerCase()));
  const end = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Braced: newer browsers' scrollIntoView answers a promise, which an effect mustn't return.
    void end.current?.scrollIntoView?.({ block: 'end' });
  }, [lines.length]);
  const text = lines.join('\n');
  return (
    <Modal open onClose={onClose} title="Atlas logs" size="lg">
      <ModalBody>
        <div className={styles.logFilter}>
          <TextInput aria-label="Filter" placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} fullWidth />
          <Select
            aria-label="Show"
            value={minimum}
            onChange={(e) => setMinimum(e.target.value as 'all' | 'problems')}
            options={[{ value: 'all', label: 'Everything' }, { value: 'problems', label: 'Problems only' }]}
          />
        </div>
        <pre className={styles.logs} aria-label="Log">
          {text || 'Nothing logged yet.'}
          <div ref={end} />
        </pre>
        <p className={styles.quickHint}>This tab&rsquo;s log, in memory only: file names, ids, counts and errors. Nothing in it is page content.</p>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="secondary"
          onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success('Copied the log'), () => toast.error("Couldn't copy the log."))}
        >
          Copy
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Atlas log.txt';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          }}
        >
          Save…
        </Button>
        <Button onClick={onClose}>Done</Button>
      </ModalFooter>
    </Modal>
  );
}

/** Today's note, or another day's: a date to pick. */
export function DayDialog({ model, onClose }: { model: AtlasModel; onClose(): void }) {
  const two = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const [value, setValue] = useState(`${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`);
  const [y, m, d] = value.split('-').map(Number);
  const date = y && m && d ? new Date(y, m - 1, d) : null;
  return (
    <Modal open onClose={onClose} title="Open a day's note" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!date) return;
          onClose();
          void model.openDailyNote(date);
        }}
      >
        <ModalBody>
          <TextInput autoFocus type="date" label="Day" value={value} onChange={(e) => setValue(e.target.value)} fullWidth />
          <p className={styles.quickHint}>{date ? VaultIndex.title(dailyNotePath(model.dailyNotes, date)) : 'Choose a day.'}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!date}>Open</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
