import type { AppId } from '@/lib/appForPath';
import type { TourDefinition } from './types';

/**
 * Drive's tour. It starts on My Drive itself, the one listing that has every target: the New
 * button, Quick access, the filter chips and display mode over the files, the top bar's right end
 * and the storage meter. Each step's target carries the `data-tour` value named here.
 */
export const DRIVE_TOUR: TourDefinition = {
  id: 'drive',
  appName: 'Drive',
  startsOn: (pathname) => pathname.replace(/\/$/, '') === '/drive',
  home: '/drive',
  steps: [
    {
      target: 'new',
      title: 'Create anything from here',
      body: 'New makes a folder, a document, sheet, deck, note or drawing, or uploads files — always into the folder you’re looking at.',
      placement: 'bottom',
    },
    {
      target: 'quick-access',
      title: 'Quick access',
      body: 'What you edited recently and what you starred, one click away. When the row is full, the arrows beside the heading scroll it.',
      placement: 'bottom',
    },
    {
      target: 'file-filters',
      title: 'Quick filters',
      body: 'Narrow the list to media, office files, drawings, PDFs or what you’ve starred — and back to All.',
      placement: 'bottom',
    },
    {
      target: 'view-mode',
      title: 'Display mode',
      body: 'Show files as a large grid, a small grid or a detailed list. Each view remembers the one you chose.',
      placement: 'bottom',
    },
    {
      target: 'top-right',
      title: 'Search, notifications and you',
      body: 'Search your files and run commands, see what’s new, reopen something from Quick access, and reach your profile and settings.',
      placement: 'bottom',
    },
    {
      target: 'storage',
      title: 'Your storage',
      body: 'How much of your space you’ve used. When you’re getting close, Request more storage asks for more.',
      placement: 'right',
    },
  ],
};

/** An editor route: `/<app>/editor`, with the document in the query string. */
function editorRoute(app: string): (pathname: string) => boolean {
  return (pathname) => pathname.replace(/\/$/, '') === `/${app}/editor`;
}

/** The step every tour of a shareable document ends near: the same control in each editor. */
const SHARE_STEP = {
  target: 'share',
  title: 'Share',
  body: 'Invite people or whole teams, and choose what each of them can do — view, comment or edit.',
  placement: 'bottom',
} as const;

/**
 * Docs' tour. It runs in the editor, where everything it points at is — the title and save state,
 * the toolbar, the outline and the right rail, Share and Search — so it starts the first time a
 * document is opened, and has no home to replay from elsewhere. The other editors' tours are the
 * same shape.
 */
export const DOCS_TOUR: TourDefinition = {
  id: 'docs',
  appName: 'Docs',
  startsOn: editorRoute('docs'),
  waitFor: 'docs-toolbar',
  steps: [
    {
      target: 'docs-title',
      title: 'Name it, and it saves itself',
      body: 'Give the document a title here. Everything you write is saved and encrypted as you type — the status beside Share says when it last was.',
      placement: 'bottom',
    },
    {
      target: 'docs-toolbar',
      title: 'The toolbar',
      body: 'Styles, fonts, lists, tables and pictures. Right-click it to customise it: reorder the tools, tuck away the ones you don’t use, or show their names.',
      placement: 'bottom',
    },
    {
      target: 'docs-outline',
      title: 'Outline',
      body: 'Every heading you write becomes an entry here — a table of contents that takes you straight to it.',
      placement: 'right',
    },
    {
      target: 'docs-comments',
      title: 'Comments, history and compare',
      body: 'On the right rail: comment on what you’ve selected, go back through every saved version in Version history, and compare any of them with this one.',
      placement: 'left',
    },
    SHARE_STEP,
    {
      target: 'search',
      title: 'Search and run anything',
      body: 'Press ⌘K (Ctrl+K on Windows and Linux) anywhere to search your files and run any command by name.',
      placement: 'bottom',
    },
  ],
};

