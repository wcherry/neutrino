//! `neutrino-decrypt` — open one encrypted Drive file from the server side.
//!
//! The server holds ciphertext and nothing else. That is the whole point of the
//! client-only key architecture, and it means a tool that runs *on* the server
//! is still, cryptographically, an ordinary client: it can find the blob and
//! the sealed DEK on its own, but the key that opens them has to be carried in
//! by hand.
//!
//! What it needs is the account's recovery kit. The kit is not a hint or a
//! reset token — it is the keyring itself, every Curve25519 secret the account
//! has held, printed in Crockford base32 (see `kit.rs`). Given it, this tool
//! does exactly what the browser does: resolve the file's `key_version` against
//! the keyring, `crypto_box_seal_open` the DEK, and decrypt the blob with
//! XChaCha20-Poly1305.
//!
//! The one thing it cannot do is invent a key. A kit printed before a rotation
//! does not contain the key that rotation minted; no amount of server access
//! changes that, and there is deliberately no fallback. See
//! `agent_docs/client-only-key-architecture.md`.
//!
//! ## Handling
//!
//! A kit passed on the command line would land in shell history and in `ps`, so
//! there is no `--kit-text`: it comes from a file or from stdin. The decrypted
//! bytes are written where you say and nowhere else — nothing is cached, and
//! the tool never writes to the database.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use dryoc::classic::crypto_box::crypto_box_seal_open;
use dryoc::constants::CRYPTO_BOX_SEALBYTES;

mod blob;
mod db;
mod keyfile;
mod kit;
mod schema;

use kit::Keyring;

const USAGE: &str = "\
neutrino-decrypt — decrypt one Drive file on the server

USAGE:
    neutrino-decrypt info     <FILE_ID> [OPTIONS]
    neutrino-decrypt versions <FILE_ID> [OPTIONS]
    neutrino-decrypt file     <FILE_ID> [OPTIONS]

COMMANDS:
    info        What the file is, which key version opens it, and — if a key
                was supplied — whether that key is the right one. Decrypts
                nothing but the metadata.
    versions    The stored versions of the file, newest first, with the id to
                pass to --file-version.
    file        Decrypt the file and write the plaintext out.

KEY (one of these, or `info` runs without a key):
    --kit <PATH>          The account's recovery kit. `-` reads stdin. This is
                          the whole keyring, so every key version is covered.
    --secret-key <B64URL> A single Curve25519 secret key, base64url. Opens the
                          file only if it is the version the file was sealed to.

OPTIONS:
    --user <USER_ID>      Whose sealed copy of the key to open. Defaults to the
                          file's owner. A shared file has one per recipient.
    --file-version <ID>   Decrypt a stored version instead of the current bytes.
    --out <PATH>          Where to write the plaintext. `-` writes stdout.
                          Defaults to the file's own name in the current
                          directory.
    --force               Overwrite the output file if it exists.
    --db <PATH>           SQLite database. Default: $DATABASE_URL, else
                          ./data/neutrino.db
    --storage <PATH>      Storage root. Default: $STORAGE_PATH, else ./storage
    --no-key-file         Do not consult the account's stored key file, which
                          would otherwise recover retired key versions the kit
                          does not carry.
    -h, --help            This text.
";

fn main() -> ExitCode {
    // The app's own `.env`, so running this from the deploy directory finds the
    // database and storage root without being told where they are.
    dotenvy::dotenv().ok();

    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("error: {message}");
            ExitCode::FAILURE
        }
    }
}

// ── Arguments ─────────────────────────────────────────────────────────────────

struct Args {
    command: String,
    file_id: String,
    kit_path: Option<String>,
    secret_key: Option<String>,
    user_id: Option<String>,
    file_version: Option<String>,
    out: Option<String>,
    force: bool,
    database_url: String,
    storage_root: PathBuf,
    use_key_file: bool,
}

