import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Pagination } from '../components/navigation/Pagination';

const meta: Meta<typeof Pagination> = {
  title: 'Navigation/Pagination',
  component: Pagination,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

function PaginationDemo({
  totalPages = 10,
  showFirstLast = false,
  siblingCount = 1,
  showInfo = false,
  totalItems,
  pageSize,
}: {
  totalPages?: number;
  showFirstLast?: boolean;
  siblingCount?: number;
  showInfo?: boolean;
  totalItems?: number;
  pageSize?: number;
}) {
  const [page, setPage] = React.useState(1);
  return (
    <Pagination
      page={page}
      totalPages={totalPages}
      onPageChange={setPage}
      showFirstLast={showFirstLast}
      siblingCount={siblingCount}
      showInfo={showInfo}
      totalItems={totalItems}
      pageSize={pageSize}
    />
  );
}

export const Default: Story = {
  render: () => <PaginationDemo />,
};

export const FewPages: Story = {
  render: () => <PaginationDemo totalPages={4} />,
};

export const ManyPages: Story = {
  render: () => <PaginationDemo totalPages={50} />,
};

export const WithFirstLast: Story = {
  render: () => <PaginationDemo totalPages={20} showFirstLast />,
};

export const WithInfo: Story = {
  render: () => (
    <PaginationDemo
      totalPages={10}
      showInfo
      totalItems={98}
      pageSize={10}
    />
  ),
};

export const WithInfoAndFirstLast: Story = {
  render: () => (
    <PaginationDemo
      totalPages={15}
      showFirstLast
      showInfo
      totalItems={150}
      pageSize={10}
    />
  ),
};

export const WideSiblingCount: Story = {
  render: () => <PaginationDemo totalPages={20} siblingCount={2} />,
};
