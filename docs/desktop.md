# Desktop app (Windows)

> **Untested.** The Tauri v2 shell in `src-tauri/` was written on a machine without Rust, so it has never been compiled or run. Expect small fixes on the first `npx tauri dev`.

The desktop app is a Tauri v2 window around the web UI. In development it loads `http://127.0.0.1:5173`; in a release build it embeds `dist/app/`. It can also start and stop a local llama.cpp `llama-server` for AI mode.

## Prerequisites (Windows 10/11)

1. **Rust** via rustup: run `rustup-init.exe` from <https://rustup.rs> (or `winget install Rustlang.Rustup`) and keep the default `stable-x86_64-pc-windows-msvc` toolchain. Check with `cargo --version`.
2. **Microsoft C++ Build Tools**: install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload (MSVC and a Windows SDK).
3. **WebView2**: already part of Windows 11. Nothing to install.
4. **Node.js 22.18+**, the same as the rest of the project.

See also <https://v2.tauri.app/start/prerequisites/>.

## One-time setup

```powershell
npm i -D @tauri-apps/cli@^2
npx tauri icon path/to/icon.png   # square PNG, ideally 1024x1024; writes src-tauri/icons/
```

The build fails without the icons (`icons/icon.ico` is needed for the Windows resource file), so run the icon step before the first build.

## Run and build

- `npx tauri dev` runs `npm run build && npm run serve`, waits for `http://127.0.0.1:5173`, then opens the window. The first run compiles all crates and takes several minutes. After you change the UI, run `npm run build` again and reload the window.
- `npx tauri build` runs `npm run build`, then writes an NSIS installer to `src-tauri/target/release/bundle/nsis/`.

## AI mode

The app does not ship a model. AI mode needs:

- a `llama-server.exe` from a llama.cpp release (<https://github.com/ggml-org/llama.cpp/releases>), and
- a GGUF model file.

Set both paths, and the port, in the app's settings. The app then runs
`<llama-server> -m <model.gguf> -c 8192 --host 127.0.0.1 --port <port>` with no console window, and stops it when the app exits. Turning AI mode off leaves it running.

The UI calls these through `window.__TAURI__.core.invoke`. That object only exists in the desktop app, so check for it first:

| Call | Result |
| --- | --- |
| `invoke("start_ai", { serverPath, modelPath, port })` | Starts the server. Fails if one is already running. `port` must be a number. |
| `invoke("stop_ai")` | Kills the server and waits for it to exit. Does nothing if none is running. |
| `invoke("ai_running")` | `true` while the process is alive. |

`start_ai` returns as soon as the process starts, before the model has loaded. Poll `GET http://127.0.0.1:<port>/health` until it returns 200.

## Security

The content security policy allows only the app's own files, inline styles, and connections to `http://127.0.0.1:*` (llama-server) and Tauri IPC. Inline scripts, inline event handlers and remote servers are blocked.

If the app crashes or is ended from Task Manager, llama-server can keep running. End `llama-server.exe` in Task Manager if that happens.
