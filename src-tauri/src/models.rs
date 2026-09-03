#![allow(non_snake_case)]

use serde::Deserialize;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Deserialize)]
pub struct PodList { pub items: Vec<Pod> }

#[derive(Debug, Clone, Deserialize)]
pub struct Pod {
    pub metadata: PodMeta,
    pub spec: PodSpec,
    pub status: PodStatus,
}
#[derive(Debug, Clone, Deserialize)]
pub struct PodMeta { pub name: String, pub namespace: String, pub creationTimestamp: String }
#[derive(Debug, Clone, Deserialize)]
pub struct PodSpec { #[serde(default)] pub containers: Vec<NamedContainer>, #[serde(default)] pub nodeName: Option<String> }
#[derive(Debug, Clone, Deserialize)]
pub struct NamedContainer { pub name: String }
#[derive(Debug, Clone, Deserialize)]
pub struct PodStatus { pub phase: String, #[serde(default)] pub podIP: Option<String>,
    #[serde(default)] pub containerStatuses: Vec<ContainerStatus> }
#[derive(Debug, Clone, Deserialize)]
pub struct ContainerStatus { pub name: String, pub restartCount: i64, pub ready: bool,
    #[serde(default)] pub state: ContainerState }
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ContainerState {
    #[serde(default)] pub waiting: Option<WaitingState>,
    #[serde(default)] pub terminated: Option<TerminatedState>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct WaitingState { pub reason: String }
#[derive(Debug, Clone, Deserialize)]
pub struct TerminatedState { pub reason: String }

#[derive(Debug, Clone, serde::Serialize)]
pub struct PodView {
    pub name: String, pub namespace: String, pub ready: String,
    pub status: String, pub restarts: i64, pub age: String,
    pub ip: String, pub node: String, pub containers: Vec<String>,
}

pub fn parse_pod_list(json: &[u8]) -> std::io::Result<Vec<PodView>> {
    let list: PodList = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let now = Utc::now();
    let mut out = Vec::with_capacity(list.items.len());
    for p in list.items {
        let total = p.spec.containers.len() as i64;
        let ready_count = p.status.containerStatuses.iter().filter(|c| c.ready).count() as i64;
        let restarts: i64 = p.status.containerStatuses.iter().map(|c| c.restartCount).sum();
        // status: prefer first waiting reason, else terminated reason, else phase
        let status = p.status.containerStatuses.iter()
            .find_map(|c| c.state.waiting.as_ref().map(|w| w.reason.clone()))
            .or_else(|| p.status.containerStatuses.iter()
                .find_map(|c| c.state.terminated.as_ref().map(|t| t.reason.clone())))
            .unwrap_or(p.status.phase.clone());
        let age = age_string(&p.metadata.creationTimestamp, now);
        let containers = p.spec.containers.into_iter().map(|c| c.name).collect();
        out.push(PodView {
            name: p.metadata.name,
            namespace: p.metadata.namespace,
            ready: format!("{}/{}", ready_count, total),
            status,
            restarts,
            age,
            ip: p.status.podIP.unwrap_or_default(),
            node: p.spec.nodeName.unwrap_or_default(),
            containers,
        });
    }
    Ok(out)
}

fn age_string(creation: &str, now: DateTime<Utc>) -> String {
    match DateTime::parse_from_rfc3339(creation) {
        Ok(t) => {
            let t = t.with_timezone(&Utc);
            let d = now.signed_duration_since(t);
            let secs = d.num_seconds();
            if secs < 0 { return "0s".into(); }
            if secs < 60 { return format!("{}s", secs); }
            if secs < 3600 { return format!("{}m", secs / 60); }
            if secs < 86400 { return format!("{}h", secs / 3600); }
            format!("{}d", secs / 86400)
        }
        Err(_) => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_two_pods_with_status_and_ready() {
        let json = br#"{
            "items": [
                {"metadata":{"name":"nginx","namespace":"default","creationTimestamp":"2024-01-01T00:00:00Z"},
                 "spec":{"containers":[{"name":"nginx"}],"nodeName":"node-1"},
                 "status":{"phase":"Running","podIP":"10.0.0.1","containerStatuses":[{"name":"nginx","restartCount":0,"ready":true}]}},
                {"metadata":{"name":"crashy","namespace":"default","creationTimestamp":"2024-01-01T00:00:00Z"},
                 "spec":{"containers":[{"name":"app"}]},
                 "status":{"phase":"Running","podIP":"10.0.0.2","containerStatuses":[{"name":"app","restartCount":7,"ready":false,"state":{"waiting":{"reason":"CrashLoopBackOff"}}}]}}
            ]
        }"#;
        let views = parse_pod_list(json).unwrap();
        assert_eq!(views.len(), 2);
        let n = views.iter().find(|v| v.name == "nginx").unwrap();
        assert_eq!(n.ready, "1/1");
        assert_eq!(n.status, "Running");
        assert_eq!(n.node, "node-1");
        let c = views.iter().find(|v| v.name == "crashy").unwrap();
        assert_eq!(c.status, "CrashLoopBackOff");
        assert_eq!(c.restarts, 7);
        assert_eq!(c.ready, "0/1");
    }
}
