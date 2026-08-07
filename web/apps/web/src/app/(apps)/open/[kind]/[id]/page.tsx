// Universal Link landing page: `https://www.getneutrino.app/open/<kind>/<file id>`.
//
// Next.js 15 static export requires at least one concrete entry per dynamic segment; real ids are
// served by the SPA fallback (actix's `default_handler` returns index.html) and resolved
// client-side — the same arrangement `/users/[id]` uses.

import { APP_LINK_KINDS } from '../../appLink';
import OpenLinkClient from '../../OpenLinkClient';

export function generateStaticParams() {
  return APP_LINK_KINDS.map((kind) => ({ kind, id: '_' }));
}

export default function OpenLinkPage() {
  return <OpenLinkClient />;
}
