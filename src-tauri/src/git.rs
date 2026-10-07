//! Git for workspace folders, through the system `git` so people's own
//! credentials (SSH keys, credential managers) and config apply.
//!
//! Every command runs a fixed argument list — no shell, nothing the frontend
//! can splice in except paths after `--` and a commit message after `-m`.
//! Nothing here runs on its own: each command is a button the user pressed.

use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

/// Local operations (status, add, commit) finish quickly; a hung one means something is wrong.
const LOCAL_TIMEOUT: Duration = Duration::from_secs(30);
/// Network operations (fetch, pull, push) get longer, but never hang forever on a dead remote.
const NETWORK_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOutput {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    /// Whether the folder is inside a git work tree at all.
    pub is_repo: bool,
    /// The folder's path relative to the repository root, with a trailing "/" ("" at the root).
    pub prefix: String,
    /// "merge" or "rebase" while one is in progress (e.g. a pull that hit conflicts), else None.
    pub operation: Option<String>,
}

fn run(cwd: &str, args: &[&str], timeout: Duration) -> Result<GitOutput, String> {
    if !Path::new(cwd).is_dir() {
        return Err(format!("{cwd} isn't a folder"));
    }
    let mut command = Command::new("git");
    // CREATE_NO_WINDOW: the release app has no console, so Windows would open one for each git run.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .args(args)
        .current_dir(cwd)
        // Never wait for a password prompt nobody can see; fail with git's message instead.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        // Read-only commands shouldn't take the index lock and race a terminal.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "git isn't installed (or isn't on the PATH)".to_string()
            } else {
                format!("couldn't run git: {e}")
            }
        })?;

    // Drain both pipes on their own threads so a large output can't fill a pipe and block git.
    // Each reports on a channel, so waiting is a blocking receive with the timeout: no polling.
    let out = child.stdout.take().ok_or("no stdout")?;
    let err = child.stderr.take().ok_or("no stderr")?;
    let (tx, rx) = mpsc::channel::<(bool, String)>();
    for (is_out, mut pipe) in [
        (true, Box::new(out) as Box<dyn Read + Send>),
        (false, Box::new(err)),
    ] {
        let tx = tx.clone();
        thread::spawn(move || {
            let mut s = String::new();
            let _ = pipe.read_to_string(&mut s);
            let _ = tx.send((is_out, s));
        });
    }
    drop(tx);

    let deadline = Instant::now() + timeout;
    let stopped = |child: &mut std::process::Child| {
        let _ = child.kill();
        let _ = child.wait();
        Err(format!(
            "git {} took longer than {}s and was stopped",
            args.first().unwrap_or(&""),
            timeout.as_secs()
        ))
    };
    let (mut stdout, mut stderr) = (String::new(), String::new());
    for _ in 0..2 {
        match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok((true, s)) => stdout = s,
            Ok((false, s)) => stderr = s,
            Err(_) => return stopped(&mut child),
        }
    }
    // Both pipes are closed, so git is exiting; only a process that closed them and kept
    // running would get here without an exit status, and the timeout still applies to it.
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if Instant::now() >= deadline => return stopped(&mut child),
            None => thread::sleep(Duration::from_millis(1)),
        }
    };
    Ok(GitOutput {
        code: status.code().unwrap_or(-1),
        stdout,
        stderr,
    })
}

