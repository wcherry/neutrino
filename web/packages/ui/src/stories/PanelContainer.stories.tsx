import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { PanelContainer, type PanelTab } from '../components/containers/PanelContainer';
import { Button } from '../components/primitives/Button';

const meta: Meta<typeof PanelContainer> = {
  title: 'Containers/PanelContainer',
  component: PanelContainer,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
  argTypes: {
    defaultLocation: {
      control: 'select',
      options: ['left', 'right', 'bottom', 'float'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_CONTENT = (
  <div style={{ padding: '12px 16px' }}>
    {Array.from({ length: 12 }, (_, i) => (
      <p key={i} style={{ margin: '0 0 0.75rem', fontSize: 13, color: 'var(--color-text-secondary)' }}>
        Panel body content row {i + 1}. This line demonstrates scrollable body behaviour when
        content exceeds the available panel height.
      </p>
    ))}
  </div>
);

const SAMPLE_FOOTER = (
  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
    <Button variant="secondary" size="sm">Cancel</Button>
    <Button variant="primary" size="sm">Apply</Button>
  </div>
);

function DockWrapper({
  location,
  children,
}: {
  location: 'left' | 'right' | 'bottom';
  children: React.ReactNode;
}) {
  const isHorizontal = location === 'left' || location === 'right';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        height: '480px',
        width: '100%',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {location === 'right' && (
        <div style={{ flex: 1, padding: 16, background: 'var(--color-bg-subtle)', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Main content area
        </div>
      )}
      {children}
      {(location === 'left' || location === 'bottom') && (
        <div style={{ flex: 1, padding: 16, background: 'var(--color-bg-subtle)', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Main content area
        </div>
      )}
    </div>
  );
}

export const RightPanel: Story = {
  render: () => {
    const [closed, setClosed] = React.useState(false);
    if (closed) {
      return (
        <div style={{ padding: 16 }}>
          <Button onClick={() => setClosed(false)}>Reopen panel</Button>
        </div>
      );
    }
    return (
      <DockWrapper location="right">
        <PanelContainer
          title="Properties"
          defaultLocation="right"
          width={280}
          onClose={() => setClosed(true)}
          footer={SAMPLE_FOOTER}
          headerActions={<Button variant="ghost" size="sm">Reset</Button>}
        >
          {SAMPLE_CONTENT}
        </PanelContainer>
      </DockWrapper>
    );
  },
};

export const LeftPanel: Story = {
  render: () => {
    const [closed, setClosed] = React.useState(false);
    if (closed) {
      return (
        <div style={{ padding: 16 }}>
          <Button onClick={() => setClosed(false)}>Reopen panel</Button>
        </div>
      );
    }
    return (
      <DockWrapper location="left">
        <PanelContainer
          title="Navigator"
          defaultLocation="left"
          width={240}
          onClose={() => setClosed(true)}
        >
          {SAMPLE_CONTENT}
        </PanelContainer>
      </DockWrapper>
    );
  },
};

export const BottomPanel: Story = {
  render: () => {
    const [closed, setClosed] = React.useState(false);
    if (closed) {
      return (
        <div style={{ padding: 16 }}>
          <Button onClick={() => setClosed(false)}>Reopen panel</Button>
        </div>
      );
    }
    return (
      <DockWrapper location="bottom">
        <PanelContainer
          title="Output"
          defaultLocation="bottom"
          height={200}
          onClose={() => setClosed(true)}
          footer={SAMPLE_FOOTER}
        >
          {SAMPLE_CONTENT}
        </PanelContainer>
      </DockWrapper>
    );
  },
};

export const FloatingPanel: Story = {
  render: () => {
    const [closed, setClosed] = React.useState(false);
    if (closed) {
      return (
        <div style={{ padding: 16 }}>
          <Button onClick={() => setClosed(false)}>Reopen panel</Button>
        </div>
      );
    }
    return (
      <div style={{ position: 'relative', height: 480, background: 'var(--color-bg-subtle)', borderRadius: 8 }}>
        <div style={{ padding: 16, fontSize: 13, color: 'var(--color-text-muted)' }}>
          Background content — floating panel overlays this
        </div>
        <div style={{ position: 'absolute', top: 40, left: 40 }}>
          <PanelContainer
            title="Floating Tools"
            defaultLocation="float"
            width={260}
            height={300}
            onClose={() => setClosed(true)}
            footer={SAMPLE_FOOTER}
            headerActions={<Button variant="ghost" size="sm">Help</Button>}
          >
            {SAMPLE_CONTENT}
          </PanelContainer>
        </div>
      </div>
    );
  },
};

export const LocationSwitcher: Story = {
  name: 'Interactive — location switcher',
  render: () => {
    const [location, setLocation] = React.useState<'left' | 'right' | 'bottom' | 'float'>('right');
    const isBottom = location === 'bottom';
    const isFloat = location === 'float';

    return (
      <div style={{ position: 'relative', display: 'flex', flexDirection: isBottom ? 'column' : 'row', height: 480, border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
        {(location === 'right' || isBottom) && (
          <div style={{ flex: 1, padding: 16, background: 'var(--color-bg-subtle)', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Main content area — use the location picker in the panel header to dock or float
          </div>
        )}
        {isFloat ? (
          <>
            <div style={{ flex: 1, padding: 16, background: 'var(--color-bg-subtle)', fontSize: 13, color: 'var(--color-text-muted)' }}>
              Main content area — use the location picker in the panel header to dock or float
            </div>
            <div style={{ position: 'absolute', top: 40, left: 40 }}>
              <PanelContainer
                title="Panel"
                location={location}
                onLocationChange={setLocation}
                width={260}
                height={300}
                footer={SAMPLE_FOOTER}
              >
                {SAMPLE_CONTENT}
              </PanelContainer>
            </div>
          </>
        ) : (
          <PanelContainer
            title="Panel"
            location={location}
            onLocationChange={setLocation}
            width={location === 'bottom' ? undefined : 280}
            height={location === 'bottom' ? 200 : undefined}
            footer={SAMPLE_FOOTER}
          >
            {SAMPLE_CONTENT}
          </PanelContainer>
        )}
        {location === 'left' && (
          <div style={{ flex: 1, padding: 16, background: 'var(--color-bg-subtle)', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Main content area — use the location picker in the panel header to dock or float
          </div>
        )}
      </div>
    );
  },
};

export const MinimizedByDefault: Story = {
  render: () => (
    <DockWrapper location="right">
      <PanelContainer
        title="Properties"
        defaultLocation="right"
        defaultMinimized
        width={280}
        footer={SAMPLE_FOOTER}
      >
        {SAMPLE_CONTENT}
      </PanelContainer>
    </DockWrapper>
  ),
};

export const NoFooter: Story = {
  render: () => (
    <DockWrapper location="right">
      <PanelContainer title="Inspector" defaultLocation="right" width={280}>
        {SAMPLE_CONTENT}
      </PanelContainer>
    </DockWrapper>
  ),
};

// ── Multi-tab stories ──────────────────────────────────────────────────────

function makeContent(label: string, rows = 10) {
  return (
    <div style={{ padding: '12px 16px' }}>
      {Array.from({ length: rows }, (_, i) => (
        <p key={i} style={{ margin: '0 0 0.75rem', fontSize: 13, color: 'var(--color-text-secondary)' }}>
          [{label}] row {i + 1}
        </p>
      ))}
    </div>
  );
}

const SAMPLE_TABS: PanelTab[] = [
  {
    id: 'properties',
    title: 'Properties',
    content: makeContent('Properties'),
    footer: (
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="secondary" size="sm">Reset</Button>
        <Button variant="primary" size="sm">Apply</Button>
      </div>
    ),
  },
  {
    id: 'styles',
    title: 'Styles',
    content: makeContent('Styles', 6),
  },
  {
    id: 'events',
    title: 'Events',
    content: makeContent('Events', 4),
    footer: (
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="ghost" size="sm">Clear all</Button>
      </div>
    ),
  },
];

export const MultiTabRight: Story = {
  name: 'Multi-tab — right panel',
  render: () => (
    <DockWrapper location="right">
      <PanelContainer
        tabs={SAMPLE_TABS}
        defaultLocation="right"
        width={280}
      />
    </DockWrapper>
  ),
};

export const MultiTabMinimizedRight: Story = {
  name: 'Multi-tab — minimized (right)',
  render: () => (
    <DockWrapper location="right">
      <PanelContainer
        tabs={SAMPLE_TABS}
        defaultLocation="right"
        defaultMinimized
        width={280}
      />
    </DockWrapper>
  ),
};

export const MultiTabBottom: Story = {
  name: 'Multi-tab — bottom panel',
  render: () => (
    <DockWrapper location="bottom">
      <PanelContainer
        tabs={SAMPLE_TABS}
        defaultLocation="bottom"
        height={200}
      />
    </DockWrapper>
  ),
};

export const MultiTabMinimizedBottom: Story = {
  name: 'Multi-tab — minimized (bottom)',
  render: () => (
    <DockWrapper location="bottom">
      <PanelContainer
        tabs={SAMPLE_TABS}
        defaultLocation="bottom"
        defaultMinimized
        height={200}
      />
    </DockWrapper>
  ),
};

export const SideTabsLeft: Story = {
  name: 'Side tabs — left strip',
  render: () => (
    <DockWrapper location="right">
      <PanelContainer
        tabs={SAMPLE_TABS}
        tabsSide="left"
        defaultLocation="right"
        width={300}
      />
    </DockWrapper>
  ),
};

export const SideTabsRight: Story = {
  name: 'Side tabs — right strip',
  render: () => (
    <DockWrapper location="left">
      <PanelContainer
        tabs={SAMPLE_TABS}
        tabsSide="right"
        defaultLocation="left"
        width={300}
      />
    </DockWrapper>
  ),
};
