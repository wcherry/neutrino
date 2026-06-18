The standard solution is envelope encryption with key versioning.

Instead of encrypting documents directly with a long-lived user key, every document (or document version) gets its own random Data Encryption Key (DEK). The DEK encrypts the document content, and the DEK itself is encrypted by a Key Encryption Key (KEK) owned by the user.

This gives you:

* Key rotation without re-encrypting document contents
* Ability to read old versions
* Ability to revoke compromised keys
* Efficient sharing

⸻

Recommended Architecture

Keys

Master Key (MK)
    ↓ encrypts
Key Encryption Keys (KEK v1, KEK v2, ...)
    ↓ encrypt
Document Encryption Keys (DEK)
    ↓ encrypt
Document Contents

Example

Document Version 1
  Content encrypted with DEK-123
  DEK-123 encrypted with KEK-v1
Document Version 2
  Content encrypted with DEK-456
  DEK-456 encrypted with KEK-v1
Rotate Keys
New KEK-v2 created
Document Version 3
  Content encrypted with DEK-789
  DEK-789 encrypted with KEK-v2

Versions 1 and 2 remain untouched.

⸻

Store Key Metadata

Each document version should contain:

{
  "version": 17,
  "ciphertext": "...",
  "dek": "...encrypted DEK...",
  "kek_version": 2,
  "created_at": "2026-06-09T00:00:00Z"
}

When loading:

1. Read kek_version
2. Fetch corresponding KEK
3. Decrypt DEK
4. Decrypt document

⸻

Better: Key Rings

Maintain a key ring on each client:

{
  "keys": [
    {
      "id": "kek-v1",
      "status": "retired"
    },
    {
      "id": "kek-v2",
      "status": "active"
    }
  ]
}

Rules:

* New writes use active key.
* Old keys remain available for decryption.
* Retired keys never encrypt new data.
* Deleted keys can no longer decrypt data.

This is how many enterprise KMS systems work.

⸻

Sharing Support

Since you’re building Neutrino with E2EE and sharing, extend this slightly.

Instead of:

DEK encrypted by one KEK

Store:

DEK encrypted once per recipient

Example:

{
  "document_id": "abc",
  "encrypted_deks": {
    "user1": "...",
    "user2": "...",
    "user3": "..."
  }
}

Each user’s public key encrypts the same DEK.

When rotating your own KEK:

* Re-encrypt only your DEK wrappers.
* Never re-encrypt document contents.
* Never affect other users.

⸻

Version History (Google Docs Style)

For document versioning:

Document
 ├── Version 1 → DEK-A
 ├── Version 2 → DEK-A
 ├── Version 3 → DEK-A
 ├── Rotate Keys
 ├── Version 4 → DEK-B
 └── Version 5 → DEK-B

You generally don’t need a new DEK per version.

A practical approach is:

One DEK per document

Document
   DEK-123
      ├── v1
      ├── v2
      ├── v3
      └── v4

When rotating keys:

1. Generate KEK-v2.
2. Decrypt DEK-123 with KEK-v1.
3. Re-encrypt DEK-123 with KEK-v2.
4. Store both wrappers temporarily.
5. Remove KEK-v1 wrapper when all clients have migrated.

Only a few hundred bytes change instead of gigabytes of document history.

⸻

For Neutrino

Given your architecture (client-side keys, E2EE documents, version history, shared documents), I would recommend:

Document Structure

{
  "document_id": "...",
  "encrypted_content": "...",
  "dek_wrappers": [
    {
      "recipient": "userA",
      "key_version": 4,
      "encrypted_dek": "..."
    },
    {
      "recipient": "userB",
      "key_version": 7,
      "encrypted_dek": "..."
    }
  ]
}

User Key Ring

{
  "active_key": "key-v8",
  "keys": [
    "key-v5",
    "key-v6",
    "key-v7",
    "key-v8"
  ]
}

Rotation Process

Generate key-v9
↓
Mark key-v9 active
↓
New documents use key-v9
↓
Background job rewraps DEKs
↓
Retire key-v8
↓
Eventually remove key-v8

The critical concept is rewrapping (decrypt DEK, re-encrypt DEK) rather than re-encrypting document contents. This is the approach used by major cloud KMS systems because rotation remains fast even when storing millions of document versions.