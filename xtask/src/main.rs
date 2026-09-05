use std::{
    env, fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{self, Command},
    thread,
    time::{Duration, Instant},
};

/// Facial-recognition model used by the background worker.
const FACE_MODEL_URL: &str =
    "https://github.com/atomashpolskiy/rustface/raw/master/model/seeta_fd_frontal_v1.0.bin";
const FACE_MODEL_REL: &str = "models/seeta_fd_frontal_v1.0.bin";

/// Secrets the backend refuses to start without. `cargo xtask setup` generates a
/// value for any of these the repo-root `.env` does not already define.
const REQUIRED_ENV_SECRETS: [&str; 2] = ["JWT_SECRET", "WORKER_SECRET"];

/// Docker secrets `e2e/docker-compose-test.yml` mounts out of `e2e/secrets/`.
/// The directory is gitignored, so a fresh clone has to generate them.
const E2E_SECRET_FILES: [&str; 2] = ["jwt_secret.txt", "worker_secret.txt"];

/// How long `cargo xtask dev` waits for the backend's `/health` before giving up.
/// Generous because the first `cargo run` of a session compiles the whole server
/// before it binds anything.
const BACKEND_HEALTH_TIMEOUT: Duration = Duration::from_secs(600);

/// Port the backend binds when neither the environment nor `.env` sets `PORT`.
/// Matches the default in `Config::from_env`.
const DEFAULT_BACKEND_PORT: &str = "8080";

struct Config {
    web_dir: PathBuf,
    e2e_dir: PathBuf,
    workspace_root: PathBuf,
    docker_image: String,
}

fn main() {
    let mut args = env::args().skip(1);
    let task = args.next().unwrap_or_else(|| {
        eprintln!(
            "Usage: cargo xtask <task> [args...]\n\nTasks:\n  setup            Run every prerequisite step for backend, web and e2e\n  build-web        Build the web app\n  e2e [args...]    Run e2e tests (extra args forwarded to run-tests.sh)\n  perf [args...]   Run the performance suite (extra args forwarded to run-perf.sh)\n  docker           Build the Docker image\n  fetch-model      Download the worker's facial-recognition model"
        );
        process::exit(1);
    });
    let extra: Vec<String> = args.collect();
    let cfg = config_from_metadata();

    match task.as_str() {
        "setup" => setup(&cfg),
        "build-web" => build_web(&cfg.workspace_root),
        "e2e" => run_e2e(&cfg.e2e_dir, &extra),
        "perf" => run_perf(&cfg.e2e_dir, &extra),
        "docker" => build_docker(&cfg.workspace_root, &cfg.docker_image),
        "dev" => run_dev(&cfg.workspace_root),
        "storybook" => run_storybook(&cfg.web_dir),
        "fetch-model" => ensure_face_model(&cfg.workspace_root),
        _ => {
            eprintln!(
                "Unknown task: {task}\n\nTasks: setup, build-web, e2e, perf, docker, dev, storybook, fetch-model"
            );
            process::exit(1);
        }
    }
}

/// Every prerequisite step a fresh clone needs before `cargo run`, `pnpm dev` or
/// `cargo xtask e2e` will work. Each step is idempotent: nothing here overwrites a
/// file that already exists, so it is safe to re-run whenever something looks
/// half-installed.
fn setup(cfg: &Config) {
    let root = &cfg.workspace_root;
    require_tools(&["pnpm", "node", "openssl", "curl", "docker"]);

    section("Rust backend");
    ensure_env_secrets(root);
    ensure_face_model(root);
    run("cargo", &["fetch"], root);

    // One install at the workspace root covers `web/` and `e2e/` both — the E2EE
    // fixtures resolve libsodium out of `web/packages/e2e-crypto`, which an install
    // inside `e2e/` alone never touches.
    section("Web frontend and e2e dependencies");
    run("pnpm", &["install"], root);

    section("e2e tests");
    run(
        "pnpm",
        &["exec", "playwright", "install", "chromium"],
        &cfg.e2e_dir,
    );
    ensure_e2e_secrets(&cfg.e2e_dir);
    ensure_e2e_env(&cfg.e2e_dir);

    section("Setup complete");
    println!("  cargo xtask dev    backend + worker + frontend");
    println!("  cargo xtask e2e    Playwright suite against an isolated Docker stack");
    println!("  cargo xtask perf   performance suite against the same stack");
}

