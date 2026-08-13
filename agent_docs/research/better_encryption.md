Prompt: Are there better ways to secure the key for the web app, can we Bitwarden passkey or Apples keychain or similiar?


Yes — and the thing you're reaching for has a name: WebAuthn's prf extension. But let me correct the framing on both products you named, because neither is a thing you integrate against directly.

Apple Keychain: a web app cannot write to it. There is no browser API that puts arbitrary key material in the iOS/macOS Keychain. The only path from a web page into iCloud Keychain is by creating a passkey — and then reading a derived secret back out via PRF. So "use Apple Keychain" and "use passkeys" are the same project.

Bitwarden: also not an integration. Bitwarden is a passkey provider. You implement WebAuthn PRF once, and Bitwarden, iCloud Keychain, 1Password, Chrome's profile store, and YubiKeys all work as backends because the user picks the provider at credential-creation time. You'd write zero Bitwarden-specific code.

Why PRF and not "sign something and hash it"
The obvious-seeming approach — have the passkey sign a fixed challenge and use the signature as key material — is broken. WebAuthn signs over authenticatorData, which contains a signature counter that changes every assertion, and ES256 (the near-universal algorithm) is randomized anyway. You'd get a different "key" every time.

PRF exists precisely for this. It surfaces CTAP2's hmac-secret: you pass a salt, the authenticator returns a deterministic 32 bytes derived from a per-credential secret it holds. Same salt plus same credential always yields the same output, and the underlying secret is never extractable. That's a KEK you can wrap a key with. It's broadly supported now — Chrome, Safari (18+), Firefox, and the major password managers; iCloud Keychain passkeys carry PRF across a user's devices, which is what makes it practical rather than a per-device dead end.

The architecture I'd actually recommend
Don't derive the Curve25519 identity key from PRF. Keep the identity key as the root of trust and wrap it, with several independently-wrapped copies of the same key:


Curve25519 secret key (unchanged — iOS + all existing file_key_refs still work)
  └─ wrapped under a random KEK
       ├─ copy 1: KEK wrapped by passkey PRF output   (primary unlock)
       ├─ copy 2: KEK wrapped by Argon2id(password)   (fallback, new browser)
       └─ copy 3: KEK wrapped by a printed recovery code
Each wrapped blob is opaque ciphertext, so it's safe to store server-side — add an encrypted_private_keys table keyed by user + method. That's the part that pays off most: right now a new device has no way to get the key, which is exactly why KeyImportService.swift makes people paste a key bundle in by hand. With server-stored wrapped blobs, mobile onboarding becomes "log in, enter password" and the manual import goes away.

Multiple copies also handle PRF's sharp edge: a non-syncing platform authenticator produces a different credential per device, so each device's PRF output wraps its own copy of the same KEK. You enroll, you don't re-key.

What this does and doesn't buy you
It fixes: keys sitting in plaintext on disk, keys in browser-profile backups, keys readable on a shared machine, keys surviving logout.

It does not fix XSS. Once the user unlocks, the key is in JS memory and any injected script can take it. That's inherent to browser E2EE — no storage mechanism changes it, and treating passkeys as an XSS answer would be overselling them. The lever there is CSP and dependency hygiene, not key storage. Non-extractable CryptoKey objects would genuinely help, but your sealed-box format is TweetNaCl's (ephemeral key + Blake2b-derived nonce + HSalsa20), which WebCrypto can't reproduce without raw shared-secret access — and changing the format breaks every existing file_key_refs row and the iOS client. Not worth it.

A pragmatic sequencing
The gap between "plaintext on disk" and "wrapped at all" is far larger than the gap between PBKDF2 and Argon2id. You already have working PBKDF2-SHA256 at 600k iterations in crypto.ts:186-209 — that's still OWASP's current parameter, and it's unused. So:

Wire the existing PIN/password wrapper into keystore.ts, move off localStorage to IndexedDB, and add a one-time migration that re-wraps existing plaintext keys on next login and deletes the old entry. This is a day's work with no backend change and closes the actual hole.
Add the server-side wrapped-blob table and the recovery code — this is what unlocks multi-device and kills the iOS manual import.
Add passkey PRF as an additional unlock method on top, with password as the fallback for browsers that don't support it.
Swap PBKDF2 for Argon2id whenever you're willing to take a WASM dependency (hash-wasm or similar — WebCrypto has no Argon2). This is the least urgent item despite being the one the docstring names.
One flag on step 3: you have no WebAuthn anywhere in the codebase today — I checked, there's no registration ceremony, no credential table, nothing. So it's not "add an extension to existing passkey login," it's building passkey support from scratch, plus PRF. Budget accordingly; steps 1 and 2 give you most of the security benefit for a fraction of that.

Want me to draft step 1 against the existing crypto module?