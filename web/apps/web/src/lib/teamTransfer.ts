/**
 * Handing a team the key to a file it has just been given or lent (issue #185).
 *
 * The server can grant a team access to a file in one statement — `files.team_id`, or a row in
 * `team_file_shares` — and that is the whole of what it can do. Neutrino files are encrypted on the
 * device, and a file's DEK is sealed separately to each person who may open it, so access without
 * keys is a file every member can see in the listing and none can read. Nothing server-side can fix
 * that: the plaintext DEK exists only in the browser of someone who already holds it.
 *
 * So a move or a share is two steps, in this order and not the other:
 *
 *   1. the transfer, which is what gives the members access;
 *   2. this, which reseals the DEK to each of them.
 *
 * The order is forced. `POST /encryption/files/{id}/share` refuses a recipient who has no access to
 * the file yet — `RECIPIENT_NO_ACCESS` — so resealing before the transfer would fail for every
 * member.
 *
 * Nothing here is fatal. A plaintext file has no DEK, an account may have no keypair yet, and a
 * member whose public key has changed is deliberately skipped rather than sealed to blind. The
 * caller reports what happened; it does not undo the transfer, which has already landed and is
 * correct.
 */

import {
  initSodium,
  loadKeyPair,
  openSealedFileKey,
  encryptFileKey,
  fromBase64url,
  checkKey,
  pinKey,
} from '@neutrino/e2e-crypto';
import { authApi, encryptionApi, teamsApi, type TeamMember } from '@/lib/api';

export interface TeamKeyHandoverResult {
  /** Members who can now open the file. */
  shared: string[];
  /**
   * Members whose public key is not what this browser pinned the last time it sealed something to
   * them, and who were therefore skipped.
   *
   * A changed key is the one case that is not a shrug. In the one-to-one share dialog it stops the
   * share until a human has compared fingerprints out of band; here the same modal per member would
   * be a queue of interrogations in front of a bulk action, so the file is handed over and the
   * member is named instead. They can be given the key from the file's own Share dialog, where the
   * fingerprint comparison already exists.
   */
  unverified: string[];
  /**
   * Members it was not possible to seal to for a reason that is nobody's fault: no public key on
   * their account yet, or a request that failed. Reported as a count rather than an alarm.
   */
  skipped: string[];
  /**
   * True when the file has no DEK at all, or this browser holds no keypair — so there was nothing
   * to hand over and the file was already readable by anyone with access.
   */
  plaintext: boolean;
}

const empty = (): TeamKeyHandoverResult => ({
  shared: [],
  unverified: [],
  skipped: [],
  plaintext: false,
});

/**
 * Reseal a file's key to every member of a team, after the file has been moved or shared into it.
 *
 * `currentUserId` is the caller, who is skipped: they already hold the key, and resealing it to
 * themselves would overwrite the entry the file was created with.
 */
export async function handFileKeyToTeam(
  teamId: string,
  fileId: string,
  currentUserId: string | undefined
): Promise<TeamKeyHandoverResult> {
  const result = empty();
  if (!currentUserId) {
    result.plaintext = true;
    return result;
  }

  await initSodium();
  const kp = loadKeyPair(currentUserId);
  if (!kp) {
    // No keypair in this browser. Either the file is plaintext or we could not read its key
    // anyway; both mean there is nothing here to hand over.
    result.plaintext = true;
    return result;
  }

  const keyRef = await encryptionApi.getFileKey(fileId).catch(() => null);
  if (!keyRef) {
    result.plaintext = true;
    return result;
  }

  // Opening with *our* key version — the one this file was sealed to — once, outside the loop.
  const dek = openSealedFileKey(currentUserId, keyRef.encryptedFileKey, keyRef.keyVersion);

  let members: TeamMember[] = [];
  try {
    members = (await teamsApi.listMembers(teamId)).members;
  } catch {
    // The transfer has landed; not being able to list the members is a reason to report an
    // incomplete handover, not to claim the transfer failed.
    return result;
  }

  for (const member of members) {
    if (member.userId === currentUserId) continue;
    const label = member.name || member.email;

    try {
      const recipientKey = await authApi.getUserPublicKey(member.userId);
      if (!recipientKey) {
        result.skipped.push(label);
        continue;
      }

      const offered = recipientKey.publicKey;
      const check = checkKey(currentUserId, member.userId, offered);
      if (check.status === 'changed') {
        result.unverified.push(label);
        continue;
      }
      if (check.status === 'unpinned') {
        pinKey(currentUserId, member.userId, offered);
      }

      // Sealed with the *recipient's* current key version, which is what they will resolve it
      // against — not ours, which is what the DEK was opened with above.
      await encryptionApi.shareFileKey(fileId, {
        recipientId: member.userId,
        encryptedFileKey: encryptFileKey(dek, fromBase64url(offered)),
        keyVersion: recipientKey.version,
      });
      result.shared.push(label);
    } catch (err) {
      console.warn(`Could not hand the file key to ${label} (non-fatal):`, err);
      result.skipped.push(label);
    }
  }

  return result;
}

/**
 * A sentence for the toast, or `null` when everything worked and there is nothing to say.
 *
 * Silence on success is the point: the common case is a file everyone can now open, and a toast
 * confirming that a key exchange the user never asked about has completed is noise. Only the
 * partial cases are worth a line, and each says who is affected and what to do.
 */
export function describeKeyHandover(result: TeamKeyHandoverResult): string | null {
  if (result.plaintext) return null;

  const problems: string[] = [];
  if (result.unverified.length > 0) {
    problems.push(
      `${result.unverified.join(', ')} ${result.unverified.length === 1 ? 'has' : 'have'} a new ` +
        'encryption key that has not been verified, so they cannot open it yet — share it with ' +
        'them from the file to compare fingerprints.'
    );
  }
  if (result.skipped.length > 0) {
    problems.push(
      `${result.skipped.join(', ')} ${result.skipped.length === 1 ? 'has' : 'have'} not set up ` +
        'encryption yet, so they will not be able to open it.'
    );
  }
  return problems.length > 0 ? problems.join(' ') : null;
}
