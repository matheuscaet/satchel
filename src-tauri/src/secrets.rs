//! Secret variable values, kept in the system keychain (macOS Keychain,
//! Windows Credential Manager, the Secret Service on Linux) rather than in
//! the workspace folder or the webview's storage.
//!
//! The frontend stores one text value (a JSON map) per account: one per
//! workspace folder, one for the app's own workspace. Values are split
//! across several keychain items when long, because Windows caps an item at
//! 2560 bytes. Where no keychain is available (a Linux session without a
//! Secret Service, say), the value goes to a file in the app's data folder
//! that only the user can read, and the frontend is told so.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Bytes per keychain item: fits Windows' 2560-byte blob whether it holds UTF-8 or UTF-16.
const CHUNK: usize = 1200;
/// A value longer than this is refused: it isn't a set of variables any more.
const MAX_VALUE: usize = 1024 * 1024;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Backend {
    Keychain,
    File,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretValue {
    pub value: Option<String>,
    pub backend: Backend,
}

/// One keychain item per name. Behind a trait so the chunking is tested without a keychain.
trait Items {
    fn get(&self, name: &str) -> Result<Option<String>, String>;
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    fn delete(&self, name: &str) -> Result<(), String>;
}

struct Keychain {
    service: String,
}

impl Keychain {
    fn available() -> bool {
        keyring::Entry::store_status().is_ok()
    }

    fn entry(&self, name: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.service, name).map_err(|e| e.to_string())
    }
}

