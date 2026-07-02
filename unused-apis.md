# Unused Backend APIs

Backend APIs that are defined in the server but called by **neither** the web app nor the iOS mobile app.

> **Method:** Backend routes were extracted from `src/*/api.rs` files. Web usage was traced through `web/packages/api-*/src/` clients. Mobile usage was traced through `NeutrinoDrive/Services/*.swift`. OAuth callbacks (`/callback`) are intentional server-side redirects and are excluded from "unused" classification.

---

## 1. Two-Factor Authentication (2FA)

The entire 2FA subsystem exists in the backend but has no client-side implementation.

| Method | Endpoint |
|--------|----------|
| GET | `/api/v1/auth/2fa/status` |
| POST | `/api/v1/auth/2fa/enroll` |
| POST | `/api/v1/auth/2fa/confirm` |
| POST | `/api/v1/auth/2fa/disable` |

---

## 2. Session Management

Active session listing and granular session revocation are not exposed in any client.

| Method | Endpoint |
|--------|----------|
| GET | `/api/v1/auth/sessions` |
| DELETE | `/api/v1/auth/sessions/{session_id}` |
| DELETE | `/api/v1/auth/sessions` (revoke all) |

---

## 3. OAuth Token Revocation

The OAuth PKCE flow (authorize + token exchange) is used by the mobile app, but token revocation is never called.

| Method | Endpoint |
|--------|----------|
| POST | `/api/v1/oauth/revoke` |

---

## 4. Calendar — Incomplete Task & Reminder Coverage

The web uses list/create/update for tasks and reminders, but several CRUD operations are unimplemented on the client side.

| Method | Endpoint |
|--------|----------|
| GET | `/api/v1/calendar/reminders/{id}` |
| GET | `/api/v1/calendar/tasks/{id}` |
| DELETE | `/api/v1/calendar/tasks/{id}` |
| POST | `/api/v1/calendar/tasks/bulk` |
| GET | `/api/v1/calendar/tasks/lists/{id}` |
| PATCH | `/api/v1/calendar/tasks/lists/{id}` |
| DELETE | `/api/v1/calendar/tasks/lists/{id}` |
| DELETE | `/api/v1/calendar/tasks/{id}/lists/{list_id}` |

---

## 5. Drive — Activity Log

The backend tracks per-file and workspace-level activity, but no client reads it.

| Method | Endpoint |
|--------|----------|
| GET | `/api/v1/drive/activity` |
| GET | `/api/v1/drive/files/{id}/activity` |

---

## 6. Drive — Search

Full-text search and autocomplete suggestions are defined but not called by either app.

| Method | Endpoint |
|--------|----------|
| GET | `/api/v1/drive/search` |
| GET | `/api/v1/drive/search/suggestions` |

---

## 7. Drive — Tags

The entire tagging system (CRUD + assignment) has no client usage.

| Method | Endpoint |
|--------|----------|
| GET | `/api/v1/drive/tags` |
| POST | `/api/v1/drive/tags` |
| GET | `/api/v1/drive/tags/{id}` |
| PATCH | `/api/v1/drive/tags/{id}` |
| DELETE | `/api/v1/drive/tags/{id}` |
| POST | `/api/v1/drive/files/{id}/tags` |
| DELETE | `/api/v1/drive/files/{id}/tags/{tag_id}` |

---

## 8. Drive — Notifications

In-app notification listing and management are unimplemented on both clients.

| Method | Endpoint |
|--------|----------|
| GET | `/api/v1/drive/notifications` |
| PATCH | `/api/v1/drive/notifications/{id}` |
| DELETE | `/api/v1/drive/notifications/{id}` |

---

## 9. Drive — Information Rights Management (IRM)

IRM policy endpoints exist on the backend but are never called.

| Method | Endpoint |
|--------|----------|
| GET | `/api/v1/drive/files/{id}/irm` |
| POST | `/api/v1/drive/files/{id}/irm` |
| DELETE | `/api/v1/drive/files/{id}/irm` |

---

## 10. Drive — Encryption Management

Separate encrypt-on-demand and status check endpoints (distinct from the E2EE key endpoints used by both clients).

| Method | Endpoint |
|--------|----------|
| POST | `/api/v1/drive/files/{id}/encrypt` |
| GET | `/api/v1/drive/files/{id}/encryption-status` |

---

## 11. Drive — File Priority

Priority flagging and listing are unused by both clients.

| Method | Endpoint |
|--------|----------|
| POST | `/api/v1/drive/files/{id}/priority` |
| GET | `/api/v1/drive/priority-items` |

---

## 12. Drive — AI Features

Backend AI endpoints for drive-level file analysis and summarization are not called by either client (the web calls AI via its own Next.js proxy routes instead).

| Method | Endpoint |
|--------|----------|
| POST | `/api/v1/drive/analyze` |
| POST | `/api/v1/drive/summarize` |

---

## 13. Drive — Suggestions

Collaborative change suggestions (distinct from access requests) have no client-side implementation.

| Method | Endpoint |
|--------|----------|
| GET | `/api/v1/drive/files/{id}/suggestions` |
| POST | `/api/v1/drive/suggestions` |
| PATCH | `/api/v1/drive/suggestions/{id}` |

---

## 14. Drive — Shared Drives Write Operations

