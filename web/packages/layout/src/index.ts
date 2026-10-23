export { AppShell, useShell } from './AppShell';
export type { AppShellProps } from './AppShell';

export { Sidebar } from './Sidebar';
export type { SidebarProps, NavItem, NavSection, StorageQuota } from './Sidebar';

export { Topbar } from './Topbar';
export type { TopbarProps, TopbarUser, TopbarAction, TopbarSearchResult, TopbarNotification } from './Topbar';

// The new shell (Stage 3): the three new looks' top bar, sidebar, menus and the command palette.
export { ShellTopBar } from './shell/ShellTopBar';
export type { ShellTopBarProps } from './shell/ShellTopBar';
export { ShellSidebar } from './shell/ShellSidebar';
export type { ShellSidebarProps } from './shell/ShellSidebar';
export { BrandMark } from './shell/BrandMark';
export type { ShellBrand } from './shell/BrandMark';
export { AccountMenu, NotificationsMenu } from './shell/ShellMenus';
export type { AccountMenuProps, NotificationsMenuProps } from './shell/ShellMenus';
export { CommandPalette, matchCommands } from './shell/CommandPalette';
export type { CommandPaletteProps, PaletteCommand } from './shell/CommandPalette';
