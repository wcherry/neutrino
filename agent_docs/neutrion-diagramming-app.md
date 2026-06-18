Neutrino Diagrams — Feature Requirements

The goal should be to combine the best aspects of Microsoft Visio, Draw.io (diagrams.net), and Lucidchart while integrating naturally into the Neutrino ecosystem (Documents, Sheets, Slides, Drive, Notes, Tasks, and E2EE collaboration).

⸻

Core Product Vision

A web-first collaborative diagramming application that supports:

* Professional business diagrams
* Technical architecture diagrams
* Software engineering diagrams
* Network diagrams
* Process workflows
* Organizational charts
* Whiteboarding
* Mind mapping
* Embedded diagrams inside Documents, Sheets, Slides, and Notes

⸻

Phase 1: Core Diagram Editor (MVP)

Canvas

Infinite Canvas

* Infinite scrolling workspace
* Zoom from 5% to 800%
* Pan with mouse/touch
* Mini-map navigator

Pages

* Multi-page diagrams
* Page thumbnails
* Duplicate/reorder pages
* Page templates

Grid & Guides

* Configurable grid
* Snap-to-grid
* Snap-to-objects
* Smart alignment guides
* Rulers

⸻

Shapes

Basic Shapes

* Rectangle
* Rounded rectangle
* Ellipse
* Circle
* Triangle
* Diamond
* Hexagon
* Parallelogram
* Pentagon
* Trapezoid

Text

* Rich text editing
* Inline editing
* Font controls
* Text rotation
* Auto-sizing

Containers

* Swimlanes
* Group containers
* Expand/collapse sections

⸻

Connectors

Connector Types

* Straight
* Orthogonal
* Curved
* Elbow

Connector Features

* Auto-routing
* Smart rerouting
* Connector labels
* Arrowheads
* Line styles
* Connection points

Dynamic Connections

Moving a shape automatically updates connector paths.

⸻

Editing

Selection

* Single select
* Multi-select
* Lasso selection
* Layer selection

Arrange

* Bring forward/backward
* Alignment tools
* Distribution tools
* Group/Ungroup

Clipboard

* Copy/Paste
* Duplicate
* Multi-object clipboard

Undo/Redo

* Unlimited history
* Persistent history

⸻

Phase 2: Professional Diagram Features

Shape Libraries

Flowcharts

* Decision
* Process
* Terminator
* Document
* Data

UML

* Class diagrams
* Sequence diagrams
* Use case diagrams
* Activity diagrams

BPMN

* Events
* Tasks
* Gateways
* Pools
* Swimlanes

ERD

* Entities
* Relationships
* Cardinality indicators

Network

* Servers
* Switches
* Firewalls
* Routers
* Databases

Cloud Providers

AWS

* Official icon set

Azure

* Official icon set

Google Cloud

* Official icon set

Kubernetes

* Official resources

⸻

Templates

Business

* Organizational chart
* Process flow
* Customer journey
* SWOT
* Value stream mapping

Engineering

* System architecture
* Microservices
* Data flow
* Deployment diagrams

Project Management

* Kanban flow
* Roadmaps
* RACI matrix

⸻

Phase 3: Collaboration (Lucidchart-Level)

Real-Time Collaboration

Multi-user Editing

* Presence indicators
* Cursor tracking
* User avatars
* Live updates

Comments

* Threaded comments
* Resolve comments
* Mentions
* Assign comments

Change Tracking

* Revision history
* Version comparison
* Restore previous versions

⸻

Sharing

Permissions

* Owner
* Editor
* Commenter
* Viewer

Sharing Methods

* Link sharing
* Team sharing
* Embedded sharing

E2EE Support

* Client-side encrypted diagrams
* Shared encryption keys through existing Neutrino sharing infrastructure

⸻

Phase 4: Whiteboard Mode

Infinite Whiteboard

Drawing Tools

* Pen
* Pencil
* Highlighter
* Eraser

Sticky Notes

* Color coded notes
* Mentions
* Assignments

Brainstorming

* Voting
* Dot voting
* Affinity grouping

Presentation Mode

* Follow presenter
* Guided walkthrough
* Focus mode

⸻

Phase 5: Smart Layout Engine

One of the strongest Visio/Lucidchart features.

Auto Layout

Hierarchical Layout

Organization charts

Tree Layout

Mind maps

Flow Layout

Process diagrams

Network Layout

Infrastructure diagrams

Force Directed Layout

Relationship diagrams

⸻

Alignment Intelligence

Auto Alignment

Objects align while moving.

Smart Spacing

Consistent object spacing.

Collision Detection

Avoid overlapping objects.

⸻

Phase 6: Data-Driven Diagrams

A major enterprise feature.

Sheets Integration

Bind Shapes to Cells

Example:

Server Status Diagram

Server A:

* Status = Online
* CPU = 40%

Shape automatically updates.

Live Refresh

Updates when Sheet changes.

⸻

External Data

CSV Import

JSON Import

REST APIs

SQL Sources

Webhooks

⸻

Conditional Formatting

Borrow directly from Excel and Sheets.

Examples

Server:

* Green = Healthy
* Yellow = Warning
* Red = Critical

⸻

Phase 7: Import and Export

Import Formats

Visio

* VSDX

Draw.io

* XML

Lucidchart

* Import where possible

SVG

PNG

PDF

⸻

Export Formats

PNG

JPEG

SVG

PDF

JSON

Mermaid

⸻

Phase 8: Developer Features

Mermaid Support

Import Mermaid

graph TD
A --> B

Export Mermaid

Live Sync

⸻

PlantUML

Import

Export

Render

⸻

Architecture-as-Code

YAML

JSON

Terraform visualization

Kubernetes visualization

⸻

Phase 9: Neutrino-Native Features

These are the features the competitors don’t have.

Embedded Diagrams

Documents

Live embedded diagrams inside Neutrino Documents.

Slides

Editable diagrams inside presentations.

Sheets

Data-linked diagrams.

Notes

Inline diagrams.

⸻

Universal Object Model

A diagram object can be:

* Embedded in Documents
* Embedded in Slides
* Embedded in Notes
* Referenced from Tasks

Single source of truth.

⸻

Linked Workspace Objects

Example:

Task → Process Diagram → Requirements Document → Architecture Diagram → Spreadsheet

All linked together.

⸻

Phase 10: AI-Assisted Diagramming

Diagram Generation

Create diagrams from prompts:

“Create a microservice architecture with API Gateway, Auth Service, PostgreSQL, and Redis.”

⸻

Document to Diagram

Generate process diagrams from requirements documents.

⸻

Diagram Analysis

Detect:

* Missing connections
* Orphaned nodes
* Circular dependencies
* Process bottlenecks

⸻

Diagram Refactoring

Convert:

* Whiteboard → Professional Diagram
* Process Diagram → BPMN
* Network Diagram → Architecture Diagram

⸻

Recommended MVP (First Release)

Focus on:

1. Infinite canvas
2. Shapes and connectors
3. Flowchart libraries
4. UML libraries
5. Smart alignment
6. Multi-page documents
7. Real-time collaboration
8. Comments
9. PNG/SVG/PDF export
10. Draw.io import/export
11. Embedded diagrams in Documents and Slides
12. Version history

This feature set would immediately compete with Draw.io and cover roughly 80% of the functionality most users need, while establishing the foundation for Lucidchart- and Visio-level capabilities in later phases.

Phase 11: Diagram Automation

A major differentiator.

Generate Diagram from Data

JSON → Diagram

{
  "services": [
    { "name": "API" },
    { "name": "Database" }
  ]
}

Automatically generate architecture diagram.

⸻
