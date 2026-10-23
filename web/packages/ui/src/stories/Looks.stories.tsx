import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Copy, Download, FileText, Pencil, Share2, Sheet, Trash2 } from 'lucide-react';
import { Button } from '../components/primitives/Button';
import { Chip } from '../components/inputs/Chip';
import { TextInput } from '../components/inputs/TextInput';
import { Select } from '../components/inputs/Select';
import { Textarea } from '../components/inputs/Textarea';
import { Menu, MenuItem, MenuSeparator } from '../components/navigation/Menu';
import { Tabs, TabList, Tab } from '../components/containers/Tabs';
import { Toast } from '../components/feedback/Toast';

/*
 * Every primitive in every look, side by side — the LF2 exit check
 * (agent_docs/ui-look-and-feel-roadmap.md §6): each column sets `data-look` (and the theme) on
 * its own wrapper, which is all a look is, so the same components render four ways at once.
 * Menus and toasts sit over a busy backdrop so the frosting in the new looks is visible.
 * Dialogs portal to <body>, so they follow the toolbar's Look switch instead (Containers/Modal).
 */

const LOOKS = [
  { id: 'classic', label: 'Classic (today)' },
  { id: 'lightflow', label: 'Light Flow' },
  { id: 'precision', label: 'Quiet Precision' },
  { id: 'blended', label: 'Blended Flow' },
] as const;

const column: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-5)',
  padding: 'var(--space-5)',
  minWidth: 300,
  background: 'var(--surface-ground)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-sans)',
};

const heading: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-secondary)',
};

// Stripes in the app colours: enough detail behind a menu that a blur reads as a blur.
const backdrop: React.CSSProperties = {
  position: 'relative',
  padding: 'var(--space-4)',
  borderRadius: 'var(--radius-lg)',
  background:
    'repeating-linear-gradient(135deg, var(--app-color-docs) 0 14px, var(--app-color-sheets) 14px 28px, var(--app-color-slides) 28px 42px, var(--app-color-photos) 42px 56px)',
};

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <h3 style={heading}>{title}</h3>
      {children}
    </section>
  );
}

function Gallery({ look, theme }: { look: string; theme: 'light' | 'dark' }) {
  return (
    <div data-look={look} data-theme={theme} data-app="drive" style={column}>
      <h2 style={{ margin: 0, fontSize: 'var(--text-base)' }}>{LOOKS.find((l) => l.id === look)!.label}</h2>

      <Section title="Buttons">
        <Row>
          <Button variant="primary">New</Button>
          <Button variant="secondary">Upload</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete</Button>
        </Row>
        <Row>
          <Button variant="primary" icon={<Share2 size={14} />}>Share</Button>
          <Button variant="secondary" disabled>Disabled</Button>
        </Row>
      </Section>

      <Section title="Fields">
        <TextInput label="File name" placeholder="Untitled document" />
        <Select
          label="Sort by"
          options={[{ value: 'name', label: 'Name' }, { value: 'modified', label: 'Last modified' }]}
          defaultValue="modified"
        />
        <Textarea label="Note" placeholder="Add a note…" rows={2} />
      </Section>

      <Section title="Chips">
        <Row>
          <Chip selected>All</Chip>
          <Chip icon={<FileText size={14} />}>Docs</Chip>
          <Chip icon={<Sheet size={14} />} count={12}>Sheets</Chip>
          <Chip disabled>Videos</Chip>
        </Row>
      </Section>

      <Section title="Tabs">
        <Tabs defaultTab="files">
          <TabList>
            <Tab id="files">Files</Tab>
            <Tab id="shared">Shared</Tab>
            <Tab id="activity">Activity</Tab>
          </TabList>
        </Tabs>
      </Section>

      <Section title="Menu (frosted in the new looks)">
        <div style={backdrop}>
          <div
            style={{
              width: 220,
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--menu-radius)',
              boxShadow: 'var(--glass-shadow)',
              backdropFilter: 'var(--glass-filter)',
              WebkitBackdropFilter: 'var(--glass-filter)',
            }}
          >
            <Menu aria-label={`File actions, ${look}`}>
              <MenuItem id="open" label="Open" icon={<FileText size={14} />} active onClick={() => {}} />
              <MenuItem id="rename" label="Rename" icon={<Pencil size={14} />} shortcut="F2" onClick={() => {}} />
              <MenuItem id="copy" label="Make a copy" icon={<Copy size={14} />} onClick={() => {}} />
              <MenuItem id="download" label="Download" icon={<Download size={14} />} onClick={() => {}} />
              <MenuSeparator />
              <MenuItem id="delete" label="Move to trash" icon={<Trash2 size={14} />} danger onClick={() => {}} />
            </Menu>
          </div>
        </div>
      </Section>

      <Section title="Toast">
        <div style={backdrop}>
          <Toast
            id={`toast-${look}`}
            variant="success"
            title="Uploaded"
            message="Encrypted on this device before upload."
            duration={0}
            onClose={() => {}}
          />
        </div>
      </Section>
    </div>
  );
}

function AllLooks({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      {LOOKS.map((l) => <Gallery key={l.id} look={l.id} theme={theme} />)}
    </div>
  );
}

const meta: Meta = {
  title: 'Looks/All primitives',
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj;

export const Light: Story = { render: () => <AllLooks theme="light" /> };
export const Dark: Story = { render: () => <AllLooks theme="dark" /> };