impl Items for Keychain {
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        match self.entry(name)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        self.entry(name)?
            .set_password(value)
            .map_err(|e| e.to_string())
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        match self.entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

fn part_name(account: &str, i: usize) -> String {
    if i == 0 {
        account.to_string()
    } else {
        format!("{account}#{i}")
    }
}

/// Split at char boundaries into pieces of at most CHUNK bytes.
fn chunks(value: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = value;
    while rest.len() > CHUNK {
        let mut cut = CHUNK;
        while !rest.is_char_boundary(cut) {
            cut -= 1;
        }
        out.push(&rest[..cut]);
        rest = &rest[cut..];
    }
    out.push(rest);
    out
}

/// The first item reads "<count>:<first piece>"; the others hold the rest in order.
fn read_parts(items: &dyn Items, account: &str) -> Result<Option<(usize, String)>, String> {
    let Some(first) = items.get(account)? else {
        return Ok(None);
    };
    let (count, head) = first
        .split_once(':')
        .ok_or("the keychain item isn't in Satchel's format")?;
    let count: usize = count
        .parse()
        .map_err(|_| "the keychain item isn't in Satchel's format")?;
    let mut value = head.to_string();
    for i in 1..count {
        let part = items
            .get(&part_name(account, i))?
            .ok_or("part of the keychain item is missing")?;
        value.push_str(&part);
    }
    Ok(Some((count, value)))
}

fn read_chunked(items: &dyn Items, account: &str) -> Result<Option<String>, String> {
    Ok(read_parts(items, account)?.map(|(_, v)| v))
}

fn write_chunked(items: &dyn Items, account: &str, value: &str) -> Result<(), String> {
    let old = read_parts(items, account)
        .ok()
        .flatten()
        .map_or(0, |(n, _)| n);
    let parts = chunks(value);
    // The rest first, the head last: a reader never sees a count whose parts aren't written yet.
    for (i, part) in parts.iter().enumerate().skip(1) {
        items.set(&part_name(account, i), part)?;
    }
    items.set(account, &format!("{}:{}", parts.len(), parts[0]))?;
    for i in parts.len()..old {
        items.delete(&part_name(account, i))?;
    }
    Ok(())
}

fn delete_chunked(items: &dyn Items, account: &str) -> Result<(), String> {
    let count = read_parts(items, account)
        .ok()
        .flatten()
        .map_or(1, |(n, _)| n);
    for i in (0..count.max(1)).rev() {
        items.delete(&part_name(account, i))?;
    }
    Ok(())
}

/// Accounts are names the app makes up ("app", "workspace/<uuid>"): nothing else is accepted.
fn check_account(account: &str) -> Result<(), String> {
    let ok = !account.is_empty()
        && account.len() <= 100
        && account
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_'));
    if ok {
        Ok(())
    } else {
        Err(format!("invalid secrets account: {account:?}"))
    }
}

fn fallback_path(dir: &Path, account: &str) -> PathBuf {
    dir.join(format!("{}.json", account.replace('/', "_")))
}

fn read_file(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn write_file(path: &Path, value: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("no folder for the secrets file")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    {
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        use std::io::Write;
        let mut file = options.open(&tmp).map_err(|e| e.to_string())?;
        file.write_all(value.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn remove_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

struct Vault {
    keychain: Option<Keychain>,
    dir: PathBuf,
}

impl Vault {
    fn new(app: &AppHandle) -> Result<Self, String> {
        let dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("secrets");
        let keychain = Keychain::available().then(|| Keychain {
            service: app.config().identifier.clone(),
        });
        Ok(Self { keychain, dir })
    }

    fn get(&self, account: &str) -> Result<SecretValue, String> {
        let file = fallback_path(&self.dir, account);
        if let Some(k) = &self.keychain {
            // A keychain that's there but fails (locked, access refused) is an error, not "no secrets":
            // reporting nothing would let the next save overwrite the real values with blanks.
            let value = match read_chunked(k, account)
                .map_err(|e| format!("Couldn't read the system keychain: {e}"))?
            {
                Some(v) => Some(v),
                // written while the keychain was unavailable; moved into it on the next save
                None => read_file(&file)?,
            };
            return Ok(SecretValue {
                value,
                backend: Backend::Keychain,
            });
        }
        Ok(SecretValue {
            value: read_file(&file)?,
            backend: Backend::File,
        })
    }

    fn set(&self, account: &str, value: &str) -> Result<Backend, String> {
        let file = fallback_path(&self.dir, account);
        if let Some(k) = &self.keychain {
            if write_chunked(k, account, value).is_ok() {
                remove_file(&file)?;
                return Ok(Backend::Keychain);
            }
        }
        write_file(&file, value)?;
        Ok(Backend::File)
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        if let Some(k) = &self.keychain {
            // Best effort: the keychain may be locked or gone; the file below is ours either way.
            let _ = delete_chunked(k, account);
        }
        remove_file(&fallback_path(&self.dir, account))
    }
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn secrets_get(app: AppHandle, account: String) -> Result<SecretValue, String> {
    check_account(&account)?;
    blocking(move || Vault::new(&app)?.get(&account)).await
}

#[tauri::command]
pub async fn secrets_set(
    app: AppHandle,
    account: String,
    value: String,
) -> Result<Backend, String> {
    check_account(&account)?;
    if value.len() > MAX_VALUE {
        return Err("the secret values are too large to store".into());
    }
    blocking(move || Vault::new(&app)?.set(&account, &value)).await
}

#[tauri::command]
pub async fn secrets_delete(app: AppHandle, account: String) -> Result<(), String> {
    check_account(&account)?;
    blocking(move || Vault::new(&app)?.delete(&account)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    #[derive(Default)]
    struct Memory(RefCell<BTreeMap<String, String>>);

    impl Items for Memory {
        fn get(&self, name: &str) -> Result<Option<String>, String> {
            Ok(self.0.borrow().get(name).cloned())
        }
        fn set(&self, name: &str, value: &str) -> Result<(), String> {
            assert!(
                value.len() <= CHUNK + 20,
                "item too long for Windows: {}",
                value.len()
            );
            self.0.borrow_mut().insert(name.into(), value.into());
            Ok(())
        }
        fn delete(&self, name: &str) -> Result<(), String> {
            self.0.borrow_mut().remove(name);
            Ok(())
        }
    }

    #[test]
    fn round_trips_short_and_long_values() {
        let items = Memory::default();
        assert_eq!(read_chunked(&items, "app").unwrap(), None);

        write_chunked(&items, "app", "{\"a\":\"1\"}").unwrap();
        assert_eq!(
            read_chunked(&items, "app").unwrap().as_deref(),
            Some("{\"a\":\"1\"}")
        );
        assert_eq!(items.0.borrow().len(), 1);

        // multi-byte characters across chunk boundaries
        let long = "token-é😀".repeat(1000);
        write_chunked(&items, "app", &long).unwrap();
        assert_eq!(
            read_chunked(&items, "app").unwrap().as_deref(),
            Some(long.as_str())
        );
        assert!(items.0.borrow().len() > 5);
    }

    #[test]
    fn shrinking_a_value_removes_the_extra_items() {
        let items = Memory::default();
        write_chunked(&items, "workspace/x", &"a".repeat(CHUNK * 4)).unwrap();
        assert_eq!(items.0.borrow().len(), 4);
        write_chunked(&items, "workspace/x", "short").unwrap();
        assert_eq!(items.0.borrow().len(), 1);
        assert_eq!(
            read_chunked(&items, "workspace/x").unwrap().as_deref(),
            Some("short")
        );
    }

    #[test]
    fn deletes_every_item() {
        let items = Memory::default();
        write_chunked(&items, "app", &"b".repeat(CHUNK * 3)).unwrap();
        items.set("other", "1:keep").unwrap();
        delete_chunked(&items, "app").unwrap();
        assert_eq!(items.0.borrow().keys().collect::<Vec<_>>(), vec!["other"]);
        assert_eq!(read_chunked(&items, "app").unwrap(), None);
    }

    #[test]
    fn rejects_foreign_items_and_odd_accounts() {
        let items = Memory::default();
        items.set("app", "not ours").unwrap();
        assert!(read_chunked(&items, "app").is_err());
        assert!(check_account("workspace/0b8e-4f").is_ok());
        assert!(check_account("").is_err());
        assert!(check_account("../x").is_err());
        assert!(check_account("a b").is_err());
    }

    #[test]
    fn fallback_file_is_private() {
        let dir = std::env::temp_dir().join(format!("satchel-secrets-{}", std::process::id()));
        let path = fallback_path(&dir, "workspace/abc");
        write_file(&path, "{\"k\":\"v\"}").unwrap();
        assert_eq!(read_file(&path).unwrap().as_deref(), Some("{\"k\":\"v\"}"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        remove_file(&path).unwrap();
        assert_eq!(read_file(&path).unwrap(), None);
        let _ = fs::remove_dir_all(dir);
    }

    /// Against the real keychain of the machine running it: `cargo test -- --ignored real_keychain`.
    #[test]
    #[ignore]
    fn real_keychain() {
        assert!(Keychain::available(), "no system keychain here");
        let k = Keychain {
            service: "com.matheuscaet.satchel.test".into(),
        };
        let long = "secret-é😀".repeat(700);
        write_chunked(&k, "test/roundtrip", &long).unwrap();
        assert_eq!(
            read_chunked(&k, "test/roundtrip").unwrap().as_deref(),
            Some(long.as_str())
        );
        write_chunked(&k, "test/roundtrip", "short").unwrap();
        assert_eq!(
            read_chunked(&k, "test/roundtrip").unwrap().as_deref(),
            Some("short")
        );
        assert_eq!(k.get("test/roundtrip#1").unwrap(), None);
        delete_chunked(&k, "test/roundtrip").unwrap();
        assert_eq!(read_chunked(&k, "test/roundtrip").unwrap(), None);
    }
}
