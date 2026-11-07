//! Tauri v2 desktop shell for ToS Checker.
//!
//! Shows the web UI (dist/app) in a window and lets the UI start and stop a
//! local llama.cpp `llama-server` for AI mode. Untested: written on a machine
//! without a Rust toolchain.
//!
//! The window never sends a program path. The user picks llama-server and the
//! model file in a native file dialog (`pick_ai_file`), Rust keeps those paths,
//! and `start_ai` only runs the picked file. So a page that ends up in the
//! window (as in dev mode, or through a bug) can't make the app run anything else.

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_dialog::DialogExt;

/// The llama-server process started by `start_ai`, if any.
type AiChild = Mutex<Option<Child>>;

/// The files the user picked. Kept in `ai-files.json` in the app's config folder.
#[derive(Default, Clone, Serialize, Deserialize)]
struct AiFiles {
    server: Option<PathBuf>,
    model: Option<PathBuf>,
}
type AiPaths = Mutex<AiFiles>;

/// What the UI shows in AI settings.
#[derive(Serialize)]
struct AiFilesView {
    server: Option<String>,
    model: Option<String>,
}

impl AiFiles {
    fn view(&self) -> AiFilesView {
        let shown = |path: &Option<PathBuf>| path.as_ref().map(|p| p.display().to_string());
        AiFilesView {
            server: shown(&self.server),
            model: shown(&self.model),
        }
    }
}

/// Locks the slot even if a panic poisoned it, so the server can always be stopped.
fn lock(state: &AiChild) -> MutexGuard<'_, Option<Child>> {
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

fn lock_files(state: &AiPaths) -> MutexGuard<'_, AiFiles> {
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

fn files_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("ai-files.json"))
}

/// The files picked in an earlier run, or none.
fn load_files(app: &AppHandle) -> AiFiles {
    files_path(app)
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Remembers the picked files for the next run. If this fails, the user just picks again.
fn save_files(app: &AppHandle, files: &AiFiles) {
    let Some(path) = files_path(app) else { return };
    let Ok(json) = serde_json::to_vec_pretty(files) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(path, json);
}

/// True while the server process exists and has not exited.
fn is_running(slot: &mut Option<Child>) -> bool {
    matches!(slot.as_mut().map(|child| child.try_wait()), Some(Ok(None)))
}

/// Kills the server (if any) and waits for it to exit.
fn stop_child(state: &AiChild) -> Result<(), String> {
    let mut slot = lock(state);
    if let Some(child) = slot.as_mut() {
        // kill() returns Ok if the process already exited; wait() then reaps it.
        child
            .kill()
            .map_err(|e| format!("Could not stop the AI server: {e}"))?;
        child
            .wait()
            .map_err(|e| format!("Could not stop the AI server: {e}"))?;
    }
    *slot = None;
    Ok(())
}

/// The llama-server and model file picked so far (null if not picked).
#[tauri::command]
fn ai_files(paths: State<'_, AiPaths>) -> AiFilesView {
    lock_files(&paths).view()
}

/// Opens a native file dialog for `which` ("server" or "model") and keeps the
/// file the user picks. Cancelling keeps the old one. Returns the files picked so far.
#[tauri::command]
async fn pick_ai_file(app: AppHandle, which: String) -> Result<AiFilesView, String> {
    let dialog = app.dialog().file();
    let dialog = match which.as_str() {
        "server" => {
            let dialog = dialog.set_title("Choose llama-server");
            if cfg!(windows) {
                dialog.add_filter("llama-server", &["exe"])
            } else {
                dialog
            }
        }
        "model" => dialog
            .set_title("Choose the model file")
            .add_filter("GGUF model", &["gguf"]),
        _ => return Err(format!("Unknown file: {which}")),
    };
    // Async commands run off the main thread, where a blocking dialog is allowed.
    let picked = dialog
        .blocking_pick_file()
        .and_then(|file| file.as_path().map(|path| path.to_path_buf()));

    let state = app.state::<AiPaths>();
    let mut files = lock_files(&state);
    if let Some(path) = picked {
        if which == "server" {
            files.server = Some(path);
        } else {
            files.model = Some(path);
        }
        save_files(&app, &files);
    }
    Ok(files.view())
}

/// Runs `<picked server> -m <picked model> -c 8192 --host 127.0.0.1 --port <port>`.
/// Returns once the process has started, not once the model has loaded:
/// poll `GET http://127.0.0.1:<port>/health` until it answers 200.
#[tauri::command]
fn start_ai(state: State<'_, AiChild>, paths: State<'_, AiPaths>, port: u16) -> Result<(), String> {
    let files = lock_files(&paths).clone();
    let (Some(server), Some(model)) = (files.server, files.model) else {
        return Err("Choose llama-server and the model file in AI settings first.".into());
    };

    let mut slot = lock(&state);
    if is_running(&mut slot) {
        return Err("The AI server is already running.".into());
    }

    let mut cmd = Command::new(&server);
    cmd.arg("-m")
        .arg(&model)
        .args(["-c", "8192", "--host", "127.0.0.1", "--port"])
        .arg(port.to_string());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Don't open a console window for llama-server.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Could not start {}: {e}", server.display()))?;
    *slot = Some(child);
    Ok(())
}

/// Stops the AI server. Does nothing if it isn't running.
#[tauri::command]
fn stop_ai(state: State<'_, AiChild>) -> Result<(), String> {
    stop_child(&state)
}

/// Whether the AI server process is still alive.
#[tauri::command]
fn ai_running(state: State<'_, AiChild>) -> bool {
    let mut slot = lock(&state);
    is_running(&mut slot)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AiChild::new(None))
        .setup(|app| {
            let files = load_files(app.handle());
            app.manage(AiPaths::new(files));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_ai,
            stop_ai,
            ai_running,
            ai_files,
            pick_ai_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building the ToS Checker app")
        .run(|app, event| {
            // Don't leave llama-server running after the app closes.
            if let RunEvent::Exit = event {
                let _ = stop_child(&app.state::<AiChild>());
            }
        });
}
