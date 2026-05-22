// Next.js 15 static export requires at least one entry; real IDs are served
// via nginx's SPA fallback (try_files ... /index.html) and rendered client-side.
export function generateStaticParams() {
  return [{ id: '_' }];
}

import UserProfileClient from './UserProfileClient';

export default function UserProfilePage() {
  return <UserProfileClient />;
}
