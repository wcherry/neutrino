import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { History, ListTree, Layers, MessageSquare, Palette, Terminal } from 'lucide-react';
import { RailWorkspace, type RailPane } from '../components/rails/RailWorkspace';
import type { RailLayout } from '../components/rails/railLayout';

/*
 * Rails of panes around an editor's view. Click a tab to open its pane and again to collapse it;
 * drag a tab to another rail, or out over the page to float it; the ⋯ menu does the same moves.
 * Switch the Look in the toolbar: rails read the editor-chrome tokens, so they sit on the
 * surface each look gives an editor.
 */

const meta: Meta<typeof RailWorkspace> = {
  title: 'Containers/RailWorkspace',
  component: RailWorkspace,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof meta>;

const body = (lines: string[]) => (
  <div style={{ padding: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
    {lines.map((l) => (
      <p key={l} style={{ margin: '0 0 var(--space-2)' }}>{l}</p>
    ))}
  </div>
);

const PANES: RailPane[] = [
  { id: 'outline', title: 'Outline', icon: <ListTree size={14} />, side: 'left', content: body(['Introduction', 'Methods', 'Results', 'Discussion']) },
  { id: 'layers', title: 'Layers', icon: <Layers size={14} />, side: 'left', content: body(['Header', 'Body text', 'Footnotes']) },
  { id: 'comments', title: 'Comments', icon: <MessageSquare size={14} />, side: 'right', content: body(['William: Test 123', 'Ada: Looks good']) },
  { id: 'history', title: 'Version history', icon: <History size={14} />, side: 'right', content: body(['Today, 15:02', 'Yesterday, 09:41']) },
  { id: 'style', title: 'Style', icon: <Palette size={14} />, side: 'top', content: body(['Theme: Default', 'Font: Inter']) },
  { id: 'console', title: 'Console', icon: <Terminal size={14} />, side: 'bottom', content: body(['Saved and encrypted · just now']) },
];

function Page() {
  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--editor-ground, var(--color-bg-subtle))', padding: 'var(--space-6)' }}>
      <div
        style={{
          maxWidth: 640,
          margin: '0 auto',
          minHeight: 600,
          padding: 'var(--space-8)',
          background: 'var(--color-surface)',
          boxShadow: 'var(--editor-paper-shadow, var(--shadow-md))',
          color: 'var(--color-text)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <h1 style={{ marginTop: 0 }}>Introduction</h1>
        <p>The rails around this page hold the editor’s panes. Drag a tab to move it.</p>
      </div>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div style={{ height: '100vh', background: 'var(--surface-ground, var(--color-bg))' }}>{children}</div>;
}

/** Two side rails, as Docs has today: outline on the left, comments on the right. */
export const SideRails: Story = {
  render: () => (
    <Frame>
      <RailWorkspace panes={PANES.filter((p) => p.side === 'left' || p.side === 'right')} sides={['left', 'right']} defaultExpanded={{ left: 'outline', right: 'comments' }}>
        <Page />
      </RailWorkspace>
    </Frame>
  ),
};

/** A rail on every side; top and bottom tabs read across. */
export const AllSides: Story = {
  render: () => (
    <Frame>
      <RailWorkspace panes={PANES} sides={['left', 'right', 'top', 'bottom']} defaultExpanded={{ left: 'outline', bottom: 'console' }}>
        <Page />
      </RailWorkspace>
    </Frame>
  ),
};

/** A pane floating over the page; closing it returns it to the right rail. */
export const Floating: Story = {
  render: () => (
    <Frame>
      <RailWorkspace
        panes={PANES.filter((p) => p.side === 'left' || p.side === 'right')}
        sides={['left', 'right']}
        defaultLayout={{
          version: 1,
          rails: { left: { panes: ['outline', 'layers'], expanded: 'outline' }, right: { panes: ['comments'], expanded: null } },
          floating: { history: { rect: { x: 360, y: 80, width: 300, height: 260 }, home: 'right', homeIndex: 1 } },
          sizes: {},
        }}
      >
        <Page />
      </RailWorkspace>
    </Frame>
  ),
};

/** Controlled, with the layout an app would store shown beside it. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const [layout, setLayout] = useState<RailLayout | null>(null);
    return (
      <Frame>
        <RailWorkspace panes={PANES} sides={['left', 'right', 'bottom']} layout={layout} onLayoutChange={setLayout} defaultExpanded={{ left: 'outline' }}>
          <pre style={{ margin: 0, padding: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text)', overflow: 'auto', height: '100%' }}>
            {JSON.stringify(layout, null, 2) ?? 'null — nothing stored yet'}
          </pre>
        </RailWorkspace>
      </Frame>
    );
  },
};