/** Sheets' tour, in the editor. */
export const SHEETS_TOUR: TourDefinition = {
  id: 'sheets',
  appName: 'Sheets',
  startsOn: editorRoute('sheets'),
  waitFor: 'sheets-formula-bar',
  steps: [
    {
      target: 'sheets-formula-bar',
      title: 'Formula bar and name box',
      body: 'The name box on the left shows the cell or range you’ve selected. Type a value beside it, or a formula starting with = — click cells while you write one to add them.',
      placement: 'bottom',
    },
    {
      target: 'sheets-number-format',
      title: 'Formatting',
      body: 'Show numbers as currency, percentages or dates, or choose More formats…. Conditional formatting, further along the toolbar, colours cells by their values.',
      placement: 'bottom',
    },
    {
      target: 'sheets-chart',
      title: 'Charts',
      body: 'Select some cells and insert a chart of them. Click a chart on the sheet to change it in the Chart panel.',
      placement: 'bottom',
    },
    {
      target: 'sheets-tabs',
      title: 'Sheet tabs',
      body: '+ adds a sheet. Double-click a tab to rename it, or right-click it to colour, duplicate, move or delete it.',
      placement: 'top',
    },
    {
      target: 'sheets-history',
      title: 'Version history',
      body: 'Every save is kept as a version. Open Version history to look back through them and restore one.',
      placement: 'left',
    },
    SHARE_STEP,
  ],
};

/** Slides' tour, in the editor. */
export const SLIDES_TOUR: TourDefinition = {
  id: 'slides',
  appName: 'Slides',
  startsOn: editorRoute('slides'),
  waitFor: 'slides-list',
  steps: [
    {
      target: 'slides-list',
      title: 'Your slides',
      body: 'Drag a slide to reorder the deck. + adds a slide, and the buttons underneath move, duplicate or delete the one you’ve selected.',
      placement: 'right',
    },
    {
      target: 'slides-layout',
      title: 'Layouts and themes',
      body: 'On the right rail, Layout arranges this slide and Theme sets the colours and fonts of the whole deck.',
      placement: 'left',
    },
    {
      target: 'slides-notes',
      title: 'Speaker notes',
      body: 'Notes for the slide above. Nobody sees them but you, in presenter view.',
      placement: 'top',
    },
    {
      target: 'slides-present',
      title: 'Present',
      body: 'Present full screen, with a presenter view that shows your notes and the next slide.',
      placement: 'bottom',
    },
    {
      target: 'slides-export',
      title: 'Export',
      body: 'Download the deck as a PowerPoint file (.pptx) or as a PDF.',
      placement: 'bottom',
    },
  ],
};

/** Notes' tour, in the note editor: everything it describes is typed into a note. */
export const NOTES_TOUR: TourDefinition = {
  id: 'notes',
  appName: 'Notes',
  startsOn: editorRoute('notes'),
  waitFor: 'notes-editor',
  steps: [
    {
      target: 'notes-editor',
      title: 'Type / for anything',
      body: 'Type / to turn a line into a heading, a checklist, a quote and more. A checklist ticks off right where it is.',
      placement: 'bottom',
    },
    {
      target: 'notes-editor',
      title: 'Link your notes',
      body: 'Type [[ and pick a note to link to it. Every note lists the notes that link to it beside it, under “Linked from”.',
      placement: 'bottom',
    },
    {
      target: 'notes-title',
      title: 'Synced live',
      body: 'Every change is saved and encrypted as you type, and appears on your other devices without a reload.',
      placement: 'bottom',
    },
  ],
};

/** Photos' tour, on the library, which is where everything it points at is. */
export const PHOTOS_TOUR: TourDefinition = {
  id: 'photos',
  appName: 'Photos',
  startsOn: (pathname) => pathname.replace(/\/$/, '') === '/photos',
  home: '/photos',
  waitFor: 'photos-upload',
  steps: [
    {
      target: 'photos-upload',
      title: 'Upload',
      body: 'Add photos and videos. Each is encrypted on this device before it’s uploaded, so only you — and whoever you share it with — can see it.',
      placement: 'bottom',
    },
    {
      target: 'photos-collections',
      title: 'Albums, People and Memories',
      body: 'Albums you put together, People that face detection groups for you, and Memories: photos from years past.',
      placement: 'bottom',
    },
    {
      target: 'photos-keep',
      title: 'Favorites and Archive',
      body: 'Star a photo to find it under Favorites. Archive one to take it out of All Photos without deleting it.',
      placement: 'bottom',
    },
    {
      target: 'photos-info',
      title: 'Photo info and Suggestions',
      body: 'Info on a photo shows its details here — when, where and with what camera. Suggestions, beside it, asks you to confirm faces it thinks it recognises.',
      placement: 'left',
    },
    {
      target: 'photos-photo',
      title: 'Open a photo to edit it',
      body: 'Click any photo to open it in the editor.',
      placement: 'bottom',
    },
  ],
};

