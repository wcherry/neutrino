use std::{
    env,
    path::{Path, PathBuf},
    process::{self, Command},
};

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
            "Usage: cargo xtask <task> [args...]\n\nTasks:\n  build-web        Build the web app\n  e2e [args...]    Run e2e tests (extra args forwarded to run-tests.sh)\n  docker           Build the Docker image"
        );
        process::exit(1);
    });
    let extra: Vec<String> = args.collect();
    let cfg = config_from_metadata();

    match task.as_str() {
        "build-web" => build_web(&cfg.web_dir),
        "e2e" => run_e2e(&cfg.e2e_dir, &extra),
        "docker" => build_docker(&cfg.workspace_root, &cfg.docker_image),
        "dev" => run_dev(&cfg.web_dir, &cfg.workspace_root),
        "storybook" => run_storybook(&cfg.web_dir),
        _ => {
            eprintln!("Unknown task: {task}\n\nTasks: build-web, e2e, docker, dev, storybook");
            process::exit(1);
        }
    }
}

fn config_from_metadata() -> Config {
    let metadata = cargo_metadata::MetadataCommand::new()
        .no_deps()
        .exec()
        .expect("cargo metadata failed");

    let pkg = metadata.root_package().expect("no root package");
    let neutrino = &pkg.metadata["neutrino"];
    let root = metadata.workspace_root.as_std_path();

    let web = neutrino["web_dir"].as_str().expect("[package.metadata.neutrino] web_dir missing");
    let e2e = neutrino["e2e_dir"].as_str().expect("[package.metadata.neutrino] e2e_dir missing");
    let image = neutrino["docker_image"].as_str().expect("[package.metadata.neutrino] docker_image missing");

    Config {
        web_dir: root.join(web),
        e2e_dir: root.join(e2e),
        workspace_root: root.to_path_buf(),
        docker_image: image.to_string(),
    }
}

fn build_web(dir: &Path) {
    run("pnpm", &["build"], dir);
}

fn run_e2e(dir: &Path, extra: &[String]) {
    let mut args = vec!["scripts/run-tests.sh".to_string()];
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

fn run_dev(web_dir: &Path, root: &Path) {
    let mut backend = Command::new("cargo")
        .args(["run"])
        .current_dir(root)
        .spawn()
        .expect("failed to spawn cargo run");

    let mut frontend = Command::new("pnpm")
        .args(["dev"])
        .current_dir(web_dir)
        .spawn()
        .expect("failed to spawn pnpm dev");

    loop {
        if let Some(status) = frontend.try_wait().expect("failed to wait on pnpm dev") {
            backend.kill().ok();
            process::exit(status.code().unwrap_or(1));
        }
        if let Some(status) = backend.try_wait().expect("failed to wait on cargo run") {
            frontend.kill().ok();
            process::exit(status.code().unwrap_or(1));
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
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
