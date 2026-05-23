🔐 Core Idea (Don’t Share the File Key Directly)

Each file has its own random symmetric key (DEK – Data Encryption Key).

* File is encrypted locally with DEK (e.g. AES-GCM)
* DEK is never stored in plaintext anywhere except client memory

When sharing:
👉 You don’t share the DEK itself
👉 You encrypt (wrap) the DEK with the recipient’s public key

⸻

🧱 Architecture Overview

1. User Keys (Long-term identity)

Each user has:

* Public key (shared freely)
* Private key (never leaves client, ideally hardware-backed)

Use something like:

* X25519 (key exchange) + Ed25519 (signing)

⸻

2. File Encryption

For each file:

* Generate:

file_key = random(256-bit)

* Encrypt:

ciphertext = AES-GCM(file_key, file_data)

* Store on server:
    * encrypted file
    * metadata (no keys)

⸻

3. Key Wrapping for Owner

Even the owner shouldn’t store raw file_key:

wrapped_key_owner = Encrypt(file_key, owner_public_key)

⸻

🔄 Sharing Flow (The Important Part)

When User A shares with User B:

Step 1: Get recipient public key

From server (safe, but must be authenticated)

Step 2: Re-wrap the file key

On User A’s device:

file_key = Decrypt(wrapped_key_owner, A_private_key)
wrapped_key_for_B = Encrypt(file_key, B_public_key)

Step 3: Send to server

Server stores:

{
  file_id,
  recipient_id,
  wrapped_key_for_B
}

🚨 Server never sees file_key

⸻

🔓 Access Flow (Recipient)

When User B opens the file:

wrapped_key_for_B → decrypt with B_private_key → file_key
file_key → decrypt file

⸻

🔒 Why This Works

* Server only stores encrypted blobs
* Each user gets their own wrapped version of the same DEK
* No shared secrets ever transmitted in plaintext
* Compromise of one user ≠ compromise of others

⸻

🧠 Optional (But Important) Enhancements

1. Forward Secrecy for Sharing

Instead of encrypting directly with B’s long-term key:

Use ephemeral key exchange:

* A generates ephemeral keypair
* Derives shared secret with B’s public key
* Encrypts file_key with derived key

👉 Prevents long-term key compromise from exposing past shares

⸻

2. Access Revocation (Hard Problem)

Once B has the file_key, you cannot revoke access unless:

Option A: Re-encrypt file

* Generate new file_key
* Re-encrypt file
* Re-share with allowed users

Option B: Chunked encryption (advanced)

* Split file into chunks
* Rotate keys per chunk/version

⸻

3. Group Sharing Optimization

Instead of N re-wraps:

* Create a group key
* Wrap file_key with group key
* Share group key with members

Tradeoff: harder revocation

⸻

4. Key Authenticity (CRITICAL)

You must prevent MITM attacks when fetching public keys:

* Use:
    * Signed public keys
    * Certificate transparency model
    * Key verification (fingerprints / QR codes like Signal)

⸻

5. Metadata Leakage

Even if content is encrypted, server can see:

* who shared with whom
* file size
* timestamps

Mitigations:

* pad file sizes
* anonymous sharing IDs (complex)

⸻

🧩 Data Model Example

files:
  id
  encrypted_blob
file_keys:
  file_id
  user_id
  wrapped_key

⸻

🛠 Suggested Crypto Stack

* Symmetric: AES-256-GCM
* Asymmetric: X25519
* KDF: HKDF
* Signing: Ed25519

Or just use:
👉 libsodium / NaCl (highly recommended)

⸻

⚠️ Common Mistakes to Avoid

* ❌ Sharing raw file_key
* ❌ Encrypting file with user password directly
* ❌ Trusting server-provided public keys without verification
* ❌ Reusing IVs in AES-GCM
* ❌ Not authenticating ciphertext

⸻

🧭 Mental Model

Think of it like this:

The file is locked with a key.
Each user gets their own encrypted copy of that key, not the key itself.