fn parse_args() -> Result<Option<Args>, String> {
    let mut raw = std::env::args().skip(1);
    let command = match raw.next() {
        Some(c) if c == "-h" || c == "--help" => return Ok(None),
        Some(c) => c,
        None => return Ok(None),
    };
    if !matches!(command.as_str(), "info" | "versions" | "file") {
        return Err(format!("unknown command `{command}` — try --help"));
    }

    let file_id = raw
        .next()
        .filter(|a| !a.starts_with('-'))
        .ok_or_else(|| format!("`{command}` needs a file id"))?;

    let mut args = Args {
        command,
        file_id,
        kit_path: None,
        secret_key: None,
        user_id: None,
        file_version: None,
        out: None,
        force: false,
        database_url: std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "./data/neutrino.db".to_string()),
        storage_root: PathBuf::from(
            std::env::var("STORAGE_PATH").unwrap_or_else(|_| "./storage".to_string()),
        ),
        use_key_file: true,
    };

    while let Some(flag) = raw.next() {
        let mut value = || {
            raw.next()
                .ok_or_else(|| format!("{flag} needs a value"))
        };
        match flag.as_str() {
            "--kit" => args.kit_path = Some(value()?),
            "--secret-key" => args.secret_key = Some(value()?),
            "--user" => args.user_id = Some(value()?),
            "--file-version" => args.file_version = Some(value()?),
            "--out" => args.out = Some(value()?),
            "--db" => args.database_url = value()?,
            "--storage" => args.storage_root = PathBuf::from(value()?),
            "--force" => args.force = true,
            "--no-key-file" => args.use_key_file = false,
            "-h" | "--help" => return Ok(None),
            other => return Err(format!("unknown option `{other}` — try --help")),
        }
    }

    if args.kit_path.is_some() && args.secret_key.is_some() {
        return Err("pass either --kit or --secret-key, not both".to_string());
    }
    if args.command == "file" && args.kit_path.is_none() && args.secret_key.is_none() {
        return Err("`file` needs a key — pass --kit, or --secret-key".to_string());
    }
    Ok(Some(args))
}

fn run() -> Result<(), String> {
    let Some(args) = parse_args()? else {
        print!("{USAGE}");
        return Ok(());
    };

    let mut conn = db::connect(&args.database_url)?;
    let file = db::find_file(&mut conn, &args.file_id)?;

    match args.command.as_str() {
        "versions" => list_versions(&mut conn, &file),
        "info" => show_info(&mut conn, &args, &file),
        "file" => decrypt_file(&mut conn, &args, &file),
        _ => unreachable!("command was validated during parsing"),
    }
}

// ── Key material ──────────────────────────────────────────────────────────────

/// Read the kit or the bare key the caller supplied.
///
/// `key_version` is what the bare-key form is stamped with: a loose secret key
/// carries no version, and the file's key ref is the only thing that knows
/// which one it wants.
fn load_keyring(args: &Args, key_version: i32) -> Result<Option<Keyring>, String> {
    if let Some(path) = &args.kit_path {
        let text = if path == "-" {
            let mut buffer = String::new();
            std::io::stdin()
                .read_to_string(&mut buffer)
                .map_err(|e| format!("cannot read the recovery kit from stdin: {e}"))?;
            buffer
        } else {
            std::fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?
        };
        return Ok(Some(kit::parse_recovery_kit(&text)?));
    }

    if let Some(encoded) = &args.secret_key {
        let bytes = URL_SAFE_NO_PAD
            .decode(encoded.trim())
            .map_err(|e| format!("--secret-key is not valid base64url: {e}"))?;
        if bytes.len() != 32 {
            return Err(format!(
                "--secret-key must be 32 bytes, got {}",
                bytes.len()
            ));
        }
        let mut secret_key = [0u8; 32];
        secret_key.copy_from_slice(&bytes);
        return Ok(Some(kit::keyring_from_secret_key(secret_key, key_version)));
    }

    Ok(None)
}

