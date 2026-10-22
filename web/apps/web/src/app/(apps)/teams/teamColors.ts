/**
 * The avatar colours a team can be given.
 *
 * A fixed palette rather than a free colour picker: the avatar's job is to make one team findable
 * among a dozen in a sidebar, which a set of clearly distinct colours does and an arbitrary hex
 * does not. The colour also tints the team's space (T1); the server accepts any `#rrggbb`, and
 * nothing wider (`src/drive/teams/service.rs`, `validate_avatar`).
 */
export const AVATAR_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0891b2',
];
