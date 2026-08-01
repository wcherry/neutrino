Neutrino Drive – Shared Team Spaces Roadmap

Overview

This feature transforms the current Shared Drive into a much richer collaboration system centered around Teams.

Instead of sharing individual folders, users create Team Spaces that contain:

* Team metadata
* Members and permissions
* A team home page (wiki)
* Unlimited wiki pages
* Shared files and folders
* Future collaboration features (tasks, calendars, chat, etc.)

This becomes the foundation for the collaborative side of the Neutrino platform.

⸻

Goals

Replace

Shared Drive
    Folder
        Files

with

Shared Spaces
    Marketing Team
        Home
        Pages
        Files
        Folders
    Engineering
        Home
        Pages
        Files
        Folders
    Family
        Home
        Pages
        Files

Every Team is its own top-level object with its own identity, permissions, encryption, and storage.

⸻

New Top Level Objects

Team

Team
----
Id
Name
Description
Owner
Created
Updated
Avatar
Visibility
    Private
    Invite Only
    Organization
Default Landing Page
Encryption Settings
Storage Used
Storage Limit
Settings

A Team owns everything beneath it.

⸻

Page

Pages are no longer documents.

They become first-class objects.

Page
----
Id
TeamId
Title
Slug
ParentPage
Created
Updated
CreatedBy
LastEditedBy
Markdown Content
Icon
Cover Image
Sort Order
Published
Deleted

Every page has its own permissions.

Pages support:

* markdown
* embedded files
* links
* diagrams
* images
* tables
* comments (future)

⸻

Team Structure

Team
    Home Page
    Pages
        Getting Started
        Meeting Notes
        Roadmap
        Architecture
    Files
    Folders

Pages and Files are siblings.

This keeps navigation simple.

⸻

Home Page

Every Team automatically receives a Home page.

Example

Marketing
------------------------------------
Welcome to Marketing
Our quarterly goals
Current campaigns
Quick links
Recent files
Recent pages
Pinned documents
Upcoming meetings

Think:

Confluence

Notion

GitHub Wiki

⸻

Navigation Changes

Current

My Drive
Shared Drive
Recent
Trash

New

My Drive
Shared Spaces
Recent
Favorites
Trash

Selecting Shared Spaces displays

Marketing
Engineering
Accounting
Family
Vacation Planning

Selecting a Team opens

Home
Pages
Files
Members
Settings

⸻

Team Sidebar

Marketing
🏠 Home
📄 Pages
📁 Files
⭐ Favorites
👥 Members
⚙ Settings

Pages becomes a tree.

Pages
Introduction
Meetings
    2026
Roadmap
Architecture
Processes

⸻

Phase 1 — Team Infrastructure

Deliverables

Create Team object

CRUD API

Database tables

Permissions

Encryption model

Activity logging

Search integration

Storage quotas

UI

Shared Spaces screen

Create Team dialog

Delete Team

Rename Team

Team avatar

⸻

Phase 2 — Home Page

Automatically create

Home

for every Team.

Support

Markdown

Images

Embedded files

Links

Headings

Code blocks

Tables

Task lists

Recent activity

Pinned items

⸻

Phase 3 — Wiki Pages

Introduce Page object.

Features

Create page

Delete page

Rename page

Move page

Nested pages

Duplicate page

Search

Version history

Soft delete

Markdown editor

Slash commands

Page icons

Cover image

Breadcrumbs

⸻

Phase 4 — Shared File Library

Inside each Team

Files

works similarly to My Drive.

Supports

Folders

Uploads

Move

Rename

Delete

Restore

Search

Preview

Version history

Encryption

Permissions

Recent activity

⸻

Phase 5 — Navigation

Tree navigation

Marketing
Home
Pages
    Roadmap
    Meeting Notes
Files
    Contracts
    Logos

Recent

Favorites

Pinned

Recently Edited

⸻

Phase 6 — Permissions

Roles

Owner
Admin
Editor
Contributor
Viewer
Guest

Permissions

View Team

Create Pages

Delete Pages

Upload Files

Delete Files

Invite Members

Manage Permissions

Manage Settings

⸻

Phase 7 — Search

Search everything inside Team

Results

Pages
Files
Folders
Images
PDF
Spreadsheets
Slides
Notes

Support

Content search

Filename search

Wiki search

Filters

Author

Date

Type

Tags

⸻

Phase 8 — Activity Feed

Every Team gets

Recent Activity
William edited
Roadmap
3 minutes ago
John uploaded
Budget.xlsx
Yesterday
Sarah created
Meeting Notes

Future

Notifications

Mentions

Comments

⸻

Phase 9 — Team Dashboard

Instead of a blank Home page

Provide widgets

Recent Pages

Pinned Pages

Recent Files

Tasks (future)

Upcoming Calendar (future)

Activity Feed

Favorite Files

Quick Links

Storage Usage

Members

Widgets become configurable.

⸻

Phase 10 — Deep Integration

Every Neutrino app can create Team pages.

Examples

Sheets

Quarterly Budget

appears inside Files.

Notes

Meeting Notes

appear inside Pages.

Slides

Roadmap Presentation

appear inside Files.

Drawing

Architecture Diagram

appears in Files and can be embedded into Pages.

⸻

Future Expansion

This architecture naturally supports additional Team-scoped applications:

* Calendar
* Tasks
* Kanban Boards
* Whiteboards
* Chat/Channels
* Bookmarks
* Databases
* Forms
* Wikis
* AI Knowledge Base
* Team Templates
* Team Analytics
* Workflows & Automation

Because Team is the root object, all future collaboration modules can share a consistent permission model, search index, activity feed, encryption, and navigation.

⸻

Data Model

Workspace
│
├── My Drive
│      ├── Files
│      └── Folders
│
└── Shared Spaces
       │
       ├── Team
       │      ├── Home Page
       │      ├── Pages
       │      ├── Files
       │      ├── Members
       │      ├── Activity
       │      └── Settings
       │
       ├── Team
       │
       └── Team

Success Criteria (MVP)

By the end of the initial implementation:

* Users can create, rename, archive, and delete Team Spaces.
* Each Team automatically includes a Home page, a Pages section, and a Files section.
* Pages are first-class objects with hierarchical organization, markdown editing, version history, and full-text search.
* Files and folders can be uploaded, organized, shared, and searched within the Team.
* Team-based roles and permissions govern access to all Team resources.
* Shared Drive is fully replaced by Shared Spaces in the navigation.
* Team content integrates with the existing Neutrino Drive encryption, versioning, search, and activity infrastructure.
* The architecture provides a stable foundation for future collaborative applications such as Tasks, Calendar, Whiteboards, and Chat.