fn section(title: &str) {
    println!("\n== {title} ==");
}

/// Fails with every missing tool listed at once, rather than one per re-run.
fn require_tools(tools: &[&str]) {
    let missing: Vec<&str> = tools.iter().copied().filter(|t| !have_tool(t)).collect();
    if !missing.is_empty() {
        eprintln!("Missing required tools: {}", missing.join(", "));
        eprintln!("Install them and re-run `cargo xtask setup`.");
        if missing.contains(&"pnpm") {
            eprintln!("pnpm: `corepack enable` picks up the version pinned in package.json.");
        }
        process::exit(1);
    }
}

fn have_tool(tool: &str) -> bool {
    Command::new("sh")
        .args(["-c", &format!("command -v {tool}")])
        .stdout(process::Stdio::null())
        .stderr(process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Writes `JWT_SECRET` / `WORKER_SECRET` into the repo-root `.env`, which the server
/// and worker both refuse to start without. An existing `.env` is appended to, never
/// rewritten, so local overrides survive.
fn ensure_env_secrets(root: &Path) {
    let path = root.join(".env");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let missing: Vec<&str> = REQUIRED_ENV_SECRETS
        .iter()
        .copied()
        .filter(|key| !defines_key(&existing, key))
        .collect();

    if missing.is_empty() {
        println!(".env already defines {}", REQUIRED_ENV_SECRETS.join(", "));
        return;
    }

    let mut out = existing.clone();
    if out.is_empty() {
        out.push_str("# Generated by `cargo xtask setup`.\n");
    } else if !out.ends_with('\n') {
        out.push('\n');
    }
    for key in &missing {
        out.push_str(&format!("{key}={}\n", random_hex_32()));
    }
    fs::write(&path, out).unwrap_or_else(|e| panic!("failed to write {}: {e}", path.display()));
    println!("wrote {} to {}", missing.join(", "), path.display());
}

/// True if `contents` sets `key` on a line of its own, comments aside.
fn defines_key(contents: &str, key: &str) -> bool {
    contents.lines().any(|line| {
        let line = line.trim_start();
        !line.starts_with('#')
            && line
                .strip_prefix(key)
                .is_some_and(|rest| rest.trim_start().starts_with('='))
    })
}

fn ensure_e2e_secrets(e2e_dir: &Path) {
    let dir = e2e_dir.join("secrets");
    fs::create_dir_all(&dir).expect("failed to create e2e/secrets");
    for name in E2E_SECRET_FILES {
        let path = dir.join(name);
        // Any non-empty value works; the services only need to agree on it. An empty
        // file is treated as absent — the stack starts and then fails auth.
        let filled = fs::read_to_string(&path).is_ok_and(|s| !s.trim().is_empty());
        if filled {
            println!("secret already present: {}", path.display());
            continue;
        }
        fs::write(&path, format!("{}\n", random_hex_32()))
            .unwrap_or_else(|e| panic!("failed to write {}: {e}", path.display()));
        println!("generated {}", path.display());
    }
}

fn ensure_e2e_env(e2e_dir: &Path) {
    let path = e2e_dir.join(".env");
    if path.exists() {
        println!("e2e/.env already present");
        return;
    }
    let example = e2e_dir.join(".env.example");
    fs::copy(&example, &path)
        .unwrap_or_else(|e| panic!("failed to copy {}: {e}", example.display()));
    println!("created {} from .env.example", path.display());
}

fn random_hex_32() -> String {
    let out = Command::new("openssl")
        .args(["rand", "-hex", "32"])
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn `openssl`: {e}"));
    if !out.status.success() {
        eprintln!("`openssl rand -hex 32` failed");
        process::exit(out.status.code().unwrap_or(1));
    }
    String::from_utf8(out.stdout)
        .expect("openssl returned non-UTF-8")
        .trim()
        .to_string()
}

/// Downloads the worker's facial-recognition model if it isn't already present.
/// Runs as a prerequisite before anything that launches the worker.
fn ensure_face_model(root: &Path) {
    let dest = root.join(FACE_MODEL_REL);
    if dest.exists() {
        println!("face model already present at {}", dest.display());
        return;
    }
    let dir = dest.parent().expect("model path has no parent");
    std::fs::create_dir_all(dir).expect("failed to create models directory");
    println!("downloading face model to {}", dest.display());
    run(
        "curl",
        &["-fsSL", "-o", dest.to_str().unwrap(), FACE_MODEL_URL],
        root,
    );
}

fn config_from_metadata() -> Config {
    let metadata = cargo_metadata::MetadataCommand::new()
        .no_deps()
        .exec()
        .expect("cargo metadata failed");

    let pkg = metadata.root_package().expect("no root package");
    let neutrino = &pkg.metadata["neutrino"];
    let root = metadata.workspace_root.as_std_path();

    let web = neutrino["web_dir"]
        .as_str()
        .expect("[package.metadata.neutrino] web_dir missing");
    let e2e = neutrino["e2e_dir"]
        .as_str()
        .expect("[package.metadata.neutrino] e2e_dir missing");
    let image = neutrino["docker_image"]
        .as_str()
        .expect("[package.metadata.neutrino] docker_image missing");

    Config {
        web_dir: root.join(web),
        e2e_dir: root.join(e2e),
        workspace_root: root.to_path_buf(),
        docker_image: image.to_string(),
    }
}

/// `pnpm build` is a root script — turbo.json and the turbo tasks live at the
/// pnpm workspace root, which is the repo root.
fn build_web(root: &Path) {
    run("pnpm", &["build"], root);
}

fn run_e2e(dir: &Path, extra: &[String]) {
    run_e2e_script(dir, "scripts/run-tests.sh", extra);
}

/// The performance suite, which is a separate script rather than a flag on
/// `run-tests.sh`: `run-perf.sh` exports `PERF=1`, and that swaps the Playwright
/// project entirely — different timeouts, no retries, tracing off — as
/// `e2e/playwright.config.ts` explains. It also summarises `perf-results.json`
/// afterwards, which a functional run has nothing to write.
fn run_perf(dir: &Path, extra: &[String]) {
    run_e2e_script(dir, "scripts/run-perf.sh", extra);
}

/// Both suites are a bash script in `e2e/` that brings the Docker stack up and
/// down around Playwright, with everything after the task name handed straight to
/// it — `cargo perf --grep "D3"` is `./scripts/run-perf.sh --grep "D3"`.
fn run_e2e_script(dir: &Path, script: &str, extra: &[String]) {
    let mut args = vec![script.to_string()];
    args.extend_from_slice(extra);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    run("bash", &args, dir);
}

fn build_docker(root: &Path, image: &str) {
    run("docker", &["build", "-t", image, "."], root);
}

fn run_storybook(web_dir: &Path) {
    run("pnpm", &["--filter", "@neutrino/ui", "storybook"], web_dir);
}

fn run_dev(root: &Path) {
    // Prereq: make sure the worker's face model is on disk before starting.
    ensure_face_model(root);

    let mut backend = Command::new("cargo")
        .args(["run"])
        .current_dir(root)
        .spawn()
        .expect("failed to spawn cargo run");

    // The worker authenticates against the backend and the frontend proxies to it,
    // so both spend their first seconds erroring out if they start first. Hold them
    // until `/health` answers.
    wait_for_backend(root, &mut backend);

    let mut worker = Command::new("cargo")
        .args(["run", "-p", "worker"])
        .current_dir(root)
        .spawn()
        .expect("failed to spawn worker");

    let mut frontend = Command::new("pnpm")
        .args(["dev"])
        .current_dir(root)
        .spawn()
        .expect("failed to spawn pnpm dev");

    loop {
        if let Some(status) = frontend.try_wait().expect("failed to wait on pnpm dev") {
            backend.kill().ok();
            worker.kill().ok();
            process::exit(status.code().unwrap_or(1));
        }
        if let Some(status) = backend.try_wait().expect("failed to wait on cargo run") {
            frontend.kill().ok();
            worker.kill().ok();
            process::exit(status.code().unwrap_or(1));
        }
        if let Some(status) = worker.try_wait().expect("failed to wait on worker") {
            frontend.kill().ok();
            backend.kill().ok();
            process::exit(status.code().unwrap_or(1));
        }
        thread::sleep(Duration::from_millis(250));
    }
}

/// Blocks until the backend answers `/health` with a 200. Exits instead of
/// returning if the backend dies first or never comes up, so `dev` never leaves a
/// worker and a frontend talking to nothing.
fn wait_for_backend(root: &Path, backend: &mut process::Child) {
    let addr = format!("127.0.0.1:{}", backend_port(root));
    println!("waiting for the backend to be healthy at http://{addr}/health");

    let deadline = Instant::now() + BACKEND_HEALTH_TIMEOUT;
    loop {
        if let Some(status) = backend.try_wait().expect("failed to wait on cargo run") {
            eprintln!("backend exited before it became healthy");
            process::exit(status.code().unwrap_or(1));
        }
        if backend_healthy(&addr) {
            println!("backend is healthy — starting worker and frontend");
            return;
        }
        if Instant::now() >= deadline {
            eprintln!(
                "backend was not healthy within {}s, giving up",
                BACKEND_HEALTH_TIMEOUT.as_secs()
            );
            backend.kill().ok();
            process::exit(1);
        }
        thread::sleep(Duration::from_millis(500));
    }
}

/// One `GET /health`. Every failure — refused connection, timeout, non-200 — is
/// just "not ready yet"; the caller retries.
fn backend_healthy(addr: &str) -> bool {
    let Some(sock) = addr.to_socket_addrs().ok().and_then(|mut a| a.next()) else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&sock, Duration::from_secs(2)) else {
        return false;
    };
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();

    let request = b"GET /health HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }
    let mut response = Vec::new();
    if stream.read_to_end(&mut response).is_err() {
        return false;
    }
    String::from_utf8_lossy(&response)
        .lines()
        .next()
        .is_some_and(|status| status.contains(" 200 "))
}

/// The port the backend will bind, resolved the way `Config::from_env` resolves it:
/// the environment first, then the repo-root `.env` `cargo run` loads, then 8080.
fn backend_port(root: &Path) -> String {
    if let Some(port) = env::var("PORT").ok().filter(|p| !p.trim().is_empty()) {
        return port.trim().to_string();
    }
    fs::read_to_string(root.join(".env"))
        .ok()
        .and_then(|contents| env_file_value(&contents, "PORT"))
        .unwrap_or_else(|| DEFAULT_BACKEND_PORT.to_string())
}

/// Value `key` is assigned in a `.env`, if any. Deliberately minimal: it handles
/// the plain `KEY=value` and quoted forms this repo's `.env` uses, nothing more.
fn env_file_value(contents: &str, key: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let line = line.trim_start();
        if line.starts_with('#') {
            return None;
        }
        let value = line
            .strip_prefix(key)?
            .trim_start()
            .strip_prefix('=')?
            .trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value);
        (!value.is_empty()).then(|| value.to_string())
    })
}

fn run(cmd: &str, args: &[&str], dir: &Path) {
    let status = Command::new(cmd)
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap_or_else(|e| panic!("failed to spawn `{cmd}`: {e}"));
    if !status.success() {
        process::exit(status.code().unwrap_or(1));
    }
}