/// Fails with git's own message when the command didn't succeed.
fn ok(output: GitOutput) -> Result<GitOutput, String> {
    if output.code == 0 {
        Ok(output)
    } else {
        let msg = if output.stderr.trim().is_empty() {
            output.stdout.trim()
        } else {
            output.stderr.trim()
        };
        Err(if msg.is_empty() {
            format!("git exited with code {}", output.code)
        } else {
            msg.to_string()
        })
    }
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// Paths come from the app's own file list, but they're still checked: no options, no NULs.
fn check_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("nothing to commit: no files were selected".into());
    }
    for p in paths {
        if p.is_empty()
            || p.starts_with('-')
            || p.contains('\0')
            || p.split('/').any(|seg| seg == "..")
        {
            return Err(format!("refusing an unexpected path: {p}"));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_version() -> Result<String, String> {
    blocking(|| ok(run(".", &["--version"], LOCAL_TIMEOUT)?).map(|o| o.stdout.trim().to_string()))
        .await
}

/// Whether the folder is a repository, where in it, and whether a merge or rebase is under way:
/// one `git rev-parse`, since this runs on every background refresh that re-reads it.
#[tauri::command]
pub async fn git_info(cwd: String) -> Result<GitInfo, String> {
    blocking(move || {
        let out = run(
            &cwd,
            &[
                "rev-parse",
                "--is-inside-work-tree",
                "--show-prefix",
                "--git-path",
                "MERGE_HEAD",
                "--git-path",
                "rebase-merge",
                "--git-path",
                "rebase-apply",
            ],
            LOCAL_TIMEOUT,
        )?;
        Ok(parse_info(&cwd, &out).unwrap_or(GitInfo {
            is_repo: false,
            prefix: String::new(),
            operation: None,
        }))
    })
    .await
}

/// `rev-parse --is-inside-work-tree --show-prefix --git-path …` prints one line each:
/// "true", the prefix ("" at the repository root), then the three paths relative to `cwd`.
/// Outside a repository git fails; inside `.git` it prints "false". Both are "not a repo" (None).
fn parse_info(cwd: &str, out: &GitOutput) -> Option<GitInfo> {
    if out.code != 0 {
        return None;
    }
    let mut lines = out.stdout.split('\n').map(|l| l.trim_end_matches('\r'));
    if lines.next()? != "true" {
        return None;
    }
    let prefix = lines.next()?.to_string();
    let exists =
        |line: Option<&str>| line.is_some_and(|p| !p.is_empty() && Path::new(cwd).join(p).exists());
    let operation = if exists(lines.next()) {
        Some("merge".to_string())
    } else if exists(lines.next()) || exists(lines.next()) {
        Some("rebase".to_string())
    } else {
        None
    };
    Some(GitInfo {
        is_repo: true,
        prefix,
        operation,
    })
}

/// The repository's remotes, for the first push of a branch.
#[tauri::command]
pub async fn git_remotes(cwd: String) -> Result<Vec<String>, String> {
    blocking(move || {
        Ok(ok(run(&cwd, &["remote"], LOCAL_TIMEOUT)?)?
            .stdout
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect())
    })
    .await
}

/// Porcelain v2 status of the workspace folder only (`-- .`).
#[tauri::command]
pub async fn git_status(cwd: String) -> Result<String, String> {
    blocking(move || {
        // core.fsmonitor could name a program to run: opening a repository must not execute anything.
        let args = [
            "-c",
            "core.fsmonitor=false",
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
            "--",
            ".",
        ];
        ok(run(&cwd, &args, LOCAL_TIMEOUT)?).map(|o| o.stdout)
    })
    .await
}

/// Stage exactly `paths` (additions, changes and deletions) and commit only them,
/// leaving anything else that's staged in the repository out of this commit.
#[tauri::command]
pub async fn git_commit(
    cwd: String,
    message: String,
    paths: Vec<String>,
) -> Result<GitOutput, String> {
    blocking(move || {
        check_paths(&paths)?;
        if message.trim().is_empty() {
            return Err("write a commit message first".into());
        }
        let mut add: Vec<&str> = vec!["add", "-A", "--"];
        add.extend(paths.iter().map(String::as_str));
        ok(run(&cwd, &add, LOCAL_TIMEOUT)?)?;
        let mut commit: Vec<&str> = vec!["commit", "-m", &message, "--"];
        commit.extend(paths.iter().map(String::as_str));
        ok(run(&cwd, &commit, LOCAL_TIMEOUT)?)
    })
    .await
}

#[tauri::command]
pub async fn git_fetch(cwd: String) -> Result<GitOutput, String> {
    blocking(move || ok(run(&cwd, &["fetch", "--prune"], NETWORK_TIMEOUT)?)).await
}

/// `git pull` with the user's own pull settings (merge or rebase); conflicts are left for them to resolve.
#[tauri::command]
pub async fn git_pull(cwd: String) -> Result<GitOutput, String> {
    blocking(move || ok(run(&cwd, &["pull", "--no-edit"], NETWORK_TIMEOUT)?)).await
}

/// `set_upstream`: first push of a new branch (`push -u <remote> HEAD`).
#[tauri::command]
pub async fn git_push(cwd: String, set_upstream: Option<String>) -> Result<GitOutput, String> {
    blocking(move || match set_upstream {
        Some(remote) => {
            if remote.is_empty() || remote.starts_with('-') {
                return Err(format!("refusing an unexpected remote name: {remote}"));
            }
            ok(run(
                &cwd,
                &["push", "-u", &remote, "HEAD"],
                NETWORK_TIMEOUT,
            )?)
        }
        None => ok(run(&cwd, &["push"], NETWORK_TIMEOUT)?),
    })
    .await
}

/// A line git writes into a file with an unresolved conflict.
fn has_conflict_markers(text: &str) -> bool {
    text.lines()
        .any(|l| l.starts_with("<<<<<<< ") || l.starts_with(">>>>>>> ") || l == "=======")
}

/// Finish a merge (after a pull that conflicted): stage the workspace folder's resolutions and
/// commit the merge as a whole. Refuses while any conflicted file still has conflict markers,
/// because `git add` would otherwise mark it resolved with the markers inside.
#[tauri::command]
pub async fn git_commit_merge(cwd: String, message: Option<String>) -> Result<GitOutput, String> {
    blocking(move || {
        let unmerged = ok(run(
            &cwd,
            &[
                "diff",
                "--name-only",
                "--relative",
                "--diff-filter=U",
                "-z",
                "--",
                ".",
            ],
            LOCAL_TIMEOUT,
        )?)?
        .stdout;
        let still: Vec<&str> = unmerged
            .split('\0')
            .filter(|p| !p.is_empty())
            .filter(|p| {
                std::fs::read_to_string(Path::new(&cwd).join(p))
                    .map(|t| has_conflict_markers(&t))
                    .unwrap_or(false)
            })
            .collect();
        if !still.is_empty() {
            return Err(format!(
                "These files still have conflict markers; resolve them first:\n{}",
                still.join("\n")
            ));
        }
        ok(run(&cwd, &["add", "-A", "--", "."], LOCAL_TIMEOUT)?)?;
        match message.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
            Some(m) => ok(run(&cwd, &["commit", "-m", m], LOCAL_TIMEOUT)?),
            None => ok(run(&cwd, &["commit", "--no-edit"], LOCAL_TIMEOUT)?),
        }
    })
    .await
}

#[tauri::command]
pub async fn git_init(cwd: String) -> Result<GitOutput, String> {
    blocking(move || ok(run(&cwd, &["init"], LOCAL_TIMEOUT)?)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_option_like_and_escaping_paths() {
        assert!(check_paths(&["collections/a.request.json".into()]).is_ok());
        assert!(check_paths(&[]).is_err());
        assert!(check_paths(&["--exec=evil".into()]).is_err());
        assert!(check_paths(&["../outside".into()]).is_err());
        assert!(check_paths(&["a\0b".into()]).is_err());
    }

    #[test]
    fn reports_a_missing_folder() {
        let err = run("/definitely/not/a/folder", &["status"], LOCAL_TIMEOUT)
            .err()
            .unwrap();
        assert!(err.contains("isn't a folder"));
    }

    /// A throwaway repository with an identity, so commits work on any machine.
    fn temp_repo(name: &str) -> String {
        let dir =
            std::env::temp_dir().join(format!("satchel-git-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let cwd = dir.to_string_lossy().to_string();
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.name", "Test"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            ok(run(&cwd, &args, LOCAL_TIMEOUT).unwrap()).unwrap();
        }
        cwd
    }

    fn write(cwd: &str, rel: &str, content: &str) {
        let path = Path::new(cwd).join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn commits_only_the_selected_paths() {
        let cwd = temp_repo("commit");
        write(&cwd, "collections/a.request.json", "{}");
        write(&cwd, "collections/b.request.json", "{}");
        write(&cwd, "src/app.ts", "code");
        // Something the user staged themselves, outside the selection: must stay out of the commit.
        ok(run(&cwd, &["add", "src/app.ts"], LOCAL_TIMEOUT).unwrap()).unwrap();

        let paths = vec!["collections/a.request.json".to_string()];
        tauri::async_runtime::block_on(git_commit(cwd.clone(), "Add a".into(), paths)).unwrap();

        let committed = ok(run(
            &cwd,
            &["show", "--name-only", "--format=", "HEAD"],
            LOCAL_TIMEOUT,
        )
        .unwrap())
        .unwrap()
        .stdout;
        assert_eq!(committed.trim(), "collections/a.request.json");
        let status = tauri::async_runtime::block_on(git_status(cwd.clone())).unwrap();
        assert!(
            status.contains("collections/b.request.json"),
            "b is still uncommitted"
        );
        assert!(
            status.contains("src/app.ts"),
            "the user's staged file is untouched"
        );
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn commits_deletions_and_reports_the_folder_prefix() {
        let cwd = temp_repo("delete");
        write(&cwd, "api/satchel/satchel.json", "{}");
        write(&cwd, "api/satchel/old.request.json", "{}");
        ok(run(&cwd, &["add", "-A"], LOCAL_TIMEOUT).unwrap()).unwrap();
        ok(run(&cwd, &["commit", "-qm", "init"], LOCAL_TIMEOUT).unwrap()).unwrap();

        let ws = format!("{cwd}/api/satchel");
        std::fs::remove_file(format!("{ws}/old.request.json")).unwrap();
        let info = tauri::async_runtime::block_on(git_info(ws.clone())).unwrap();
        assert!(info.is_repo);
        assert_eq!(info.prefix, "api/satchel/");

        tauri::async_runtime::block_on(git_commit(
            ws.clone(),
            "Remove old".into(),
            vec!["old.request.json".into()],
        ))
        .unwrap();
        let status = tauri::async_runtime::block_on(git_status(ws.clone())).unwrap();
        assert!(!status.contains("old.request.json"));
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn reads_the_repo_root_a_subfolder_and_an_operation_in_one_call() {
        let cwd = temp_repo("info");
        let info = block(git_info(cwd.clone())).unwrap();
        assert!(info.is_repo);
        assert_eq!(info.prefix, "", "an empty line at the root");
        assert_eq!(info.operation, None);

        write(&cwd, "api/satchel/satchel.json", "{}");
        let ws = format!("{cwd}/api/satchel");
        assert_eq!(block(git_info(ws.clone())).unwrap().prefix, "api/satchel/");

        // What git leaves behind while a rebase or a merge is stopped (the paths are relative to the subfolder).
        std::fs::create_dir_all(format!("{cwd}/.git/rebase-merge")).unwrap();
        assert_eq!(
            block(git_info(ws.clone())).unwrap().operation.as_deref(),
            Some("rebase")
        );
        std::fs::remove_dir_all(format!("{cwd}/.git/rebase-merge")).unwrap();
        std::fs::write(format!("{cwd}/.git/MERGE_HEAD"), "0000\n").unwrap();
        assert_eq!(
            block(git_info(ws.clone())).unwrap().operation.as_deref(),
            Some("merge")
        );

        // Inside .git, git answers "false": not a work tree.
        assert!(!block(git_info(format!("{cwd}/.git"))).unwrap().is_repo);

        assert!(block(git_remotes(cwd.clone())).unwrap().is_empty());
        ok(run(
            &cwd,
            &["remote", "add", "origin", "https://example.com/r.git"],
            LOCAL_TIMEOUT,
        )
        .unwrap())
        .unwrap();
        assert_eq!(block(git_remotes(ws)).unwrap(), vec!["origin".to_string()]);
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[cfg(unix)]
    #[test]
    fn stops_a_command_that_runs_too_long() {
        let started = Instant::now();
        let err = run(
            ".",
            &["-c", "alias.nap=!sleep 5", "nap"],
            Duration::from_millis(300),
        )
        .err()
        .unwrap();
        assert!(err.contains("was stopped"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn a_plain_folder_is_not_a_repo() {
        let dir =
            std::env::temp_dir().join(format!("satchel-git-test-plain-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let info =
            tauri::async_runtime::block_on(git_info(dir.to_string_lossy().to_string())).unwrap();
        // temp_dir() itself could live inside a repository on odd setups; only assert when it doesn't
        if !info.is_repo {
            assert_eq!(info.prefix, "");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn block<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    /// Two teammates' clones of one bare remote: push, pull, a conflict, and finishing the merge.
    #[test]
    fn push_pull_and_finish_a_conflicted_merge() {
        let base =
            std::env::temp_dir().join(format!("satchel-git-test-remote-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let root = base.to_string_lossy().to_string();
        let remote = format!("{root}/remote.git");
        ok(run(
            &root,
            &["init", "-q", "--bare", "-b", "main", &remote],
            LOCAL_TIMEOUT,
        )
        .unwrap())
        .unwrap();

        let clone = |name: &str| {
            ok(run(&root, &["clone", "-q", &remote, name], LOCAL_TIMEOUT).unwrap()).unwrap();
            let cwd = format!("{root}/{name}");
            for args in [
                vec!["config", "user.name", name],
                vec!["config", "user.email", "t@example.com"],
                vec!["config", "commit.gpgsign", "false"],
                vec!["config", "pull.rebase", "false"],
                vec!["checkout", "-q", "-b", "main"],
            ] {
                let _ = run(&cwd, &args, LOCAL_TIMEOUT).unwrap();
            }
            cwd
        };
        let ana = clone("ana");
        let bia = clone("bia");

        // Ana creates the workspace and publishes the branch.
        write(
            &ana,
            "login.request.json",
            "{\n  \"url\": \"/v1/login\"\n}\n",
        );
        block(git_commit(
            ana.clone(),
            "Add login".into(),
            vec!["login.request.json".into()],
        ))
        .unwrap();
        block(git_push(ana.clone(), Some("origin".into()))).unwrap();

        // Bia pulls it, and both change the same line.
        block(git_pull(bia.clone())).unwrap();
        write(
            &bia,
            "login.request.json",
            "{\n  \"url\": \"/v2/login\"\n}\n",
        );
        block(git_commit(
            bia.clone(),
            "v2".into(),
            vec!["login.request.json".into()],
        ))
        .unwrap();
        block(git_push(bia.clone(), None)).unwrap();
        write(
            &ana,
            "login.request.json",
            "{\n  \"url\": \"/v3/login\"\n}\n",
        );
        block(git_commit(
            ana.clone(),
            "v3".into(),
            vec!["login.request.json".into()],
        ))
        .unwrap();

        // Ana's pull conflicts: git reports it, and a merge is now in progress.
        assert!(block(git_pull(ana.clone())).is_err());
        assert_eq!(
            block(git_info(ana.clone())).unwrap().operation.as_deref(),
            Some("merge")
        );
        // A partial commit is impossible now; finishing with markers still in the file is refused.
        let refused = block(git_commit_merge(ana.clone(), None)).err().unwrap();
        assert!(refused.contains("login.request.json"), "{refused}");

        // Ana resolves the conflict in her editor, then finishes the merge.
        write(
            &ana,
            "login.request.json",
            "{\n  \"url\": \"/v3/login\"\n}\n",
        );
        block(git_commit_merge(ana.clone(), None)).unwrap();
        assert_eq!(block(git_info(ana.clone())).unwrap().operation, None);
        block(git_push(ana.clone(), None)).unwrap();
        let status = block(git_status(ana.clone())).unwrap();
        assert!(status.contains("# branch.ab +0 -0"), "{status}");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn spots_conflict_markers() {
        assert!(has_conflict_markers(
            "a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> theirs\n"
        ));
        assert!(!has_conflict_markers(
            "{\n  \"note\": \"a <<<<<<< in a string\"\n}"
        ));
    }

    #[test]
    fn surfaces_git_errors() {
        let out = GitOutput {
            code: 128,
            stdout: String::new(),
            stderr: "fatal: not a git repository\n".into(),
        };
        assert_eq!(ok(out).err().unwrap(), "fatal: not a git repository");
    }
}
