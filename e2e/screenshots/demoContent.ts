/**
 * The demo account's files, built in Node for the landing-page captures.
 *
 * Everything here is uploaded through the Drive UI rather than written over the API, because
 * content is end-to-end encrypted and only the browser holds the key. A `.docx`, `.xlsx` and
 * `.pptx` are what Docs, Sheets and Slides store (issue #127), and a note is a Markdown file, so
 * uploading these is exactly how the files would arrive from Word or a phone.
 *
 * The generators are the web app's own dependencies, resolved from its package so this needs no
 * install of its own.
 */

import { createRequire } from 'module';
import * as path from 'path';

const webRequire = createRequire(path.resolve(__dirname, '../../web/apps/web/package.json'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const docx = webRequire('docx') as typeof import('docx');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = webRequire('xlsx') as typeof import('xlsx');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PptxGenJS = webRequire('pptxgenjs') as typeof import('pptxgenjs').default;

export interface DemoFile {
  name: string;
  mimeType: string;
  bytes: Buffer;
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const DOC_NAME = 'Sync Protocol — Engineering Brief.docx';
export const SHEET_NAME = 'FY26 Revenue Plan.xlsx';
export const DECK_NAME = 'Neutrino — Product Overview.pptx';
export const NOTE_NAME = 'Offsite ideas.md';

async function brief(): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, LevelFormat, AlignmentType } = docx;
  const p = (text: string) => new Paragraph({ children: [new TextRun(text)], spacing: { after: 160 } });
  // An explicit bullet definition: the library's `bullet` shorthand reads back without its marker.
  const bullet = (text: string) => new Paragraph({ text, numbering: { reference: 'goals', level: 0 } });
  const doc = new Document({
    creator: 'Ada Lovelace',
    title: 'Sync Protocol — Engineering Brief',
    numbering: {
      config: [
        {
          reference: 'goals',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'Sync Protocol — Engineering Brief', bold: true, size: 52 })],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [new TextRun({ text: 'Draft for review · Platform team', italics: true, color: '6B7280' })],
            spacing: { after: 240 },
          }),
          new Paragraph({ text: 'Summary', heading: HeadingLevel.HEADING_1 }),
          p(
            'Every client — web, iOS, macOS and Windows — keeps a local copy of the files a person is ' +
              'working on and reconciles it with the server in the background. This brief proposes ' +
              'replacing the per-file polling we ship today with a single change feed per account, ' +
              'so a save on one device reaches the others in under a second.',
          ),
          p(
            'Nothing in the protocol carries file content. A change is a file id, a revision and a ' +
              'reason; each client fetches and decrypts the new revision itself, so the server keeps ' +
              'seeing only ciphertext.',
          ),
          new Paragraph({ text: 'Goals', heading: HeadingLevel.HEADING_1 }),
          bullet('One socket per account instead of one request per open file.'),
          bullet('Bursts coalesced: an import of five thousand files is one signal, not five thousand.'),
          bullet('A gap is survivable — a client that reconnects re-reads what it shows.'),
          bullet('No content on the wire, and no change to the encryption format.'),
          new Paragraph({ text: 'Rollout', heading: HeadingLevel.HEADING_1 }),
          p(
            'The web client moves first behind the existing listing refresh, then the desktop agents, ' +
              'then the mobile apps once background sockets are proven on battery.',
          ),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

function revenuePlan(): Buffer {
  const money = '"$"#,##0';
  const pct = '0%';
  const rows: (string | number | { f: string; z?: string } | null)[][] = [
    ['Quarter', 'New ARR', 'Expansion', 'Churn', 'Net ARR', 'Growth QoQ'],
    ['Q1 FY26', 412000, 86000, -31000, { f: 'B2+C2+D2' }, null],
    ['Q2 FY26', 468000, 104000, -28000, { f: 'B3+C3+D3' }, { f: 'E3/E2-1' }],
    ['Q3 FY26', 521000, 132000, -35000, { f: 'B4+C4+D4' }, { f: 'E4/E3-1' }],
    ['Q4 FY26', 604000, 158000, -29000, { f: 'B5+C5+D5' }, { f: 'E5/E4-1' }],
    ['Total', { f: 'SUM(B2:B5)' }, { f: 'SUM(C2:C5)' }, { f: 'SUM(D2:D5)' }, { f: 'SUM(E2:E5)' }, null],
    [],
    ['Assumptions', null, null, null, null, null],
    ['Seats per new team', 18],
    ['Price per seat / month', 12],
    ['Gross margin', 0.81],
  ];
  // Values computed here as well, so a reader that does not recalculate still shows numbers.
  const net = [467000, 544000, 618000, 733000];
  const ws = XLSX.utils.aoa_to_sheet(
    rows.map((r) => r.map((c) => (c && typeof c === 'object' && 'f' in c ? null : c))),
  );
  rows.forEach((r, ri) =>
    r.forEach((c, ci) => {
      const ref = XLSX.utils.encode_cell({ r: ri, c: ci });
      if (c && typeof c === 'object' && 'f' in c) {
        let v = 0;
        if (ci === 4 && ri >= 1 && ri <= 4) v = net[ri - 1];
        else if (ci === 5) v = net[ri - 1] / net[ri - 2] - 1;
        else if (ri === 5) v = [0, 2005000, 480000, -123000, 2362000][ci];
        ws[ref] = { t: 'n', f: c.f, v };
      }
      const cell = ws[ref];
      if (!cell || cell.t !== 'n') return;
      if (ci === 5 || (ri === 10 && ci === 1)) cell.z = pct;
      else if (ri >= 1 && ri <= 5) cell.z = money;
      else if (ri === 9) cell.z = money;
    }),
  );
  ws['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Plan');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function overviewDeck(): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const ink = '16181D';
  const accent = '3346E8';

  const title = pptx.addSlide();
  title.background = { color: 'F4F6FF' };
  title.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: accent } });
  title.addText('Neutrino', { x: 0.9, y: 2.3, w: 10, h: 1.2, fontSize: 54, bold: true, color: ink, fontFace: 'Inter' });
  title.addText('Your files, encrypted on your devices', {
    x: 0.9, y: 3.5, w: 10, h: 0.7, fontSize: 26, color: '4B5563', fontFace: 'Inter',
  });
  title.addText('Product overview · FY26', { x: 0.9, y: 5.8, w: 6, h: 0.5, fontSize: 16, color: accent, fontFace: 'Inter' });

  title.addNotes('Open with the promise: nothing we store can be read by us.');

  const pillars = pptx.addSlide();
  pillars.background = { color: 'FFFFFF' };
  pillars.addText('Three things we will not compromise on', {
    x: 0.6, y: 0.5, w: 12, h: 0.8, fontSize: 32, bold: true, color: ink, fontFace: 'Inter',
  });
  const cards: [string, string, string][] = [
    ['Private', 'Content is encrypted before it leaves the device.', 'E8ECFF'],
    ['Complete', 'Docs, Sheets, Slides, Notes, Photos and Calendar.', 'E6F6EE'],
    ['Everywhere', 'Web, macOS, Windows, iOS and Android.', 'FFF1E6'],
  ];
  cards.forEach(([head, body, fill], i) => {
    const x = 0.6 + i * 4.15;
    pillars.addShape(pptx.ShapeType.roundRect, { x, y: 1.8, w: 3.85, h: 3.6, fill: { color: fill }, rectRadius: 0.15 });
    pillars.addText(head, { x: x + 0.35, y: 2.1, w: 3.2, h: 0.7, fontSize: 24, bold: true, color: ink, fontFace: 'Inter' });
    pillars.addText(body, { x: x + 0.35, y: 2.9, w: 3.2, h: 1.8, fontSize: 16, color: '374151', fontFace: 'Inter', valign: 'top' });
  });

  pillars.addNotes('One sentence each — the detail is in the appendix.');

  const growth = pptx.addSlide();
  growth.background = { color: 'FFFFFF' };
  growth.addText('Net ARR by quarter', { x: 0.6, y: 0.5, w: 12, h: 0.8, fontSize: 32, bold: true, color: ink, fontFace: 'Inter' });
  // Drawn from shapes rather than a chart part, which the slide editor does not read back.
  const values = [467, 544, 618, 733];
  const base = 6.6;
  values.forEach((v, i) => {
    const h = (v / 733) * 4.2;
    const x = 1.4 + i * 2.9;
    growth.addShape(pptx.ShapeType.rect, { x, y: base - h, w: 1.9, h, fill: { color: i === 3 ? accent : 'AEB8F5' } });
    growth.addText(`$${v}k`, { x, y: base - h - 0.55, w: 1.9, h: 0.5, fontSize: 18, bold: true, color: ink, align: 'center', fontFace: 'Inter' });
    growth.addText(`Q${i + 1}`, { x, y: base + 0.1, w: 1.9, h: 0.45, fontSize: 16, color: '4B5563', align: 'center', fontFace: 'Inter' });
  });
  growth.addNotes('Q4 is the first quarter over $700k net.');
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}

