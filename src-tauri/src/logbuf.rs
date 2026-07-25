use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Lines retained for backfill when the user opens the Activity section.
pub const MAX_LINES: usize = 500;

/// How often the flusher thread emits a batch to the frontend.
const FLUSH_INTERVAL: Duration = Duration::from_millis(200);

/// Absorbs the proxy's stdout/stderr without touching the frontend.
///
/// The proxy binary can emit thousands of lines per second under load.
/// Emitting a Tauri event per line pegged the CPU: every event forced a
/// React state update and a full re-render of the log list, even while the
/// window was minimized (WebKitGTK keeps running JS and layout when hidden).
///
/// So lines land here instead. `history` is a bounded ring for backfill;
/// `pending` only accumulates while the frontend actually has the Activity
/// section open, and a single thread drains it on a fixed interval. With the
/// section closed the entire cost of a log line is one `VecDeque::push_back`.
pub struct LogBuffer {
    history: Mutex<VecDeque<String>>,
    pending: Mutex<Vec<String>>,
    streaming: AtomicBool,
}

impl LogBuffer {
    pub fn new() -> Self {
        LogBuffer {
            history: Mutex::new(VecDeque::with_capacity(MAX_LINES)),
            pending: Mutex::new(Vec::new()),
            streaming: AtomicBool::new(false),
        }
    }

    pub fn push(&self, line: String) {
        if self.streaming.load(Ordering::Relaxed) {
            let mut pending = self.pending.lock().unwrap();
            // A single 200ms tick can never usefully render more than the
            // ring holds; past that, drop rather than grow unboundedly.
            if pending.len() < MAX_LINES {
                pending.push(line.clone());
            }
        }
        let mut history = self.history.lock().unwrap();
        if history.len() == MAX_LINES {
            history.pop_front();
        }
        history.push_back(line);
    }

    pub fn snapshot(&self) -> Vec<String> {
        self.history.lock().unwrap().iter().cloned().collect()
    }

    pub fn set_streaming(&self, on: bool) {
        self.streaming.store(on, Ordering::Relaxed);
        if !on {
            self.pending.lock().unwrap().clear();
        }
    }

    fn take_pending(&self) -> Vec<String> {
        std::mem::take(&mut *self.pending.lock().unwrap())
    }

    /// One thread for the app's lifetime. A dedicated ticker rather than
    /// batching inside the reader thread: `BufRead::lines()` blocks, so a
    /// reader-side batch would strand the last few lines until the next line
    /// arrived — exactly when the user is watching for a final error.
    pub fn spawn_flusher(self: Arc<Self>, app: AppHandle) {
        std::thread::spawn(move || loop {
            std::thread::sleep(FLUSH_INTERVAL);
            if !self.streaming.load(Ordering::Relaxed) {
                continue;
            }
            let batch = self.take_pending();
            if !batch.is_empty() {
                let _ = app.emit("log-batch", batch);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_evicts_oldest_beyond_cap() {
        let buf = LogBuffer::new();
        for i in 0..(MAX_LINES + 10) {
            buf.push(format!("line {i}"));
        }
        let snap = buf.snapshot();
        assert_eq!(snap.len(), MAX_LINES);
        assert_eq!(snap[0], format!("line {}", 10));
        assert_eq!(snap[MAX_LINES - 1], format!("line {}", MAX_LINES + 9));
    }

    #[test]
    fn pending_stays_empty_while_not_streaming() {
        let buf = LogBuffer::new();
        buf.push("a".into());
        buf.push("b".into());
        assert!(buf.take_pending().is_empty());
        assert_eq!(buf.snapshot().len(), 2);
    }

    #[test]
    fn pending_collects_only_after_streaming_enabled() {
        let buf = LogBuffer::new();
        buf.push("before".into());
        buf.set_streaming(true);
        buf.push("after".into());
        assert_eq!(buf.take_pending(), vec!["after".to_string()]);
        // take_pending drains
        assert!(buf.take_pending().is_empty());
    }

    #[test]
    fn disabling_streaming_drops_pending() {
        let buf = LogBuffer::new();
        buf.set_streaming(true);
        buf.push("x".into());
        buf.set_streaming(false);
        assert!(buf.take_pending().is_empty());
    }
}
