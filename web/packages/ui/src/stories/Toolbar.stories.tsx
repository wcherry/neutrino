import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Undo, Redo, List, ListOrdered } from 'lucide-react';
import {
  Toolbar,
  ToolbarGroup,
  ToolbarDivider,
  ToolbarButton,
  ToolbarSelect,
} from '../components/display/Toolbar';

const meta: Meta<typeof Toolbar> = {
  title: 'Editor/Toolbar',
  component: Toolbar,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const HEADINGS = [
  { label: 'Normal', level: null },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
];

function Demo() {
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p>Edit this text to try the toolbar controls.</p><p>Try <strong>bold</strong>, <em>italic</em>, headings, and lists.</p>',
  });

  if (!editor) return null;

  const currentHeading = HEADINGS.find(h =>
    h.level ? editor.isActive('heading', { level: h.level }) : !editor.isActive('heading')
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      <Toolbar>
        <ToolbarGroup>
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo"
          >
            <Undo size={15} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo"
          >
            <Redo size={15} />
          </ToolbarButton>
        </ToolbarGroup>
        <ToolbarDivider />
        <ToolbarSelect
          value={currentHeading?.label ?? 'Normal'}
          onChange={e => {
            const item = HEADINGS.find(h => h.label === e.target.value);
            if (!item) return;
            if (item.level === null) editor.chain().focus().setParagraph().run();
            else editor.chain().focus().toggleHeading({ level: item.level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
          }}
          style={{ width: 110 }}
        >
          {HEADINGS.map(h => <option key={h.label} value={h.label}>{h.label}</option>)}
        </ToolbarSelect>
        <ToolbarDivider />
        <ToolbarGroup>
          <ToolbarButton
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold"
            style={{ fontWeight: 700 }}
          >B</ToolbarButton>
          <ToolbarButton
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic"
            style={{ fontStyle: 'italic' }}
          >I</ToolbarButton>
        </ToolbarGroup>
        <ToolbarDivider />
        <ToolbarGroup>
          <ToolbarButton
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bulleted list"
          >
            <List size={15} />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Numbered list"
          >
            <ListOrdered size={15} />
          </ToolbarButton>
        </ToolbarGroup>
      </Toolbar>
      <div style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
        <EditorContent editor={editor} style={{ maxWidth: 720, margin: '0 auto' }} />
      </div>
    </div>
  );
}

export const Default: Story = {
  render: () => <Demo />,
};

export const Empty: Story = {
  render: () => <Toolbar />,
};