/** Calendar's tour, on the calendar itself. */
export const CALENDAR_TOUR: TourDefinition = {
  id: 'calendar',
  appName: 'Calendar',
  startsOn: (pathname) => pathname.replace(/\/$/, '') === '/calendar',
  home: '/calendar',
  waitFor: 'calendar-new',
  steps: [
    {
      target: 'calendar-new',
      title: 'New event',
      body: 'Add an event — or click a day on the calendar to start one on that day.',
      placement: 'bottom',
    },
    {
      target: 'calendar-views',
      title: 'Month, Week and Agenda',
      body: 'See a month at a time, a week by the hour, or a plain list of what’s coming up.',
      placement: 'bottom',
    },
    {
      target: 'calendar-calendars',
      title: 'Your calendars',
      body: 'Tick a calendar to show or hide its events, and use its swatch to recolour it. Calendars you connect from Google, Outlook or Apple in Settings show here, and Add holidays… adds a country’s public holidays.',
      placement: 'left',
    },
    {
      target: 'calendar-reminders',
      title: 'Reminders',
      body: 'Things to be reminded of at a time, once or on repeat. Tick one off when it’s done.',
      placement: 'left',
    },
    {
      target: 'calendar-tasks',
      title: 'Tasks',
      body: 'Type a task and press Enter. Give it a date as you type — “Lunch with Grace ^fri 1pm” — and it shows on the calendar that day.',
      placement: 'left',
    },
  ],
};

/** Diagrams' tour, in the editor. */
export const DIAGRAMS_TOUR: TourDefinition = {
  id: 'diagrams',
  appName: 'Diagrams',
  startsOn: editorRoute('diagrams'),
  waitFor: 'diagrams-canvas',
  steps: [
    {
      target: 'diagrams-shapes',
      title: 'Shapes',
      body: 'Drag a shape from the Shapes panel onto the canvas, or click one to drop it in the middle.',
      placement: 'right',
    },
    {
      target: 'diagrams-canvas',
      title: 'Connect shapes',
      body: 'Point at a shape and drag from one of the dots on its edge to another shape to connect them.',
      placement: 'top',
    },
    {
      target: 'diagrams-ai',
      title: 'Generate a diagram',
      body: 'Describe the diagram you want in the AI panel and it’s drawn for you, with the AI provider you set up in Settings.',
      placement: 'left',
    },
    {
      target: 'diagrams-menu',
      title: 'Save as SVG',
      body: 'Save a copy as SVG…, in this menu, makes a picture any browser, document or design tool can show — and it still opens here as a diagram.',
      placement: 'bottom',
    },
  ],
};

/** Drawings' tour, in the editor. */
export const DRAWING_TOUR: TourDefinition = {
  id: 'drawing',
  appName: 'Drawings',
  startsOn: editorRoute('drawing'),
  waitFor: 'drawing-tools',
  steps: [
    {
      target: 'drawing-tools',
      title: 'Tools',
      body: 'Brush, pencil, marker and airbrush to paint; pen, lines and shapes to draw vectors; text; and selections.',
      placement: 'right',
    },
    {
      target: 'drawing-layers',
      title: 'Layers',
      body: 'Every stroke and shape sits on a layer. Group layers, give one a mask, or change how it blends with what’s under it.',
      placement: 'right',
    },
    {
      target: 'drawing-style',
      title: 'Brush and colour',
      body: 'The Style panel holds the brush’s settings — size, opacity, hardness and more — and the colours of whatever you draw next.',
      placement: 'left',
    },
    {
      target: 'drawing-menu',
      title: 'Export',
      body: 'File → Export… saves a PNG, an SVG, or an OpenRaster file (.ora) that other painting apps open with its layers.',
      placement: 'bottom',
    },
  ],
};

/** Every tour, one per app. */
export const TOURS: readonly TourDefinition[] = [
  DRIVE_TOUR,
  DOCS_TOUR,
  SHEETS_TOUR,
  SLIDES_TOUR,
  NOTES_TOUR,
  PHOTOS_TOUR,
  CALENDAR_TOUR,
  DIAGRAMS_TOUR,
  DRAWING_TOUR,
];

/** The tour for the app a route belongs to (`appForPath`), if it has one. */
export function tourForApp(app: AppId, tours: readonly TourDefinition[] = TOURS): TourDefinition | null {
  return tours.find((t) => t.id === app) ?? null;
}

/**
 * Whether "Take the … tour" is offered on `pathname`: anywhere in its app for a tour with a home to
 * go to, and only where it runs for one without — an editor's, which runs on the open document.
 */
export function tourOffered(tour: TourDefinition, pathname: string): boolean {
  return tour.home !== undefined || tour.startsOn(pathname);
}
