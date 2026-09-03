use rusqlite::{params, Connection};
use serde::{Serialize, Deserialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: Option<i64>,
    pub ts_ms: i64,
    pub context: String,
    pub namespace: Option<String>,
    pub argv: Vec<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<i64>,
    pub is_stream: bool,
    pub favorite: bool,
}

pub struct History {
    conn: Mutex<Connection>,
}

impl History {
    pub fn open(path: &Path) -> std::io::Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS command_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                context TEXT NOT NULL,
                namespace TEXT,
                argv_json TEXT NOT NULL,
                exit_code INTEGER,
                duration_ms INTEGER,
                is_stream INTEGER NOT NULL DEFAULT 0,
                favorite INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_history_ts ON command_history(ts DESC);
            CREATE INDEX IF NOT EXISTS idx_history_context ON command_history(context);"
        ).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        Ok(History { conn: Mutex::new(conn) })
    }

    pub fn default_path() -> std::path::PathBuf {
        let mut p = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
        p.push(".kube-panel");
        p.push("history.db");
        p
    }

    pub fn insert(&self, e: &HistoryEntry) -> std::io::Result<i64> {
        let argv_json = serde_json::to_string(&e.argv)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO command_history (ts, context, namespace, argv_json, exit_code, duration_ms, is_stream, favorite)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                e.ts_ms, e.context, e.namespace, argv_json,
                e.exit_code, e.duration_ms, e.is_stream as i64, e.favorite as i64,
            ],
        ).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        Ok(conn.last_insert_rowid())
    }

    fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
        let argv_json: String = row.get("argv_json")?;
        let argv: Vec<String> = serde_json::from_str(&argv_json)
            .unwrap_or_else(|e| {
                eprintln!("[kube-panel] malformed argv_json in history row: {e}");
                Vec::new()
            });
        Ok(HistoryEntry {
            id: Some(row.get("id")?),
            ts_ms: row.get("ts")?,
            context: row.get("context")?,
            namespace: row.get("namespace")?,
            argv,
            exit_code: row.get("exit_code")?,
            duration_ms: row.get("duration_ms")?,
            is_stream: row.get::<_, i64>("is_stream")? != 0,
            favorite: row.get::<_, i64>("favorite")? != 0,
        })
    }

    pub fn list(&self, limit: i64) -> std::io::Result<Vec<HistoryEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ts, context, namespace, argv_json, exit_code, duration_ms, is_stream, favorite
             FROM command_history ORDER BY ts DESC LIMIT ?1"
        ).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let rows = stmt.query_map(params![limit], Self::row_to_entry)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?); }
        Ok(out)
    }

    pub fn search(&self, q: &str, limit: i64) -> std::io::Result<Vec<HistoryEntry>> {
        let like = format!("%{}%", q);
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ts, context, namespace, argv_json, exit_code, duration_ms, is_stream, favorite
             FROM command_history
             WHERE argv_json LIKE ?1 OR context LIKE ?1 OR namespace LIKE ?1
             ORDER BY ts DESC LIMIT ?2"
        ).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let rows = stmt.query_map(params![like, limit], Self::row_to_entry)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?); }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_db() -> std::path::PathBuf {
        static C: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = C.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut p = std::env::temp_dir();
        p.push(format!("kp-hist-{}-{}.db", std::process::id(), n));
        p
    }

    #[test]
    fn insert_then_list_roundtrip() {
        let path = tmp_db();
        let h = History::open(&path).unwrap();
        let id = h.insert(&HistoryEntry {
            id: None, ts_ms: 1000, context: "dev".into(), namespace: Some("default".into()),
            argv: vec!["get".into(), "pods".into()], exit_code: Some(0),
            duration_ms: Some(12), is_stream: false, favorite: false,
        }).unwrap();
        assert!(id > 0);
        let list = h.list(10).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].argv, vec!["get".to_string(), "pods".to_string()]);
        assert_eq!(list[0].context, "dev");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn search_matches_argv() {
        let path = tmp_db();
        let h = History::open(&path).unwrap();
        h.insert(&HistoryEntry {
            id: None, ts_ms: 1, context: "prod".into(), namespace: None,
            argv: vec!["logs".into(), "nginx".into()], exit_code: Some(0),
            duration_ms: Some(5), is_stream: true, favorite: false,
        }).unwrap();
        let r = h.search("nginx", 10).unwrap();
        assert_eq!(r.len(), 1);
        let r2 = h.search("nothinglike", 10).unwrap();
        assert!(r2.is_empty());
        std::fs::remove_file(path).ok();
    }
}
