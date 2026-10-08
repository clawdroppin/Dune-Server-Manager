mod automation;
mod backup;
mod dune;
mod hyperv;
mod net;
mod proc;
mod ssh;
mod steam;
mod store;
mod system;

use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WebviewWindow};

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn app_quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn window_hide(window: WebviewWindow) {
    let _ = window.hide();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .manage(proc::Procs::default())
        .manage(dune::Samples::default())
        .manage(system::Host::default())
        .manage::<automation::EngineRef>(Arc::new(automation::Engine::default()))
        .setup(|app| {
            // Create the main window ourselves so portable mode can keep the WebView cache in .\data too.
            let cfg = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .expect("main window config");
            let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?;
            if store::is_portable() {
                builder = builder.data_directory(store::data_dir().join("webview"));
            }
            builder.build()?;

            let title = MenuItem::with_id(app, "title", "Dune Server Manager: running", false, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Open", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Dune Server Manager", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&title, &sep, &show, &quit])?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("Dune Server Manager (running). Right-click to quit")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id().as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            // Launched by Windows autostart with --minimized: stay in the tray, automation still runs.
            if !std::env::args().any(|a| a == "--minimized") {
                show_main(app.handle());
            }
            automation::spawn(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Alt+F4 / taskbar "Close window": let the UI decide (ask / tray / quit), like the X button.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.emit("app://close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_quit,
            window_hide,
            store::state_load,
            store::state_save,
            store::app_paths,
            system::system_check,
            system::host_stats,
            system::relaunch_elevated,
            proc::proc_kill,
            proc::run_powershell,
            proc::stream_powershell,
            proc::launch_elevated_console,
            hyperv::vm_list,
            hyperv::vm_action,
            hyperv::vm_set_resources,
            ssh::ssh_exec,
            ssh::ssh_stream,
            ssh::ssh_test,
            ssh::remote_read,
            ssh::remote_write,
            ssh::remote_ls,
            ssh::ssh_pull,
            ssh::ssh_forget_host,
            ssh::discover_keys,
            ssh::import_key,
            dune::bg_snapshot,
            dune::bg_wrapper_stream,
            dune::bg_set_stop,
            dune::kubectl,
            dune::kubectl_stream,
            steam::steamcmd_ensure,
            steam::steamcmd_update,
            steam::steamcmd_interactive_login,
            steam::steam_remote_build,
            steam::steam_local_build,
            steam::find_battlegroup_bat,
            steam::detect_installs,
            steam::dir_size,
            steam::read_local_file,
            steam::path_exists,
            net::public_ip,
            net::upnp_status,
            net::upnp_apply,
            net::tcp_probe,
            net::host_ping,
            net::ddns_update,
            net::webhook_send,
            backup::backup_create,
            backup::backup_list,
            backup::backup_delete,
            backup::backup_pin,
            backup::backup_read_settings,
            automation::automation_log,
            automation::automation_busy,
            automation::automation_notify,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dune Server Manager");
}
