import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ZoomSlider } from '../components/inputs/ZoomSlider';

const meta: Meta<typeof ZoomSlider> = {
  title: 'Inputs/ZoomSlider',
  component: ZoomSlider,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    value: { control: { type: 'range', min: 25, max: 400, step: 25 } },
    min: { control: 'number' },
    max: { control: 'number' },
    step: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled(args: React.ComponentProps<typeof ZoomSlider>) {
  const [zoom, setZoom] = useState(args.value ?? 100);
  return <ZoomSlider {...args} value={zoom} onChange={setZoom} />;
}

export const Default: Story = {
  render: (args) => <Controlled {...args} />,
  args: { value: 100, min: 25, max: 200, step: 25 },
};

export const FineStep: Story = {
  render: (args) => <Controlled {...args} />,
  args: { value: 100, min: 10, max: 500, step: 10 },
};

export const AtMinimum: Story = {
  render: (args) => <Controlled {...args} />,
  args: { value: 25, min: 25, max: 200, step: 25 },
};

export const AtMaximum: Story = {
  render: (args) => <Controlled {...args} />,
  args: { value: 200, min: 25, max: 200, step: 25 },
};

export const LargeRange: Story = {
  render: (args) => <Controlled {...args} />,
  args: { value: 100, min: 10, max: 400, step: 10 },
};

export const WithHandle: Story = {
  render: (args) => <Controlled {...args} />,
  args: { value: 100, min: 25, max: 200, step: 25, showHandle: true },
};

export const WithHandleFineStep: Story = {
  render: (args) => <Controlled {...args} />,
  args: { value: 150, min: 10, max: 500, step: 10, showHandle: true },
};
