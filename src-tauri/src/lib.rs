//! Tauri v2 desktop shell for ToS Checker.
//!
//! Shows the web UI (dist/app) in a window and lets the UI start and stop a
//! local llama.cpp `llama-server` for AI mode. Untested: written on a machine
//! without a Rust toolchain.

use std::process::{Child, Command};
use std::sync::{Mutex, MutexGuard, PoisonError};

use tauri::{Manager, RunEvent, State};

/// The llama-server process started by `start_ai`, if any.
type AiChild = Mutex<Option<Child>>;

/// Locks the slot even if a panic poisoned it, so the server can always be stopped.
fn lock(state: &AiChild) -> MutexGuard<'_, Option<Child>> {
    state.lock().unwrap_or_else(PoisonError::into_inner)
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

/// Runs `<server_path> -m <model_path> -c 8192 --host 127.0.0.1 --port <port>`.
/// Returns once the process has started, not once the model has loaded:
/// poll `GET http://127.0.0.1:<port>/health` until it answers 200.
#[tauri::command]
fn start_ai(
    state: State<'_, AiChild>,
    server_path: String,
    model_path: String,
    port: u16,
) -> Result<(), String> {
    let mut slot = lock(&state);
    if is_running(&mut slot) {
        return Err("The AI server is already running.".into());
    }

    let mut cmd = Command::new(&server_path);
    cmd.arg("-m")
        .arg(&model_path)
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
        .map_err(|e| format!("Could not start {server_path}: {e}"))?;
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
        .manage(AiChild::new(None))
        .invoke_handler(tauri::generate_handler![start_ai, stop_ai, ai_running])
        .build(tauri::generate_context!())
        .expect("error while building the ToS Checker app")
        .run(|app, event| {
            // Don't leave llama-server running after the app closes.
            if let RunEvent::Exit = event {
                let _ = stop_child(&app.state::<AiChild>());
            }
        });
}