/// The key ref whose sealed DEK this run should open.
fn choose_key_ref<'a>(
    refs: &'a [db::KeyRef],
    file: &db::FileRow,
    requested_user: Option<&str>,
) -> Result<&'a db::KeyRef, String> {
    if let Some(user_id) = requested_user {
        return refs.iter().find(|r| r.user_id == user_id).ok_or_else(|| {
            format!(
                "{user_id} has no key for this file — it is sealed for: {}",
                refs.iter()
                    .map(|r| r.user_id.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        });
    }
    // The owner's copy is the one a recovery is nearly always about, and on a
    // shared file it is the only ref whose holder can be inferred.
    refs.iter()
        .find(|r| r.user_id == file.owner_id)
        .or_else(|| if refs.len() == 1 { refs.first() } else { None })
        .ok_or_else(|| {
            format!(
                "this file has no key for its owner; pass --user with one of: {}",
                refs.iter()
                    .map(|r| r.user_id.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
}

/// Confirm the supplied key really is the account's, before trying to decrypt.
///
/// The server's `user_public_keys` row is untrusted for supplying a key but
/// perfectly good for this comparison: if the kit's derived public half differs
/// from the one the account registered, the kit belongs to somebody else, and
/// saying so beats reporting a decryption failure that looks like data damage.
fn check_against_registered_key(
    conn: &mut diesel::sqlite::SqliteConnection,
    user_id: &str,
    keyring: &Keyring,
    key_version: i32,
) -> Result<(), String> {
    let Some(entry) = keyring.entry_for_version(key_version) else {
        return Ok(());
    };
    let registered = db::public_keys_for_user(conn, user_id)?;
    let Some(row) = registered.iter().find(|r| r.version == key_version) else {
        return Ok(());
    };
    if row.public_key != URL_SAFE_NO_PAD.encode(entry.public_key) {
        return Err(format!(
            "the key supplied for version {key_version} is not the one {user_id} registered — \
             this kit belongs to a different account"
        ));
    }
    Ok(())
}

fn open_dek(key_ref: &db::KeyRef, keyring: &Keyring) -> Result<[u8; 32], String> {
    let entry = keyring.entry_for_version(key_ref.key_version).ok_or_else(|| {
        format!(
            "this file needs key version {}, which the supplied key does not include \
             (it has {}). A recovery kit printed before a rotation cannot contain the key \
             that rotation minted.",
            key_ref.key_version,
            describe_versions(&keyring.versions())
        )
    })?;

    let sealed = URL_SAFE_NO_PAD
        .decode(&key_ref.encrypted_file_key)
        .map_err(|e| format!("the stored file key is not valid base64url: {e}"))?;
    if sealed.len() <= CRYPTO_BOX_SEALBYTES {
        return Err("the stored file key is too short to be a sealed box".to_string());
    }

    let mut dek = vec![0u8; sealed.len() - CRYPTO_BOX_SEALBYTES];
    crypto_box_seal_open(&mut dek, &sealed, &entry.public_key, &entry.secret_key)
        .map_err(|_| "the key does not open this file's sealed DEK".to_string())?;
    if dek.len() != 32 {
        return Err(format!("the file key is {} bytes, expected 32", dek.len()));
    }

    let mut out = [0u8; 32];
    out.copy_from_slice(&dek);
    Ok(out)
}

fn describe_versions(versions: &[i32]) -> String {
    if versions.is_empty() {
        return "no versions".to_string();
    }
    format!(
        "version{} {}",
        if versions.len() == 1 { "" } else { "s" },
        versions
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

// ── Commands ──────────────────────────────────────────────────────────────────

fn list_versions(
    conn: &mut diesel::sqlite::SqliteConnection,
    file: &db::FileRow,
) -> Result<(), String> {
    let versions = db::versions_for_file(conn, &file.id)?;
    if versions.is_empty() {
        println!("no stored versions — the file's current bytes are all there is");
        return Ok(());
    }
    println!("{:<38} {:>4} {:>12}  CREATED", "VERSION ID", "NUM", "BYTES");
    for version in &versions {
        let live = if version.storage_path == file.storage_path { " (live)" } else { "" };
        let label = version
            .label
            .as_deref()
            .map(|l| format!("  {l}"))
            .unwrap_or_default();
        println!(
            "{:<38} {:>4} {:>12}  {}{live}{label}",
            version.id, version.version_number, version.size_bytes, version.created_at
        );
    }
    Ok(())
}

fn show_info(
    conn: &mut diesel::sqlite::SqliteConnection,
    args: &Args,
    file: &db::FileRow,
) -> Result<(), String> {
    println!("file          {}", file.id);
    println!(
        "owner         {}{}",
        file.owner_id,
        db::email_for_user(conn, &file.owner_id)
            .map(|e| format!(" ({e})"))
            .unwrap_or_default()
    );
    println!("name          {}", file.name);
    println!("mime type     {}", file.mime_type);
    println!("size          {} bytes (ciphertext)", file.size_bytes);
    if let Some(deleted_at) = file.deleted_at {
        println!("deleted       {deleted_at} — the blob may already be gone");
    }

    let path = args.storage_root.join(&file.storage_path);
    println!(
        "blob          {} ({})",
        path.display(),
        if path.exists() { "present" } else { "MISSING" }
    );

    let refs = db::key_refs_for_file(conn, &file.id)?;
    if refs.is_empty() {
        println!("encryption    none — this file predates E2EE and is plaintext on disk");
        return Ok(());
    }
    println!("sealed for");
    for key_ref in &refs {
        println!(
            "              {} at key version {}",
            key_ref.user_id, key_ref.key_version
        );
    }

    let key_ref = choose_key_ref(&refs, file, args.user_id.as_deref())?;
    let registered = db::public_keys_for_user(conn, &key_ref.user_id)?;
    let active = registered
        .iter()
        .find(|r| r.retired_at.is_none())
        .map(|r| format!(", active {}", r.version))
        .unwrap_or_default();
    println!(
        "registered    {}{active} for {}",
        describe_versions(&registered.iter().map(|r| r.version).collect::<Vec<_>>()),
        key_ref.user_id
    );

    let Some(mut keyring) = load_keyring(args, key_ref.key_version)? else {
        println!("key           none supplied — pass --kit to check whether it opens this file");
        return Ok(());
    };
    report_key_file(args, &mut keyring, &key_ref.user_id);
    println!("supplied key  {}", describe_versions(&keyring.versions()));

    check_against_registered_key(conn, &key_ref.user_id, &keyring, key_ref.key_version)?;
    let dek = open_dek(key_ref, &keyring)?;
    println!("result        the supplied key opens this file");

    if let Some(metadata) = decrypt_metadata(file, &dek)? {
        println!("metadata      {metadata}");
    }
    Ok(())
}

fn decrypt_file(
    conn: &mut diesel::sqlite::SqliteConnection,
    args: &Args,
    file: &db::FileRow,
) -> Result<(), String> {
    let storage_path = match &args.file_version {
        Some(version_id) => db::versions_for_file(conn, &file.id)?
            .into_iter()
            .find(|v| v.id == *version_id)
            .map(|v| v.storage_path)
            .ok_or_else(|| {
                format!("no stored version {version_id} for this file — try `versions`")
            })?,
        None => file.storage_path.clone(),
    };
    if storage_path.is_empty() {
        return Err("this file row has no blob — it was created but never uploaded".to_string());
    }
    let path = args.storage_root.join(&storage_path);
    let ciphertext =
        std::fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;

    let refs = db::key_refs_for_file(conn, &file.id)?;
    let (plaintext, name) = if refs.is_empty() {
        // Files predating E2EE are stored as they were uploaded. Copying them
        // out is still the useful thing to do; saying so is what keeps the
        // operator from believing a decryption happened.
        eprintln!("note: this file is not encrypted — copying it out as-is");
        (ciphertext, file.name.clone())
    } else {
        let key_ref = choose_key_ref(&refs, file, args.user_id.as_deref())?;
        let mut keyring = load_keyring(args, key_ref.key_version)?
            .expect("`file` requires a key; parsing enforces it");
        report_key_file(args, &mut keyring, &key_ref.user_id);

        check_against_registered_key(conn, &key_ref.user_id, &keyring, key_ref.key_version)?;
        let dek = open_dek(key_ref, &keyring)?;
        let plaintext = blob::decrypt_blob(&ciphertext, &dek)?;

        // The encrypted metadata is the only copy of the name the server could
        // not have altered, so it wins over `files.name` when it is there.
        let name = decrypt_metadata(file, &dek)?
            .and_then(|m| m.name)
            .unwrap_or_else(|| file.name.clone());
        (plaintext, name)
    };

    write_output(args, &plaintext, &name, &file.id)
}

/// Where the plaintext goes, and the guard against writing over something.
fn write_output(args: &Args, plaintext: &[u8], name: &str, file_id: &str) -> Result<(), String> {
    if args.out.as_deref() == Some("-") {
        use std::io::Write;
        return std::io::stdout()
            .write_all(plaintext)
            .map_err(|e| format!("cannot write to stdout: {e}"));
    }

    let destination = match &args.out {
        Some(out) => PathBuf::from(out),
        None => PathBuf::from(safe_file_name(name, file_id)),
    };
    // The default name comes out of decrypted metadata, which is to say out of
    // data. Refusing to clobber is what stops a recovery from destroying
    // whatever shares that name in the working directory.
    if destination.exists() && !args.force {
        return Err(format!(
            "{} already exists — pass --force to overwrite, or --out to write elsewhere",
            destination.display()
        ));
    }
    std::fs::write(&destination, plaintext)
        .map_err(|e| format!("cannot write {}: {e}", destination.display()))?;
    eprintln!(
        "wrote {} bytes to {}",
        plaintext.len(),
        destination.display()
    );
    Ok(())
}

/// Reduce a name from decrypted metadata to something safe to create in the
/// working directory: the last component only, and never a traversal.
fn safe_file_name(name: &str, file_id: &str) -> String {
    Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty() && *n != "." && *n != "..")
        .map(|n| n.to_string())
        .unwrap_or_else(|| format!("{file_id}.bin"))
}

struct Metadata {
    name: Option<String>,
    raw: String,
}

impl std::fmt::Display for Metadata {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.raw)
    }
}

/// Open `files.encrypted_metadata`, the `{name, mimeType}` JSON sealed to the
/// same DEK as the content.
fn decrypt_metadata(file: &db::FileRow, dek: &[u8; 32]) -> Result<Option<Metadata>, String> {
    let Some(encoded) = &file.encrypted_metadata else {
        return Ok(None);
    };
    let ciphertext = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|e| format!("encrypted_metadata is not valid base64url: {e}"))?;
    let plaintext = blob::decrypt_blob(&ciphertext, dek)?;
    let raw = String::from_utf8(plaintext)
        .map_err(|e| format!("decrypted metadata is not valid UTF-8: {e}"))?;

    let name = serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| v.get("name").and_then(|n| n.as_str()).map(String::from));
    Ok(Some(Metadata { name, raw }))
}

/// Fold in the stored key file, reporting what it added.
///
/// Failing to read it is a note, not an error: the file is an extra source of
/// retired keys, and a run whose kit already covers the version in hand does
/// not need it at all.
fn report_key_file(args: &Args, keyring: &mut Keyring, user_id: &str) {
    if !args.use_key_file {
        return;
    }
    match keyfile::merge_key_file(keyring, &args.storage_root, user_id) {
        Ok(recovered) if !recovered.is_empty() => {
            eprintln!(
                "note: recovered key {} from the account's stored key file",
                describe_versions(&recovered)
            );
        }
        Ok(_) => {}
        Err(message) => eprintln!("note: could not read the stored key file — {message}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_metadata_name_cannot_escape_the_working_directory() {
        assert_eq!(safe_file_name("../../etc/passwd", "f1"), "passwd");
        assert_eq!(safe_file_name("/etc/passwd", "f1"), "passwd");
        assert_eq!(safe_file_name("..", "f1"), "f1.bin");
        assert_eq!(safe_file_name("", "f1"), "f1.bin");
        assert_eq!(safe_file_name("report.pdf", "f1"), "report.pdf");
    }

    #[test]
    fn describes_which_key_versions_are_in_hand() {
        assert_eq!(describe_versions(&[]), "no versions");
        assert_eq!(describe_versions(&[1]), "version 1");
        assert_eq!(describe_versions(&[1, 2, 3]), "versions 1, 2, 3");
    }
}
