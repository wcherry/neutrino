import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  GitBranch,
  Paintbrush,
  Presentation,
  Sheet,
} from 'lucide-react';

const DOC_MIME = 'application/x-neutrino-doc';
const SHEET_MIME = 'application/x-neutrino-sheet';
const SLIDES_MIME = 'application/x-neutrino-slide';
const DIAGRAM_MIME = 'application/x-neutrino-diagram';
const DRAWING_MIME = 'application/x-neutrino-drawing';

export function getFileIcon(mimeType: string) {
  // Neutrino app types
  if (mimeType === DOC_MIME) return FileText;
  if (mimeType === SHEET_MIME) return Sheet;
  if (mimeType === SLIDES_MIME) return Presentation;
  if (mimeType === DIAGRAM_MIME) return GitBranch;
  if (mimeType === DRAWING_MIME) return Paintbrush;

  // Media
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType.startsWith('video/')) return FileVideo;
  if (mimeType.startsWith('audio/')) return FileAudio;

  // PDF
  if (mimeType === 'application/pdf') return FileText;

  // JSON
  if (mimeType === 'application/json' || mimeType === 'text/json') return FileJson;

  // Code
  if (
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('python') ||
    mimeType.includes('ruby') ||
    mimeType.includes('java') ||
    mimeType.includes('php') ||
    mimeType.includes('go') ||
    mimeType.includes('rust') ||
    mimeType === 'text/css' ||
    mimeType === 'text/html' ||
    mimeType === 'application/xml' ||
    mimeType === 'text/xml'
  ) return FileCode;

  // Spreadsheets
  if (
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType === 'text/csv'
  ) return FileSpreadsheet;

  // Word processing (non-neutrino)
  if (
    mimeType.includes('wordprocessingml') ||
    mimeType === 'application/msword' ||
    mimeType.includes('opendocument.text')
  ) return FileText;

  // Presentations (non-neutrino)
  if (
    mimeType.includes('presentationml') ||
    mimeType.includes('powerpoint') ||
    mimeType.includes('opendocument.presentation')
  ) return Presentation;

  // Archives
  if (
    mimeType.includes('zip') ||
    mimeType.includes('tar') ||
    mimeType.includes('rar') ||
    mimeType.includes('gzip') ||
    mimeType.includes('bzip') ||
    mimeType.includes('7z') ||
    mimeType === 'application/x-7z-compressed'
  ) return FileArchive;

  // Plain text fallback
  if (mimeType.startsWith('text/')) return FileText;

  return File;
}

export function getIconColor(mimeType: string): string {
  // Neutrino app types
  if (mimeType === DOC_MIME) return 'var(--color-blue, #2563eb)';
  if (mimeType === SHEET_MIME) return 'var(--color-green, #16a34a)';
  if (mimeType === SLIDES_MIME) return 'var(--color-orange, #ea580c)';
  if (mimeType === DIAGRAM_MIME) return 'var(--color-cyan, #0891b2)';
  if (mimeType === DRAWING_MIME) return 'var(--color-lime, #65a30d)';

  // Media
  if (mimeType.startsWith('image/')) return 'var(--color-violet, #7c3aed)';
  if (mimeType.startsWith('video/')) return 'var(--color-rose, #e11d48)';
  if (mimeType.startsWith('audio/')) return 'var(--color-amber, #d97706)';

  // PDF
  if (mimeType === 'application/pdf') return 'var(--color-rose, #e11d48)';

  // JSON
  if (mimeType === 'application/json' || mimeType === 'text/json') return 'var(--color-teal, #0d9488)';

  // Code
  if (
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('python') ||
    mimeType.includes('ruby') ||
    mimeType.includes('java') ||
    mimeType.includes('php') ||
    mimeType.includes('go') ||
    mimeType.includes('rust') ||
    mimeType === 'text/css' ||
    mimeType === 'text/html' ||
    mimeType === 'application/xml' ||
    mimeType === 'text/xml'
  ) return 'var(--color-cyan, #0891b2)';

  // Spreadsheets
  if (
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType === 'text/csv'
  ) return 'var(--color-green, #16a34a)';

  // Word processing
  if (
    mimeType.includes('wordprocessingml') ||
    mimeType === 'application/msword' ||
    mimeType.includes('opendocument.text')
  ) return 'var(--color-blue, #2563eb)';

  // Presentations
  if (
    mimeType.includes('presentationml') ||
    mimeType.includes('powerpoint') ||
    mimeType.includes('opendocument.presentation')
  ) return 'var(--color-orange, #ea580c)';

  // Archives
  if (
    mimeType.includes('zip') ||
    mimeType.includes('tar') ||
    mimeType.includes('rar') ||
    mimeType.includes('gzip') ||
    mimeType.includes('bzip') ||
    mimeType.includes('7z')
  ) return 'var(--color-orange, #ea580c)';

  // Plain text
  if (mimeType.startsWith('text/')) return 'var(--color-accent)';

  return 'var(--color-text-muted)';
}
