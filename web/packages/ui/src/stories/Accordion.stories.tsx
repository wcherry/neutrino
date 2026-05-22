import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { HelpCircle, Shield, Zap } from 'lucide-react';
import { Accordion, AccordionItem } from '../components/containers/Accordion';

const meta: Meta<typeof Accordion> = {
  title: 'Containers/Accordion',
  component: Accordion,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ width: '480px' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Accordion>
      <AccordionItem id="q1" title="What is Neutrino?">
        Neutrino is a productivity suite for modern teams. It includes tools for file storage,
        calendar, notes, and more.
      </AccordionItem>
      <AccordionItem id="q2" title="How does billing work?">
        You're billed monthly based on the number of users and the plan you've selected. You can
        cancel or change your plan at any time.
      </AccordionItem>
      <AccordionItem id="q3" title="Can I export my data?">
        Yes. You can export all your data in standard formats from the Settings page at any time.
      </AccordionItem>
    </Accordion>
  ),
};

export const WithDefaultOpen: Story = {
  render: () => (
    <Accordion defaultOpen="q1">
      <AccordionItem id="q1" title="Getting started">
        Create your account and invite your team to get started. Setup takes less than 2 minutes.
      </AccordionItem>
      <AccordionItem id="q2" title="Configuring your workspace">
        Adjust permissions, themes, and integrations from the workspace settings panel.
      </AccordionItem>
      <AccordionItem id="q3" title="Managing users">
        Add or remove users, assign roles, and manage SSO from the Team section.
      </AccordionItem>
    </Accordion>
  ),
};

export const MultipleOpen: Story = {
  render: () => (
    <Accordion multiple defaultOpen={['security', 'performance']}>
      <AccordionItem id="security" title="Security" icon={<Shield size={14} />}>
        All data is encrypted at rest and in transit using AES-256 and TLS 1.3.
      </AccordionItem>
      <AccordionItem id="performance" title="Performance" icon={<Zap size={14} />}>
        Content is served via a global CDN with 99.99% uptime SLA.
      </AccordionItem>
      <AccordionItem id="support" title="Support" icon={<HelpCircle size={14} />}>
        24/7 email support and live chat available on Business and Enterprise plans.
      </AccordionItem>
    </Accordion>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <Accordion defaultOpen="security">
      <AccordionItem id="security" title="Security" icon={<Shield size={14} />}>
        Enterprise-grade security with SOC 2 Type II compliance.
      </AccordionItem>
      <AccordionItem id="performance" title="Performance" icon={<Zap size={14} />}>
        Sub-100ms response times globally via distributed edge infrastructure.
      </AccordionItem>
      <AccordionItem id="support" title="Support" icon={<HelpCircle size={14} />}>
        Dedicated success manager included on all Enterprise plans.
      </AccordionItem>
    </Accordion>
  ),
};