const NOTES: [string, string][] = [
  [
    NOTE_NAME,
    `# Offsite ideas

A day out of the office for the platform team, early next quarter.

## Agenda
- [x] Book the venue by the river
- [x] Confirm the date with everyone's calendars
- [ ] Morning: sync protocol walkthrough
- [ ] Afternoon: hands-on with the new Drive client
- [ ] Dinner — somewhere that takes a booking for twelve

## Things to bring
- Laptops charged, plus the demo iPads
- The printed key-rotation runbook
- **Questions** from the last retro

> Keep it to one theme. Last time we tried to cover everything and covered nothing.
`,
  ],
  [
    'Launch checklist.md',
    `# Launch checklist

- [x] Release notes drafted
- [x] App Store screenshots
- [ ] Status page updated
- [ ] Support macros for the new sharing flow
`,
  ],
  [
    'Reading list.md',
    `# Reading list

1. *Designing Data-Intensive Applications*
2. *The Art of Doing Science and Engineering*
3. *Thinking in Systems*
`,
  ],
];

export async function demoFiles(): Promise<DemoFile[]> {
  return [
    { name: DOC_NAME, mimeType: DOCX, bytes: await brief() },
    { name: SHEET_NAME, mimeType: XLSX_MIME, bytes: revenuePlan() },
    { name: DECK_NAME, mimeType: PPTX, bytes: await overviewDeck() },
    ...NOTES.map(([name, text]) => ({ name, mimeType: 'text/markdown', bytes: Buffer.from(text, 'utf8') })),
  ];
}
