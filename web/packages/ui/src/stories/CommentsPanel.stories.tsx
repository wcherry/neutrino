import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CommentsPanel, type CommentItem } from '../components/panels/CommentsPanel';

const meta: Meta<typeof CommentsPanel> = {
  title: 'Panels/CommentsPanel',
  component: CommentsPanel,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_COMMENTS: CommentItem[] = [
  {
    id: '1',
    userName: 'Alice Johnson',
    body: 'Can we revisit the color scheme here? The contrast ratio may not meet WCAG AA.',
    status: 'open',
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    replies: [
      {
        id: 'r1',
        userName: 'Bob Smith',
        body: "Good catch — I'll update the palette.",
        createdAt: new Date(Date.now() - 1_800_000).toISOString(),
      },
    ],
  },
  {
    id: '2',
    userName: 'Carol White',
    body: 'The API endpoint here should be versioned (/v2/). Logging this before we ship.',
    status: 'resolved',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    replies: [],
  },
];

function Demo(props: Partial<React.ComponentProps<typeof CommentsPanel>>) {
  const [comments, setComments] = useState<CommentItem[]>(SAMPLE_COMMENTS);
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const visible = filter === 'open' ? comments.filter(c => c.status === 'open') : comments;

  return (
    <div style={{ display: 'flex', height: '100vh', justifyContent: 'flex-end' }}>
      <CommentsPanel
        comments={visible}
        filter={filter}
        onFilterChange={setFilter}
        onClose={() => alert('close')}
        onCreateComment={async (body) => {
          await new Promise(r => setTimeout(r, 600));
          setComments(prev => [...prev, {
            id: String(Date.now()),
            userName: 'You',
            body,
            status: 'open',
            createdAt: new Date().toISOString(),
            replies: [],
          }]);
        }}
        onDeleteComment={async (id) => {
          await new Promise(r => setTimeout(r, 400));
          setComments(prev => prev.filter(c => c.id !== id));
        }}
        onResolveComment={async (id, resolved) => {
          await new Promise(r => setTimeout(r, 400));
          setComments(prev => prev.map(c => c.id === id ? { ...c, status: resolved ? 'resolved' : 'open' } : c));
        }}
        onAddReply={async (commentId, body) => {
          await new Promise(r => setTimeout(r, 600));
          setComments(prev => prev.map(c => c.id === commentId
            ? { ...c, replies: [...c.replies, { id: String(Date.now()), userName: 'You', body, createdAt: new Date().toISOString() }] }
            : c
          ));
        }}
        onDeleteReply={async (commentId, replyId) => {
          await new Promise(r => setTimeout(r, 400));
          setComments(prev => prev.map(c => c.id === commentId
            ? { ...c, replies: c.replies.filter(r => r.id !== replyId) }
            : c
          ));
        }}
        {...props}
      />
    </div>
  );
}

const noop = async () => {};

export const Default: Story = {
  render: () => <Demo />,
};

export const WithInitialText: Story = {
  render: () => <Demo initialText="This section looks off to me." />,
};

export const Loading: Story = {
  render: () => (
    <div style={{ display: 'flex', height: '100vh', justifyContent: 'flex-end' }}>
      <CommentsPanel
        comments={[]}
        isLoading
        filter="open"
        onFilterChange={noop}
        onClose={noop}
        onCreateComment={noop}
        onDeleteComment={noop}
        onResolveComment={noop}
        onAddReply={noop}
        onDeleteReply={noop}
      />
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div style={{ display: 'flex', height: '100vh', justifyContent: 'flex-end' }}>
      <CommentsPanel
        comments={[]}
        filter="open"
        onFilterChange={noop}
        onClose={noop}
        onCreateComment={noop}
        onDeleteComment={noop}
        onResolveComment={noop}
        onAddReply={noop}
        onDeleteReply={noop}
      />
    </div>
  ),
};