The web only lists shared drives (`GET /shared-drives`). Creating, fetching, and updating individual shared drives is unused.

| Method | Endpoint |
|--------|----------|
| POST | `/api/v1/drive/shared-drives` |
| GET | `/api/v1/drive/shared-drives/{id}` |
| PATCH | `/api/v1/drive/shared-drives/{id}` |

---

## 15. Drive — File Version Deletion

The web can create and restore versions but never calls the delete endpoint.

| Method | Endpoint |
|--------|----------|
| DELETE | `/api/v1/drive/files/{id}/versions/{vid}` |

---

## 16. Admin — Workspace, Compliance & Security Settings

The web admin panel covers users, services, disk, and feature flags. These three admin resource groups are never called.

| Method | Endpoint |
|--------|----------|
| GET | `/api/v1/admin/workspace` |
| PATCH | `/api/v1/admin/workspace` |
| GET | `/api/v1/admin/compliance` |
| POST | `/api/v1/admin/compliance` |
| GET | `/api/v1/admin/security` |
| PATCH | `/api/v1/admin/security` |

---

## 17. Internal Service Registry

These internal endpoints are used for service-to-service communication only and have no client-facing callers.

| Method | Endpoint |
|--------|----------|
| POST | `/api/v1/internal/services/register` |
| GET | `/api/v1/internal/services` |
| DELETE | `/api/v1/internal/services/{id}` |

---

## 18. Docs — Real-time Collaboration

The docs collaboration session endpoints (cursor, selection, change broadcasting) are defined but no client connects to them. Real-time editing likely falls back to autosave only.

| Method | Endpoint |
|--------|----------|
| POST | `/api/v1/docs/collab/{id}` (join session) |
| POST | `/api/v1/docs/collab/{id}/cursor` |
| POST | `/api/v1/docs/collab/{id}/selection` |
| POST | `/api/v1/docs/collab/{id}/changes` |

---

## 19. Docs — Revision History & AI

| Method | Endpoint |
|--------|----------|
| GET | `/api/v1/docs/{id}/history` |
| POST | `/api/v1/docs/{id}/restore` |
| POST | `/api/v1/docs/generate` (AI content generation) |
| POST | `/api/v1/docs/improve` (AI content improvement) |

---

## 20. Notes — References

Backlinks are used by the web, but the reference creation endpoint is not.

| Method | Endpoint |
|--------|----------|
| POST | `/api/v1/notes/{id}/reference` |

---

## 21. Photos — Face & Person Management

The web reads persons (list, photos, timeline, merge, smart-album) but never creates, fetches by ID, or deletes individual persons. The raw faces index is also unused.

| Method | Endpoint |
|--------|----------|
| GET | `/api/v1/photos/faces` |
| GET | `/api/v1/photos/faces/{id}` |
| POST | `/api/v1/photos/persons` |
| GET | `/api/v1/photos/persons/{id}` |
| DELETE | `/api/v1/photos/persons/{id}` |
| POST | `/api/v1/photos/learning/reprocess` |

---

## 22. Sheets — Incomplete Operations & AI

The web covers autosave and named-range creation but misses delete, export, bulk named-range management, and two AI endpoints.

| Method | Endpoint |
|--------|----------|
| DELETE | `/api/v1/sheets/{id}` |
| GET | `/api/v1/sheets/{id}/export` |
| GET | `/api/v1/sheets/named-ranges` |
| PATCH | `/api/v1/sheets/named-ranges/{id}` |
| DELETE | `/api/v1/sheets/named-ranges/{id}` |
| POST | `/api/v1/sheets/ai/analyze` |
| POST | `/api/v1/sheets/ai/generate-formula` |

---

## 23. Slides — Delete & AI

| Method | Endpoint |
|--------|----------|
| DELETE | `/api/v1/slides/{id}` |
| POST | `/api/v1/slides/ai/generate-slide` |
| POST | `/api/v1/slides/ai/improve-slide` |

---

## 24. Diagrams — Real-time Collaboration

Like docs, the backend has a real-time collaboration protocol for diagrams that no client calls.

| Method | Endpoint |
|--------|----------|
| POST | `/api/v1/diagrams/collab/{id}` (join session) |
| POST | `/api/v1/diagrams/collab/{id}/changes` |

---

## Summary

| Group | Unused Endpoints |
|-------|-----------------|
| Two-Factor Authentication | 4 |
| Session Management | 3 |
| OAuth Token Revocation | 1 |
| Calendar — Tasks & Reminders | 8 |
| Drive — Activity Log | 2 |
| Drive — Search | 2 |
| Drive — Tags | 7 |
| Drive — Notifications | 3 |
| Drive — IRM | 3 |
| Drive — Encryption Management | 2 |
| Drive — File Priority | 2 |
| Drive — AI Features | 2 |
| Drive — Suggestions | 3 |
| Drive — Shared Drives (write) | 3 |
| Drive — Version Deletion | 1 |
| Admin — Workspace/Compliance/Security | 6 |
| Internal Service Registry | 3 |
| Docs — Real-time Collaboration | 4 |
| Docs — History & AI | 4 |
| Notes — References | 1 |
| Photos — Face & Person Management | 6 |
| Sheets — Incomplete Operations & AI | 7 |
| Slides — Delete & AI | 3 |
| Diagrams — Real-time Collaboration | 2 |
| **Total** | **83** |
